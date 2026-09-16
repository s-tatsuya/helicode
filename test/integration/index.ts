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
