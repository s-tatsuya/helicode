/**
 * Helicode: Helix keybindings for VS Code.
 */
import * as vscode from 'vscode';
import { Engine, EngineConfig } from './engine/engine';
import { registerCommands } from './engine/commands';
import { disposeDecorationTypes, ensureDecorationTypes } from './engine/editor-state';
import { StatusBar } from './vscode/statusbar';
import { installCommandLine } from './vscode/cmdline';
import { disposeLabelDecorations } from './vscode/labels';
import { disposeSearchDecorations } from './engine/commands/search';
import { parseKey } from './core/keys';
import * as ts from './treesitter';
import { docFor } from './vscode/document';

let engine: Engine | undefined;
let statusBar: StatusBar | undefined;

function readConfig(): EngineConfig {
  const c = vscode.workspace.getConfiguration('helicode');
  return {
    jumpLabelAlphabet: c.get<string>('jumpLabelAlphabet', 'abcdefghijklmnopqrstuvwxyz'),
    smartCase: c.get<boolean>('search.smartCase', true),
    wrapAround: c.get<boolean>('search.wrapAround', true),
    scrolloff: c.get<number>('scrolloff', 5),
    keymapOverrides: c.get<Record<string, Record<string, unknown>>>('keys', {}),
    shell: c.get<string[]>('shell', []),
    notebookEscapeQuitsEdit: c.get<boolean>('notebook.escapeQuitsCellEdit', true),
    defaultYankRegister: c.get<string>('defaultYankRegister', '"'),
  };
}

