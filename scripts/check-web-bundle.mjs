// Smoke test for dist/extension-web.js: loads the web bundle with a stubbed
// `vscode` module and no Node globals in scope, then activates and deactivates
// it. Catches top-level `process` / `require('fs')` usage and import errors
// that would only show up on vscode.dev.
//
//   node scripts/check-web-bundle.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';

const bundle = readFileSync('dist/extension-web.js', 'utf8');

// ---- a minimal `vscode` stub -------------------------------------------
const noop = () => {};
const disposable = { dispose: noop };
const event = () => disposable;
const registered = new Set();
const contexts = new Map();

class Uri {
  constructor(scheme, p) {
    this.scheme = scheme;
    this.path = p;
    this.fsPath = p;
  }
  static file(p) {
    return new Uri('file', p);
  }
  static parse(s) {
    return new Uri('https', s);
  }
  static joinPath(base, ...parts) {
    return new Uri(base.scheme, path.posix.join(base.path, ...parts));
  }
  toString() {
    return `${this.scheme}://${this.path}`;
  }
  with(o) {
    return new Uri(o.scheme ?? this.scheme, this.path);
  }
}

const files = new Map();
const vscode = {
  Uri,
  EndOfLine: { LF: 1, CRLF: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  TextEditorCursorStyle: { Line: 1, Block: 2, LineThin: 3 },
  TextEditorRevealType: { Default: 0, InCenter: 1, AtTop: 3 },
  DecorationRangeBehavior: { ClosedClosed: 1 },
  StatusBarAlignment: { Left: 1 },
  ViewColumn: { Beside: -2 },
  ProgressLocation: { Notification: 15 },
  FileType: { Directory: 2 },
  ThemeColor: class {},
  Position: class {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  },
  Range: class {},
  Selection: class {},
  MarkdownString: class {},
  EventEmitter: class {
    constructor() {
      this.event = event;
    }
    fire() {}
    dispose() {}
  },
  env: { language: 'en', clipboard: { readText: async () => '', writeText: async () => {} } },
  extensions: {
    all: [],
    getExtension: () => undefined,
    onDidChange: event,
  },
  commands: {
    registerCommand: (id) => {
      registered.add(id);
      return disposable;
    },
    executeCommand: async (id, key, value) => {
      if (id === 'setContext') contexts.set(key, value);
      return undefined;
    },
    getCommands: async () => [...registered],
  },
  window: {
    activeTextEditor: undefined,
    visibleTextEditors: [],
    createStatusBarItem: () => ({ show: noop, hide: noop, dispose: noop }),
    createOutputChannel: () => ({ appendLine: noop, show: noop, dispose: noop }),
    createTextEditorDecorationType: () => ({ dispose: noop }),
    createQuickPick: () => ({
      onDidChangeValue: event,
      onDidAccept: event,
      onDidHide: event,
      show: noop,
      hide: noop,
      dispose: noop,
      items: [],
    }),
    showQuickPick: async () => undefined,
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    withProgress: async (_o, fn) => fn(),
    onDidChangeActiveTextEditor: event,
    onDidChangeTextEditorSelection: event,
    onDidChangeVisibleTextEditors: event,
    tabGroups: { all: [] },
  },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({ get: (_k, d) => d, update: async () => {} }),
    getWorkspaceFolder: () => undefined,
    asRelativePath: (u) => String(u),
    openTextDocument: async () => ({ getText: () => '', uri: Uri.file('/x') }),
    onDidChangeTextDocument: event,
    onDidOpenTextDocument: event,
    onDidCloseTextDocument: event,
    onDidSaveTextDocument: event,
    onDidChangeConfiguration: event,
    fs: {
      readFile: async (uri) => {
        const v = files.get(uri.path);
        if (v) return v;
        throw new Error(`ENOENT ${uri.path}`);
      },
      readDirectory: async () => [],
      stat: async () => ({}),
      writeFile: async () => {},
      createDirectory: async () => {},
      delete: async () => {},
    },
  },
  languages: { getDiagnostics: () => [], getLanguages: async () => [], setTextDocumentLanguage: async () => {} },
};

// The tree-sitter runtime is fetched through workspace.fs; hand it the real
// wasm so the loader runs the same code path as in the browser.
files.set('/ext/wasm/web-tree-sitter.wasm', new Uint8Array(readFileSync('wasm/web-tree-sitter.wasm')));

// ---- run the bundle in a context without Node globals -------------------
const require_ = createRequire(import.meta.url);
const sandbox = {
  console,
  URL,
  TextDecoder,
  TextEncoder,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  queueMicrotask,
  fetch: async () => {
    throw new Error('network disabled in this smoke test');
  },
  crypto: globalThis.crypto,
  module: { exports: {} },
  require: (id) => {
    if (id === 'vscode') return vscode;
    if (id.startsWith('node:')) throw new Error(`the web bundle must not require ${id} at load time`);
    return require_(id);
  },
};
sandbox.exports = sandbox.module.exports;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

vm.createContext(sandbox);
new vm.Script(bundle, { filename: 'dist/extension-web.js' }).runInContext(sandbox);

const api = sandbox.module.exports;
if (typeof api.activate !== 'function') throw new Error('the web bundle does not export activate()');

const context = {
  extensionUri: Uri.file('/ext'),
  extensionPath: '/ext',
  globalStorageUri: Uri.file('/storage'),
  subscriptions: [],
  globalState: { get: () => undefined, update: async () => {} },
};
await api.activate(context);
// Give the tree-sitter init promise a chance to settle before we tear down.
await new Promise((r) => setTimeout(r, 500));
if (!registered.has('helicode.key')) throw new Error('activate() did not register helicode.key');
if (!registered.has('type')) throw new Error('activate() did not intercept the type command');
if (contexts.get('helicode.active') !== true) throw new Error('activate() did not set the helicode.active context');
if (contexts.get('helicode.mode') !== 'normal') throw new Error(`unexpected initial mode: ${contexts.get('helicode.mode')}`);
api.deactivate();
console.log(`web bundle OK: ${registered.size} commands, ${context.subscriptions.length} subscriptions, ${contexts.size} context keys`);
