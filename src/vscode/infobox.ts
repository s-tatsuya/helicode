/**
 * Which-key style infobox (Helix `auto-info`): while a minor mode (`g`, `m`,
 * `Space`, `Ctrl-w`, `[`, `]`, `z`) or a key prompt (`mi`, `ms`, `"`) waits
 * for the next key, a QuickPick lists the available keys. Keys typed into the
 * picker are dispatched to the engine exactly as if typed in the editor;
 * modifier keys reach it through the `helicode.infobox` context in
 * package.json keybindings. Escape cancels the pending keys, Enter runs the
 * highlighted entry.
 */
import * as vscode from 'vscode';
import { Engine, KeyEntry } from '../engine/engine';
import { parseKey } from '../core/keys';

interface Item extends vscode.QuickPickItem {
  key: string;
}

function signatureOf(title: string, entries: KeyEntry[]): string {
  return title + '|' + entries.map((e) => e.key + '=' + e.value).join(',');
}

export class Infobox implements vscode.Disposable {
  private qp: vscode.QuickPick<Item> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private hidingProgrammatically = false;
  private shownFor = '';

  constructor(private readonly engine: Engine) {}

  /** Called on every render. */
  update(): void {
    const engine = this.engine;
    const cfg = engine.config;
    const entries = engine.enabled && cfg.autoInfo && engine.infoboxPending ? engine.pendingEntries() : undefined;
    if (!entries || entries.length === 0) {
      this.cancelTimer();
      this.hide();
      return;
    }
    const title = engine.pendingTitle() ?? '';
    const signature = signatureOf(title, entries);
    if (this.qp) {
      if (signature !== this.shownFor) this.fill(this.qp, title, entries);
      return;
    }
    if (this.timer && this.shownFor === signature) return;
    this.cancelTimer();
    this.shownFor = signature;
    const show = () => {
      this.timer = undefined;
      // Re-check: the sequence may have completed while we waited.
      if (!engine.infoboxPending || !engine.enabled) return;
      const now = engine.pendingEntries();
      if (!now || !now.length) return;
      this.show(engine.pendingTitle() ?? '', now);
    };
    if (cfg.autoInfoDelay <= 0) show();
    else this.timer = setTimeout(show, cfg.autoInfoDelay);
  }

  private fill(qp: vscode.QuickPick<Item>, title: string, entries: KeyEntry[]): void {
    qp.title = title || undefined;
    qp.items = entries.map((e) => ({ label: e.key, description: e.value, key: e.key, alwaysShow: true }));
    this.shownFor = signatureOf(title, entries);
  }

  private show(title: string, entries: KeyEntry[]): void {
    const qp = vscode.window.createQuickPick<Item>();
    this.qp = qp;
    qp.placeholder = 'press a key (Esc cancels, Enter runs the highlighted entry)';
    qp.matchOnDescription = true;
    qp.ignoreFocusOut = false;
    this.fill(qp, title, entries);
    let accepting = false;
    qp.onDidChangeValue((v) => {
      if (!v) return;
      qp.value = '';
      void this.engine.handleTyped(v);
    });
    qp.onDidAccept(() => {
      const item = qp.selectedItems[0] ?? qp.activeItems[0];
      if (!item) return;
      accepting = true;
      void this.engine.handleKey(parseKey(item.key));
    });
    qp.onDidHide(() => {
      const wasProgrammatic = this.hidingProgrammatically;
      qp.dispose();
      if (this.qp === qp) this.qp = undefined;
      void vscode.commands.executeCommand('setContext', 'helicode.infobox', false);
      if (!wasProgrammatic && !accepting && this.engine.infoboxPending) this.engine.cancelPending();
    });
    void vscode.commands.executeCommand('setContext', 'helicode.infobox', true);
    qp.show();
  }

  private hide(): void {
    if (!this.qp) return;
    this.hidingProgrammatically = true;
    try {
      this.qp.hide();
    } finally {
      this.hidingProgrammatically = false;
    }
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.shownFor = '';
  }

  dispose(): void {
    this.cancelTimer();
    this.hide();
  }
}
