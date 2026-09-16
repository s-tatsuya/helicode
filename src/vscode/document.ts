/**
 * TextDoc adapter over vscode.TextDocument with per-version caching.
 */
import * as vscode from 'vscode';
import { TextDoc } from '../core/text';

export class VsDoc implements TextDoc {
  private cachedVersion = -1;
  private cachedText = '';
  private starts: number[] = [0];

  constructor(readonly document: vscode.TextDocument) {}

  private refresh(): void {
    if (this.cachedVersion === this.document.version) return;
    this.cachedVersion = this.document.version;
    this.cachedText = this.document.getText();
    const starts = [0];
    const t = this.cachedText;
    for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10) starts.push(i + 1);
    this.starts = starts;
  }

  get text(): string {
    this.refresh();
    return this.cachedText;
  }
  get length(): number {
    this.refresh();
    return this.cachedText.length;
  }
  get lineCount(): number {
    this.refresh();
    return this.starts.length;
  }
  get eol(): '\n' | '\r\n' {
    return this.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  }
  lineStart(line: number): number {
    this.refresh();
    if (line >= this.starts.length) return this.cachedText.length;
    if (line < 0) return 0;
    return this.starts[line];
  }
  lineOf(offset: number): number {
    this.refresh();
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  position(offset: number): vscode.Position {
    const line = this.lineOf(Math.max(0, Math.min(offset, this.length)));
    return new vscode.Position(line, Math.max(0, Math.min(offset, this.length)) - this.lineStart(line));
  }
  offset(pos: vscode.Position): number {
    this.refresh();
    const line = Math.min(pos.line, this.starts.length - 1);
    const start = this.starts[line];
    const next = line + 1 < this.starts.length ? this.starts[line + 1] : this.cachedText.length;
    return Math.min(start + pos.character, next);
  }
}

const docs = new WeakMap<vscode.TextDocument, VsDoc>();

export function docFor(document: vscode.TextDocument): VsDoc {
  let d = docs.get(document);
  if (!d) {
    d = new VsDoc(document);
    docs.set(document, d);
  }
  return d;
}
