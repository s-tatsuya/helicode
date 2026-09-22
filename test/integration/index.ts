/**
 * Integration tests: drive a real VS Code instance through the same entry
 * points the keyboard uses (`type` for printable keys, `helicode.key` for
 * special keys) and assert document text / selections.
 *
 * Run with `npm run test:integration`.
 */
import * as vscode from 'vscode';
import assert from 'node:assert/strict';

type TestFn = () => Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn): void {
  tests.push({ name, fn });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until the built-in git extension can report a diff base for `uri`. */
async function waitForGit(uri: vscode.Uri): Promise<void> {
  const ext = vscode.extensions.getExtension('vscode.git');
  if (!ext) throw new Error('the built-in git extension is not available');
  const api = (ext.isActive ? ext.exports : await ext.activate()).getAPI(1);
  for (let i = 0; i < 60; i++) {
    const repo = api.getRepository(uri);
    if (repo) {
      try {
        await repo.show('HEAD', uri.fsPath);
        await sleep(100);
        return;
      } catch {
        /* keep waiting */
      }
    }
    await sleep(250);
  }
  throw new Error('git repository not ready');
}

async function keys(seq: string): Promise<void> {
  // "<esc>", "<ret>", "<C-w>" etc. are special keys; everything else is typed.
  const re = /<([^>]+)>|([\s\S])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seq)) !== null) {
    if (m[1] !== undefined) await vscode.commands.executeCommand('helicode.key', { key: m[1] });
    else await vscode.commands.executeCommand('helicode.typeText', m[2]);
  }
  await sleep(20);
}

async function open(content: string, language = 'plaintext'): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument({ content, language });
  const ed = await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('helicode.normalMode');
  ed.selection = new vscode.Selection(0, 0, 0, 0);
  await sleep(50);
  return ed;
}

function text(ed: vscode.TextEditor): string {
  return ed.document.getText();
}

function sel(ed: vscode.TextEditor): [number, number][] {
  return ed.selections.map((s) => [ed.document.offsetAt(s.anchor), ed.document.offsetAt(s.active)]);
}

