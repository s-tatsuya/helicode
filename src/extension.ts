/**
 * Helicode: Helix keybindings for VS Code.
 */
import * as vscode from 'vscode';
import { Engine, EngineConfig } from './engine/engine';
import { registerCommands } from './engine/commands';
import { disposeDecorationTypes, ensureDecorationTypes } from './engine/editor-state';
import { StatusBar } from './vscode/statusbar';
import { Infobox } from './vscode/infobox';
import { installCommandLine } from './vscode/cmdline';
import { disposeLabelDecorations } from './vscode/labels';
import { disposeSearchDecorations } from './engine/commands/search';
import { promptKey } from './vscode/prompt';
import { readHelixConfig, importHelixConfig } from './vscode/helix-config';
import { resetCorralCache } from './engine/commands/corral';
import { clearDiffCache } from './vscode/git';
import { parseKey } from './core/keys';
import * as ts from './treesitter';
import { docFor } from './vscode/document';
import { trace } from './platform';

let engine: Engine | undefined;
let statusBar: StatusBar | undefined;
let infobox: Infobox | undefined;

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
    undoMode: c.get<'helix' | 'vscode'>('undo', 'helix'),
    autoInfo: c.get<boolean>('autoInfo', true),
    autoInfoDelay: c.get<number>('autoInfoDelay', 400),
  };
}

async function setContext(key: string, value: unknown): Promise<void> {
  await vscode.commands.executeCommand('setContext', key, value);
}

/**
 * Keys the user asked Helicode to leave to VS Code
 * (`helicode.passthroughKeys: ["ctrl+w", "ctrl+f"]`). Every generated
 * keybinding is guarded with `!helicode.passCtrlW` and friends.
 */
export function passthroughContextKey(key: string): string {
  const camel = key
    .toLowerCase()
    .split('+')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
  return `helicode.pass${camel.replace(/[^A-Za-z0-9]/g, '')}`;
}

/** Context keys currently set to true, so we can clear them when the setting changes. */
let passthroughSet: string[] = [];

