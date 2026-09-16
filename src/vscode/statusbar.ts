/**
 * Status bar: mode indicator, pending keys, selection count and messages.
 */
import * as vscode from 'vscode';
import { Engine } from '../engine/engine';

const MODE_LABEL: Record<string, string> = { normal: 'NOR', insert: 'INS', select: 'SEL' };

export class StatusBar {
  private readonly modeItem: vscode.StatusBarItem;
  private readonly infoItem: vscode.StatusBarItem;
  private readonly messageItem: vscode.StatusBarItem;
  private messageTimer: NodeJS.Timeout | undefined;

  constructor() {
    this.modeItem = vscode.window.createStatusBarItem('helicode.mode', vscode.StatusBarAlignment.Left, 10000);
    this.modeItem.name = 'Helicode mode';
    this.modeItem.command = 'helicode.showKeymapHelp';
    this.infoItem = vscode.window.createStatusBarItem('helicode.info', vscode.StatusBarAlignment.Left, 9999);
    this.infoItem.name = 'Helicode pending keys';
    this.messageItem = vscode.window.createStatusBarItem('helicode.message', vscode.StatusBarAlignment.Left, 9998);
    this.messageItem.name = 'Helicode message';
  }

  update(engine: Engine): void {
    if (!engine.enabled) {
      this.modeItem.hide();
      this.infoItem.hide();
      this.messageItem.hide();
      return;
    }
    const st = engine.active();
    const mode = MODE_LABEL[engine.mode] ?? engine.mode.toUpperCase();
    const sels = st ? st.selection.ranges.length : 0;
    this.modeItem.text = `$(symbol-keyword) ${mode}`;
    this.modeItem.tooltip = `Helicode: ${engine.mode} mode`;
    this.modeItem.backgroundColor = engine.mode === 'insert' ? new vscode.ThemeColor('statusBarItem.warningBackground') : engine.mode === 'select' ? new vscode.ThemeColor('statusBarItem.prominentBackground') : undefined;
    this.modeItem.show();

    const parts: string[] = [];
    if (engine.macroRecording) parts.push(`[recording @${engine.macroRecording.register}]`);
    const pending = engine.pendingDescription();
    if (pending) parts.push(pending);
    if (sels > 1) parts.push(`${sels} sels`);
    const entries = engine.pendingEntries();
    if (entries && entries.length) {
      this.infoItem.tooltip = new vscode.MarkdownString(entries.map((e) => `\`${e.key}\` ${e.value}`).join('  \n'));
    } else this.infoItem.tooltip = undefined;
    if (parts.length) {
      this.infoItem.text = parts.join('  ');
      this.infoItem.show();
    } else this.infoItem.hide();

    const msg = engine.statusMessage;
    if (msg) {
      this.messageItem.text = msg.error ? `$(error) ${msg.text}` : msg.text;
      this.messageItem.color = msg.error ? new vscode.ThemeColor('statusBarItem.errorForeground') : undefined;
      this.messageItem.show();
      if (this.messageTimer) clearTimeout(this.messageTimer);
      this.messageTimer = setTimeout(() => this.messageItem.hide(), 8000);
    } else {
      this.messageItem.hide();
    }
  }

  dispose(): void {
    this.modeItem.dispose();
    this.infoItem.dispose();
    this.messageItem.dispose();
    if (this.messageTimer) clearTimeout(this.messageTimer);
  }
}