async function setContext(key: string, value: unknown): Promise<void> {
  await vscode.commands.executeCommand('setContext', key, value);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const eng = new Engine(readConfig());
  engine = eng;
  registerCommands(eng);
  installCommandLine(eng, context.extensionUri);
  ensureDecorationTypes();
  statusBar = new StatusBar();
  context.subscriptions.push(statusBar);

  const enabledSetting = () => vscode.workspace.getConfiguration('helicode').get<boolean>('enabled', true);
  eng.enabled = enabledSetting();

  let lastMode = '';
  let lastPending = false;
  eng.render = (e) => {
    statusBar?.update(e);
    if (e.mode !== lastMode) {
      lastMode = e.mode;
      void setContext('helicode.mode', e.mode);
    }
    if (e.isPending !== lastPending) {
      lastPending = e.isPending;
      void setContext('helicode.pending', e.isPending);
    }
  };
  await setContext('helicode.active', eng.enabled);
  await setContext('helicode.mode', eng.mode);
  await setContext('helicode.pending', false);

  // tree-sitter runtime (lazy grammar loading happens on first use)
  void ts.init(context.extensionPath);

  // ---- `type` interception -------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('type', async (args: { text: string }) => {
      const ed = vscode.window.activeTextEditor;
      if (!eng.enabled || !ed || !args || typeof args.text !== 'string') {
        return vscode.commands.executeCommand('default:type', args);
      }
      if (process.env.HELICODE_TRACE) console.log(`[helicode] type ${JSON.stringify(args.text)} mode=${eng.mode}`);
      if (eng.mode === 'insert') {
        eng.onInsertTyped(args.text);
        return vscode.commands.executeCommand('default:type', args);
      }
      // Normal/select mode: IME composition can deliver multi-char strings; feed per code point.
      await eng.handleTyped(args.text);
    }),
    vscode.commands.registerCommand('replacePreviousChar', async (args: { text: string; replaceCharCnt: number }) => {
      if (!eng.enabled || eng.mode === 'insert') return vscode.commands.executeCommand('default:replacePreviousChar', args);
      // Ignore IME replacements in normal mode (nothing was inserted).
    }),
    vscode.commands.registerCommand('compositionStart', async () => {
      if (!eng.enabled || eng.mode === 'insert') return vscode.commands.executeCommand('default:compositionStart');
    }),
    vscode.commands.registerCommand('compositionEnd', async () => {
      if (!eng.enabled || eng.mode === 'insert') return vscode.commands.executeCommand('default:compositionEnd');
    }),
  );

  // ---- special keys from package.json keybindings ----------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('helicode.key', async (args: { key: string }) => {
      if (!eng.enabled || !args?.key) return;
      const key = parseKey(args.key);
      // Notebook cells: Escape in normal mode with nothing pending leaves cell editing.
      if (key.code === 'esc' && !key.ctrl && !key.alt && eng.mode === 'normal' && !eng.isPending && eng.config.notebookEscapeQuitsEdit) {
        const ed = vscode.window.activeTextEditor;
        if (ed && ed.document.uri.scheme === 'vscode-notebook-cell') {
          await vscode.commands.executeCommand('notebook.cell.quitEdit');
          return;
        }
      }
      await eng.handleKey(key);
    }),
    vscode.commands.registerCommand('helicode.typeText', async (text: string) => {
      if (!eng.enabled || typeof text !== 'string') return;
      if (eng.mode === 'insert') {
        eng.onInsertTyped(text);
        await eng.insertTextAtCursors(text);
      } else await eng.handleTyped(text);
    }),
    vscode.commands.registerCommand('helicode.command', async (name: string, opts?: { count?: number; register?: string }) => {
      if (!eng.enabled || typeof name !== 'string') return;
      await eng.execute(name, opts ?? {});
    }),
    vscode.commands.registerCommand('helicode.typed', async (line?: string) => {
      const st = eng.active();
      if (!st) return;
      const cx = eng.makeContext(st);
      await eng.runTyped?.(line ?? '', cx);
    }),
    vscode.commands.registerCommand('helicode.toggle', async () => {
      eng.enabled = !eng.enabled;
      await vscode.workspace.getConfiguration('helicode').update('enabled', eng.enabled, vscode.ConfigurationTarget.Global);
      await applyEnabled(eng);
    }),
    vscode.commands.registerCommand('helicode.normalMode', () => {
      eng.cancelPending();
      eng.enterNormalMode();
    }),
    vscode.commands.registerCommand('helicode.showKeymapHelp', async () => {
      const uri = vscode.Uri.joinPath(context.extensionUri, 'docs', 'keymap.md');
      await vscode.commands.executeCommand('markdown.showPreview', uri);
    }),
    vscode.commands.registerCommand('helicode.showLog', () => ts.showLog()),
  );

  // ---- editor / document events --------------------------------------
  const attach = (ed: vscode.TextEditor | undefined) => {
    if (!ed || !eng.enabled) return;
    const st = eng.state(ed);
    st.vs = ed;
    st.refresh();
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      const prev = eng.lastAccessedUri;
      const cur = vscode.window.activeTextEditor?.document.uri;
      if (ed && prev?.toString() !== ed.document.uri.toString()) {
        // remember the document we came from
        eng.lastAccessedUri = lastActiveUri ?? prev;
      }
      lastActiveUri = ed?.document.uri ?? lastActiveUri;
      void cur;
      attach(ed);
      eng.render(eng);
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (!eng.enabled || e.textEditor !== vscode.window.activeTextEditor) return;
      const st = eng.state(e.textEditor);
      if (st.syncFromVscode()) eng.render(eng);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      ts.onDocumentChanged(e);
      if (e.contentChanges.length === 0) return;
      eng.lastModifiedUri = e.document.uri;
      const ed = vscode.window.activeTextEditor;
      if (ed && ed.document === e.document && eng.hasState(ed)) {
        const st = eng.state(ed);
        if (eng.mode === 'insert') st.applyInsertEdits(e.contentChanges);
        else {
          st.lastModification = docFor(e.document).offset(e.contentChanges[0].range.start) + e.contentChanges[0].text.length;
        }
      }
    }),
    vscode.workspace.onDidCloseTextDocument((d) => {
      ts.onDocumentClosed(d);
      eng.jumplist.remove(d.uri);
    }),
    vscode.window.onDidChangeVisibleTextEditors((eds) => {
      for (const ed of eds) if (eng.hasState(ed)) eng.state(ed).decorate();
    }),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (!e.affectsConfiguration('helicode')) return;
      eng.config = readConfig();
      eng.applyKeymapOverrides();
      const enabled = enabledSetting();
      if (enabled !== eng.enabled) {
        eng.enabled = enabled;
        await applyEnabled(eng);
      }
    }),
  );

  let lastActiveUri: vscode.Uri | undefined = vscode.window.activeTextEditor?.document.uri;
  attach(vscode.window.activeTextEditor);
  eng.render(eng);
  ts.log('helicode activated');
}

async function applyEnabled(eng: Engine): Promise<void> {
  await setContext('helicode.active', eng.enabled);
  const ed = vscode.window.activeTextEditor;
  if (!eng.enabled) {
    eng.cancelPending();
    eng.mode = 'normal';
    for (const e of vscode.window.visibleTextEditors) {
      if (eng.hasState(e)) eng.state(e).clearDecorations();
      e.options = { cursorStyle: vscode.TextEditorCursorStyle.Line };
    }
  } else if (ed) {
    eng.state(ed).refresh();
  }
  eng.render(eng);
}

export function deactivate(): void {
  disposeDecorationTypes();
  disposeLabelDecorations();
  disposeSearchDecorations();
  ts.dispose();
  statusBar?.dispose();
  engine = undefined;
}