async function applyPassthrough(): Promise<void> {
  const keys = vscode.workspace.getConfiguration('helicode').get<string[]>('passthroughKeys', []) ?? [];
  const wanted = keys.map(passthroughContextKey);
  for (const ctx of passthroughSet) if (!wanted.includes(ctx)) await setContext(ctx, false);
  for (const ctx of wanted) await setContext(ctx, true);
  passthroughSet = wanted;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const eng = new Engine(readConfig());
  engine = eng;
  registerCommands(eng);
  installCommandLine(eng, context.extensionUri);
  ensureDecorationTypes();
  statusBar = new StatusBar();
  infobox = new Infobox(eng);
  context.subscriptions.push(statusBar, infobox);

  const enabledSetting = () => vscode.workspace.getConfiguration('helicode').get<boolean>('enabled', true);
  eng.enabled = enabledSetting();

  let lastMode = '';
  let lastPending = false;
  eng.render = (e) => {
    statusBar?.update(e);
    infobox?.update();
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
  await setContext('helicode.infobox', false);
  await setContext('helicode.promptOpen', false);
  await applyPassthrough();

  // tree-sitter runtime (lazy grammar loading happens on first use)
  void ts.init(context.extensionUri, context.globalStorageUri);

  // Import a Helix config.toml the first time, when asked to.
  void maybeImportHelixConfig(eng, context);

  // ---- `type` interception -------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('type', async (args: { text: string }) => {
      const ed = vscode.window.activeTextEditor;
      if (!eng.enabled || !ed || !args || typeof args.text !== 'string') {
        return vscode.commands.executeCommand('default:type', args);
      }
      if (trace) console.log(`[helicode] type ${JSON.stringify(args.text)} mode=${eng.mode}`);
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
    // `Ctrl-r` inside a Helicode prompt (search, `:`, shell) inserts a register.
    vscode.commands.registerCommand('helicode.promptKey', (args: { key: string }) => {
      if (args?.key) promptKey(args.key);
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
    vscode.commands.registerCommand('helicode.importHelixConfig', async () => {
      const config = await readHelixConfig();
      if (!config) {
        void vscode.window.showWarningMessage('Helicode: no Helix config.toml found (looked in .helix/, $XDG_CONFIG_HOME/helix and ~/.config/helix).');
        return;
      }
      const res = await importHelixConfig(config, vscode.ConfigurationTarget.Global);
      eng.config = readConfig();
      eng.applyKeymapOverrides();
      void vscode.window.showInformationMessage(`Helicode: imported ${res.keyCount} bindings and ${res.options.length} options from ${res.uri.fsPath}.`);
    }),
    vscode.commands.registerCommand('helicode.showLog', () => ts.showLog()),
    // Introspection used by the integration tests (and handy when debugging a keymap).
    vscode.commands.registerCommand('helicode.debugPending', () => ({ title: eng.pendingTitle(), entries: eng.pendingEntries() })),
    vscode.commands.registerCommand('helicode.debugPassthrough', () => [...passthroughSet]),
  );

  // ---- editor / document events --------------------------------------
  const attach = (ed: vscode.TextEditor | undefined) => {
    if (!ed || !eng.enabled) return;
    const st = eng.state(ed);
    st.vs = ed;
    eng.history.track(ed.document, st.selection);
    st.refresh();
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      const prev = eng.lastAccessedUri;
      if (ed && prev?.toString() !== ed.document.uri.toString()) {
        // remember the document we came from
        eng.lastAccessedUri = lastActiveUri ?? prev;
      }
      lastActiveUri = ed?.document.uri ?? lastActiveUri;
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
      clearDiffCache(e.document.uri);
      const ed = vscode.window.activeTextEditor;
      const active = ed && ed.document === e.document;
      eng.history.onDidChange(e, active && eng.hasState(ed) ? eng.state(ed).selection : undefined);
      if (active && eng.hasState(ed)) {
        const st = eng.state(ed);
        if (eng.mode === 'insert') st.applyInsertEdits(e.contentChanges);
        else {
          st.lastModification = docFor(e.document).offset(e.contentChanges[0].range.start) + e.contentChanges[0].text.length;
        }
      }
    }),
    vscode.workspace.onDidOpenTextDocument((d) => {
      if (eng.enabled) eng.history.track(d);
    }),
    vscode.workspace.onDidCloseTextDocument((d) => {
      ts.onDocumentClosed(d);
      eng.jumplist.remove(d.uri);
      eng.history.forget(d);
      clearDiffCache(d.uri);
    }),
    vscode.workspace.onDidSaveTextDocument((d) => clearDiffCache(d.uri)),
    vscode.extensions.onDidChange(() => resetCorralCache()),
    vscode.window.onDidChangeVisibleTextEditors((eds) => {
      for (const ed of eds) if (eng.hasState(ed)) eng.state(ed).decorate();
    }),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('helicode.treeSitter')) ts.resetLanguage();
      if (!e.affectsConfiguration('helicode')) return;
      eng.config = readConfig();
      eng.history.mode = eng.config.undoMode;
      eng.applyKeymapOverrides();
      await applyPassthrough();
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

/**
 * On the first run, offer to import an existing Helix `config.toml`
 * (`helicode.importHelixConfig`: `ask` | `always` | `never`).
 */
async function maybeImportHelixConfig(eng: Engine, context: vscode.ExtensionContext): Promise<void> {
  const mode = vscode.workspace.getConfiguration('helicode').get<'ask' | 'always' | 'never'>('importHelixConfig', 'ask');
  if (mode === 'never') return;
  const alreadyAsked = context.globalState.get<boolean>('helicode.askedHelixConfig', false);
  if (mode === 'ask' && alreadyAsked) return;
  const config = await readHelixConfig();
  if (!config) return;
  if (mode === 'ask') {
    await context.globalState.update('helicode.askedHelixConfig', true);
    const answer = await vscode.window.showInformationMessage(
      `Helicode found a Helix config at ${config.uri.fsPath}. Import its keys and options?`,
      'Import',
      'Keys only',
      'Not now',
    );
    if (answer !== 'Import' && answer !== 'Keys only') return;
    const res = await importHelixConfig(config, vscode.ConfigurationTarget.Global, { keysOnly: answer === 'Keys only' });
    eng.config = { ...eng.config, keymapOverrides: vscode.workspace.getConfiguration('helicode').get('keys', {}) };
    eng.applyKeymapOverrides();
    void vscode.window.showInformationMessage(`Helicode: imported ${res.keyCount} bindings from ${res.uri.fsPath}.`);
    return;
  }
  await importHelixConfig(config, vscode.ConfigurationTarget.Global);
  eng.config = { ...eng.config, keymapOverrides: vscode.workspace.getConfiguration('helicode').get('keys', {}) };
  eng.applyKeymapOverrides();
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
  infobox?.dispose();
  engine = undefined;
}