async function closeAll(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

// ---------------------------------------------------------------------------

test('movement and word selection', async () => {
  const ed = await open('hello world foo\nbar baz\n');
  await keys('w');
  assert.deepEqual(sel(ed), [[0, 6]]); // "hello " selected
  await keys('e');
  assert.deepEqual(sel(ed), [[5, 11]]); // " world" (from the cursor on the space to the word end, like Helix)
  await keys('b');
  assert.deepEqual(sel(ed), [[11, 6]]); // backward "world"
  await keys('jl');
  // cursor moved down one line (sticky column 6 -> line 1 col 6) then right
  assert.equal(ed.selection.isEmpty, true);
  assert.equal(ed.selection.active.line, 1);
});

test('insert, append and escape keep Helix selections', async () => {
  const ed = await open('hello\n');
  await keys('axy<esc>');
  assert.equal(text(ed), 'hxyello\n');
  assert.deepEqual(sel(ed), [[0, 3]]); // "hxy" selected, cursor on y
  await keys('gg');
  await keys('iAB<esc>');
  assert.equal(text(ed), 'ABhxyello\n');
  // backward range covering the original char: anchor after 'h', head at 'h' -> VS Code shows an empty cursor at 2
  assert.deepEqual(sel(ed), [[2, 2]]);
});

test('delete, yank, paste and counts', async () => {
  const ed = await open('one two three\n');
  await keys('wd');
  assert.equal(text(ed), 'two three\n');
  await keys('wyP');
  assert.equal(text(ed), 'two two three\n');
  await keys('3l');
  assert.equal(ed.selection.active.character, 3 + 3 + 1 - 1 + 0); // moved 3 right from the paste selection end
});

test('x, X and change on whole lines', async () => {
  const ed = await open('a\nb\nc\n');
  await keys('x');
  assert.deepEqual(sel(ed), [[0, 2]]);
  await keys('x');
  assert.deepEqual(sel(ed), [[0, 4]]);
  await keys('d');
  assert.equal(text(ed), 'c\n');
  await keys('xcZ<esc>');
  assert.equal(text(ed), 'Z\n');
});

test('select mode, collapse and flip', async () => {
  const ed = await open('abc def\n');
  await keys('vee');
  assert.deepEqual(sel(ed), [[0, 7]]);
  await keys('<esc>;');
  assert.equal(ed.selection.isEmpty, true);
  assert.equal(ed.selection.active.character, 6);
});

test('match mode: mi( ma( ms md mr', async () => {
  const ed = await open('call(a, (b), c) end\n');
  await keys('9l'); // on 'b'
  await keys('mi(');
  assert.deepEqual(sel(ed), [[9, 9]]); // "b" (one grapheme -> rendered as a collapsed cursor)
  await keys('2mi('); // cursor still on 'b': second enclosing pair
  assert.equal(text(ed).slice(5, 14), 'a, (b), c');
  assert.deepEqual(sel(ed), [[5, 14]]);
  await keys('ma(');
  assert.deepEqual(sel(ed), [[4, 15]]); // "(a, (b), c)"
  await keys('gg');
  await keys('9l');
  await keys('ma(');
  assert.deepEqual(sel(ed), [[8, 11]]); // "(b)"
  await keys('gg');
  await keys('9l');
  await keys('2mi(');
  await keys('ms[');
  assert.equal(text(ed), 'call([a, (b), c]) end\n');
  await keys('md[');
  assert.equal(text(ed), 'call(a, (b), c) end\n');
  await keys('gg');
  await keys('9l');
  await keys('mr({'); // closest pair around 'b'
  assert.equal(text(ed), 'call(a, {b}, c) end\n');
  await keys('mr({'); // the closest remaining ( ) pair is now the outer one
  assert.equal(text(ed), 'call{a, {b}, c} end\n');
});

test('mm matches brackets (plaintext fallback)', async () => {
  const ed = await open('(a[b]c)\n');
  await keys('mm');
  assert.equal(ed.selection.active.character, 6);
});

test('search, select regex and multiple cursors', async () => {
  const ed = await open('foo bar\nfoo baz\n');
  await keys('%');
  assert.deepEqual(sel(ed), [[0, 16]]);
  // `s` opens a QuickPick prompt; open it without awaiting, then cancel it.
  void keys('s');
  await sleep(200);
  await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
  await sleep(100);
  assert.deepEqual(sel(ed), [[0, 16]]);
  // C copies the selection to the next line
  await keys('gg');
  await keys('C');
  assert.equal(ed.selections.length, 2);
  await keys('cX<esc>');
  assert.equal(text(ed), 'Xoo bar\nXoo baz\n');
});

test('increment / decrement', async () => {
  const ed = await open('x = 41\n');
  await keys('gl');
  await keys('<C-a>');
  assert.equal(text(ed), 'x = 42\n');
  await keys('5<C-x>');
  assert.equal(text(ed), 'x = 37\n');
});

test('registers and :w through the command line', async () => {
  const ed = await open('abc\n');
  await keys('"ayl"ap');
  assert.equal(text(ed), 'abac\n'); // pasted after the selection on 'b'
  await vscode.commands.executeCommand('helicode.typed', 'echo hello');
  await vscode.commands.executeCommand('helicode.typed', 'sort');
  assert.equal(text(ed), 'abac\n');
});

test('macros and repeat', async () => {
  const ed = await open('a\nb\nc\n');
  await keys('Qghi-<esc>jQ');
  assert.equal(text(ed), '-a\nb\nc\n');
  await keys('2q');
  assert.equal(text(ed), '-a\n-b\n-c\n');
});

test('join and indent', async () => {
  const ed = await open('a\n  b\nc\n');
  await keys('xxJ');
  assert.equal(text(ed), 'a b\nc\n');
  await keys('>');
  assert.match(text(ed), /^(\t| +)a b\n/);
});

test('tree-sitter textobjects in TypeScript', async () => {
  const ed = await open('function f(a: number, b: string) {\n  return a;\n}\n', 'typescript');
  await keys('j');
  await keys('mif');
  assert.equal(text(ed).slice(sel(ed)[0][0], sel(ed)[0][1]).trim(), '{\n  return a;\n}');
  await keys('gg');
  await keys('12l');
  await keys('mia');
  assert.equal(text(ed).slice(Math.min(...sel(ed)[0]), Math.max(...sel(ed)[0])), 'a: number');
  await keys(']a');
  assert.equal(text(ed).slice(Math.min(...sel(ed)[0]), Math.max(...sel(ed)[0])), 'b: string');
});

test('jump labels gw', async () => {
  const ed = await open('alpha beta gamma\n');
  await keys('gwab');
  // "ab" is the second label: labels alternate forward/backward from the cursor
  assert.notEqual(ed.selection.active.character, 0);
});

test('undo: one insert session is one step', async () => {
  const ed = await open('start\n');
  await keys('A one two three<esc>');
  assert.equal(text(ed), 'start one two three\n');
  await keys('u');
  assert.equal(text(ed), 'start\n', 'a whole insert session undoes at once');
  await keys('U');
  assert.equal(text(ed), 'start one two three\n');
});

test('undo: one command is one step, and the selection is restored', async () => {
  const ed = await open('a b c d\n');
  await keys('wd'); // `w` selects "a ", `d` deletes it
  assert.equal(text(ed), 'b c d\n');
  await keys('wd');
  assert.equal(text(ed), 'c d\n');
  await keys('u');
  assert.equal(text(ed), 'b c d\n');
  assert.deepEqual(sel(ed), [[0, 2]], 'the selection the command ran on comes back');
  await keys('u');
  assert.equal(text(ed), 'a b c d\n');
  await keys('uu');
  assert.equal(text(ed), 'a b c d\n', 'undo stops at the oldest change');
  await keys('UU');
  assert.equal(text(ed), 'c d\n');
});

test('undo: counts and Alt-u / Alt-U', async () => {
  const ed = await open('x\n');
  await keys('A1<esc>A2<esc>A3<esc>');
  assert.equal(text(ed), 'x123\n');
  await keys('3u');
  assert.equal(text(ed), 'x\n');
  await keys('2<A-U>');
  assert.equal(text(ed), 'x12\n');
  await keys('<A-u>');
  assert.equal(text(ed), 'x1\n');
});

test('undo: a macro replay is one step', async () => {
  const ed = await open('a\nb\nc\n');
  await keys('QxdQ'); // record: select line, delete
  assert.equal(text(ed), 'b\nc\n');
  await keys('q');
  assert.equal(text(ed), 'c\n');
  await keys('u');
  assert.equal(text(ed), 'b\nc\n', 'the replay undoes as a single step');
});

test(':earlier and :later accept step counts', async () => {
  const ed = await open('v\n');
  await keys('A1<esc>A2<esc>');
  assert.equal(text(ed), 'v12\n');
  await vscode.commands.executeCommand('helicode.typed', 'earlier 2');
  await sleep(50);
  assert.equal(text(ed), 'v\n');
  await vscode.commands.executeCommand('helicode.typed', 'later 2');
  await sleep(50);
  assert.equal(text(ed), 'v12\n');
});

test('named registers round-trip through yank and paste', async () => {
  const ed = await open('hello world\n');
  await keys('w'); // select "hello "
  await keys('"ay'); // yank it into register a
  await keys('"ap'); // paste register a after the selection
  assert.equal(text(ed), 'hello hello world\n');
  await keys('u');
  assert.equal(text(ed), 'hello world\n');
});

test('window mode reaches Corral commands without Corral installed', async () => {
  await open('x\n');
  // corral_* commands report a status error instead of throwing when Corral is absent.
  await vscode.commands.executeCommand('helicode.command', 'corral_new_terminal');
  await sleep(50);
  // focus_pane_1 always works (built-in editor group command).
  await vscode.commands.executeCommand('helicode.command', 'focus_pane_1');
  await sleep(50);
  assert.ok(true);
});

test('tree-sitter: html element textobject (grammar from the manifest)', async () => {
  const ed = await open('<div class="a"><span>text</span></div>\n', 'html');
  await keys('22l');
  await keys('max');
  const picked = text(ed).slice(Math.min(...sel(ed)[0]), Math.max(...sel(ed)[0]));
  assert.equal(picked, '<span>text</span>');
});

test('tree-sitter: json entry textobject (grammar from the manifest)', async () => {
  const ed = await open('{\n  "a": [1, 2],\n  "b": 3\n}\n', 'json');
  await keys('j3l');
  await keys('mae');
  const picked = text(ed).slice(Math.min(...sel(ed)[0]), Math.max(...sel(ed)[0]));
  assert.equal(picked, '"a": [1, 2]');
});

test('tree-sitter: markdown section textobject', async () => {
  const ed = await open('# Title\n\nbody text\n\n## Sub\n\nmore\n', 'markdown');
  await keys('2j');
  await keys('mat');
  const picked = text(ed).slice(Math.min(...sel(ed)[0]), Math.max(...sel(ed)[0]));
  assert.match(picked, /^# Title/);
});

test('git hunks: mig selects the hunk and ]g / [g move between hunks', async () => {
  const ext = vscode.extensions.getExtension('s-tatsuya.helicode')!;
  const uri = vscode.Uri.joinPath(ext.extensionUri, 'README.md');
  const doc = await vscode.workspace.openTextDocument(uri);
  const ed = await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('helicode.normalMode');
  ed.selection = new vscode.Selection(0, 0, 0, 0);
  await sleep(50);
  try {
    // Add a line of our own; the working tree may already differ from HEAD.
    await keys('ozz HELICODE TEST LINE<esc>');
    await waitForGit(uri);
    let marker = -1;
    for (let i = 0; i < ed.document.lineCount; i++) {
      if (ed.document.lineAt(i).text.includes('HELICODE TEST LINE')) {
        marker = i;
        break;
      }
    }
    assert.ok(marker >= 0, 'the marker line was inserted');
    await vscode.commands.executeCommand('helicode.typed', String(marker + 1));
    await sleep(50);
    assert.equal(ed.selection.active.line, marker);
    await keys('mig');
    const picked = text(ed).slice(Math.min(...sel(ed)[0]), Math.max(...sel(ed)[0]));
    assert.match(picked, /HELICODE TEST LINE/, `mig should select the hunk, got ${JSON.stringify(picked)}`);
    // ]g moves forward to another hunk (or stays put when this is the only one).
    await keys(';'); // collapse first
    const before = ed.selection.active.line;
    await keys(']g');
    assert.ok(ed.selection.active.line >= before, ']g does not move backwards');
    await keys('[g');
    assert.ok(ed.selection.active.line <= ed.document.lineCount, '[g stays in the document');
  } finally {
    await vscode.commands.executeCommand('workbench.action.files.revert');
    await sleep(100);
  }
});

test('infobox: a minor mode still completes while the popup is open', async () => {
  const cfg = vscode.workspace.getConfiguration('helicode');
  await cfg.update('autoInfoDelay', 0, vscode.ConfigurationTarget.Global);
  try {
    const ed = await open('alpha\nbeta\ngamma\n');
    await keys('g');
    await sleep(120); // the popup is open and owns the keyboard
    await vscode.commands.executeCommand('helicode.typeText', 'e');
    await sleep(120);
    assert.equal(ed.selection.active.line, 2, 'ge reached the last line through the infobox');
  } finally {
    await cfg.update('autoInfoDelay', undefined, vscode.ConfigurationTarget.Global);
    await sleep(50);
  }
});

test('infobox: entries and title describe the pending minor mode', async () => {
  await open('x\n');
  await keys('m');
  const info = (await vscode.commands.executeCommand('helicode.debugPending')) as { title?: string; entries?: { key: string; value: string }[] } | undefined;
  assert.ok(info, 'helicode.debugPending returns the pending state');
  assert.match(info!.title ?? '', /m\s+Match/);
  const keysOffered = (info!.entries ?? []).map((e) => e.key);
  for (const k of ['m', 's', 'r', 'd', 'a', 'i']) assert.ok(keysOffered.includes(k), `match mode offers ${k}`);
  await keys('<esc>');
});

test('passthrough keys are exposed as context keys', async () => {
  const cfg = vscode.workspace.getConfiguration('helicode');
  await cfg.update('passthroughKeys', ['ctrl+f'], vscode.ConfigurationTarget.Global);
  await sleep(200);
  try {
    const active = (await vscode.commands.executeCommand('helicode.debugPassthrough')) as string[];
    assert.deepEqual(active, ['helicode.passCtrlF']);
  } finally {
    await cfg.update('passthroughKeys', undefined, vscode.ConfigurationTarget.Global);
    await sleep(100);
  }
});


test('select mode extends with h j k l', async () => {
  const ed = await open('abcd\nefgh\nijkl\n');
  await keys('j'); // line 1, col 0
  await keys('v');
  const anchor = sel(ed)[0][0];
  assert.equal(anchor, 5, 'v keeps the cursor range (anchor at the start of line 1)');
  await keys('l');
  assert.deepEqual(sel(ed), [[5, 7]], 'l extends right');
  await keys('j');
  assert.deepEqual(sel(ed), [[5, 12]], 'j extends down');
  await keys('k');
  assert.equal(sel(ed)[0][0], 5, 'k keeps the anchor');
  assert.equal(ed.selection.isEmpty, false, 'k does not collapse the selection');
  await keys('h');
  assert.equal(sel(ed)[0][0], 5, 'h keeps the anchor');
});

test('select mode extends with j/k when word wrap is on', async () => {
  const cfg = vscode.workspace.getConfiguration('editor');
  await cfg.update('wordWrap', 'on', vscode.ConfigurationTarget.Global);
  await sleep(200);
  try {
    const ed = await open('abcd\nefgh\nijkl\n');
    await keys('j'); // line 1, col 0
    await keys('v');
    assert.equal(sel(ed)[0][0], 5, 'v keeps the anchor at the start of line 1');
    await keys('j');
    assert.deepEqual(sel(ed), [[5, 11]], 'j extends down (wrapped-line path)');
    await keys('k');
    assert.equal(sel(ed)[0][0], 5, 'k keeps the anchor');
  } finally {
    await cfg.update('wordWrap', undefined, vscode.ConfigurationTarget.Global);
    await sleep(100);
  }
});

test('markdown wraps by default: v + j keeps the selection', async () => {
  // VS Code's built-in markdown extension contributes
  // "[markdown]": { "editor.wordWrap": "on" }, so every .md file takes the
  // wrapped-line path even when the user configured nothing.
  const ed = await open('abcd\nefgh\nijkl\n', 'markdown');
  assert.equal(vscode.workspace.getConfiguration('editor', ed.document).get('wordWrap'), 'on', 'markdown wraps out of the box');
  await keys('j');
  await keys('v');
  await keys('j');
  assert.deepEqual(sel(ed), [[5, 11]], 'the anchor from v survives');
});

test('select mode survives keys typed back to back', async () => {
  // VS Code reports selection changes back asynchronously; when the keys come
  // faster than the echoes, an echo of an earlier (one-grapheme, therefore
  // empty) selection must not replace the range being extended.
  const ed = await open('abcdefgh\nijklmnop\nqrstuvwx\n');
  await keys('v');
  await Promise.all(['l', 'l', 'j', 'l'].map((k) => vscode.commands.executeCommand('helicode.typeText', k)));
  await sleep(150);
  assert.deepEqual(sel(ed), [[0, 13]], 'the anchor stays at 0 while the head moves');
});

test('j/k keep the sticky column across short lines when word wrap is on', async () => {
  const cfg = vscode.workspace.getConfiguration('editor');
  await cfg.update('wordWrap', 'on', vscode.ConfigurationTarget.Global);
  await sleep(200);
  try {
    const ed = await open('abcdefgh\nx\nabcdefgh\n');
    await keys('4l');
    assert.equal(ed.selection.active.character, 4);
    await keys('j'); // line 1 is "x": the cursor has to fall back to column 0/1
    assert.equal(ed.selection.active.line, 1);
    await keys('j');
    assert.equal(ed.selection.active.line, 2);
    assert.equal(ed.selection.active.character, 4, 'the column from line 0 comes back on line 2');
    await keys('gg');
    await keys('4l');
    await keys('v');
    await keys('j');
    await keys('j');
    // select mode: anchor on line 0 col 4, head one past the cursor on line 2 col 4
    assert.deepEqual(sel(ed), [[4, 16]], 'extending down keeps the column too');
  } finally {
    await cfg.update('wordWrap', undefined, vscode.ConfigurationTarget.Global);
    await sleep(100);
  }
});

// ---------------------------------------------------------------------------

export async function run(): Promise<void> {
  await vscode.extensions.getExtension('s-tatsuya.helicode')?.activate();
  await sleep(300);
  let failed = 0;
  for (const t of tests) {
    try {
      await Promise.race([t.fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]);
      console.log(`ok - ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`not ok - ${t.name}\n${e instanceof Error ? e.stack : String(e)}`);
    } finally {
      await closeAll();
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) throw new Error(`${failed} integration test(s) failed`);
}
