import assert from 'assert';
import {
  detectStub,
  bodyLines,
  stubGhost,
  trimOverlap,
  looksLikeSignature,
  detectInstruction,
  commentText,
  enclosingFunction,
  bodyReplacement,
  BodyStreamer,
} from '../src/stub';

let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('ok', name);
};
const at = (src: string) => ({ text: src.replace('|', ''), off: src.indexOf('|') });

t('signature detection', () => {
  assert(looksLikeSignature('function isPrime(n: number): boolean {', 'typescript'));
  assert(looksLikeSignature('  export async function load(url) {', 'javascript'));
  assert(looksLikeSignature('const add = (a, b) => {', 'javascript'));
  assert(looksLikeSignature('public static int Sum(int[] xs) {', 'csharp'));
  assert(looksLikeSignature('fn main() {', 'rust'));
  assert(looksLikeSignature('def is_prime(n: int) -> bool:', 'python'));
  assert(!looksLikeSignature('if (x > 0) {', 'javascript'));
  assert(!looksLikeSignature('} else if (y) {', 'javascript'));
  assert(!looksLikeSignature('for (let i = 0; i < n; i++) {', 'typescript'));
  assert(!looksLikeSignature('class Foo {', 'typescript'));
});

t('inline {|}', () => {
  const { text, off } = at('function isPrime(n) {|}\n');
  const s = detectStub(text, off, 'javascript', '  ')!;
  assert.equal(s.kind, 'inline');
  assert.equal(s.inner, '  ');
});

t('open {| + }', () => {
  const { text, off } = at('class A {\n  sum(xs) {|\n  }\n}');
  const s = detectStub(text, off, 'typescript', '  ')!;
  assert.equal(s.kind, 'open');
  assert.equal(s.inner, '    ');
});

t('empty line in body', () => {
  const { text, off } = at('function f(a) {\n    |\n}\n');
  const s = detectStub(text, off, 'javascript', '    ')!;
  assert.equal(s.kind, 'emptyLine');
});

t('non-empty body is not a stub', () => {
  const { text, off } = at('function f(a) {|\n  return 1;\n}\n');
  assert.equal(detectStub(text, off, 'javascript', '  '), undefined);
});

t('python stub', () => {
  const { text, off } = at('def is_prime(n):|\n\nprint(1)\n');
  const s = detectStub(text, off, 'python', '    ')!;
  assert.equal(s.kind, 'open');
  const { text: t2, off: o2 } = at('def is_prime(n):|\n    return True\n');
  assert.equal(detectStub(t2, o2, 'python', '    '), undefined);
});

t('body cleanup: fences + echoed signature + closing brace', () => {
  const raw = '```ts\nfunction isPrime(n) {\n  if (n < 2) return false;\n  for (let i = 2; i * i <= n; i++) {\n    if (n % i === 0) return false;\n  }\n  return true;\n}\n```\nThis checks primes.';
  assert.deepEqual(bodyLines(raw, 'typescript', 'function isPrime(n) {'), [
    'if (n < 2) return false;',
    'for (let i = 2; i * i <= n; i++) {',
    '  if (n % i === 0) return false;',
    '}',
    'return true;',
  ]);
});

t('body cleanup: plain body, no closing', () => {
  const raw = 'const out = [];\nfor (const x of xs) {\n  out.push(x * 2);\n}\nreturn out;';
  assert.deepEqual(bodyLines(raw, 'javascript', 'function dbl(xs) {').length, 5);
});

t('body cleanup: python stops at dedent', () => {
  const raw = '    if n < 2:\n        return False\n    return True\n\nprint(is_prime(7))';
  assert.deepEqual(bodyLines(raw, 'python', 'def is_prime(n):'), ['if n < 2:', '    return False', 'return True']);
});

t('ghost text for inline stub', () => {
  const { text, off } = at('  f(a) {|}');
  const s = detectStub(text, off, 'typescript', '  ')!;
  const g = stubGhost(['return a;'], s);
  assert.equal(g.text, '\n    return a;\n  ');
});

t('trimOverlap', () => {
  assert.equal(trimOverlap('x = 1;\n  return x;\n}', '\n}\n'), 'x = 1;\n  return x;');
});

t('comment syntax per language', () => {
  assert.equal(commentText('  // make a map', 'typescript'), 'make a map');
  assert.equal(commentText('# sort list', 'python'), 'sort list');
  assert.equal(commentText('#include <stdio.h>', 'c'), undefined);
  assert.equal(commentText('-- select users', 'sql'), 'select users');
  assert.equal(commentText('<!-- nav bar -->', 'html'), 'nav bar');
  assert.equal(commentText('/* center it */', 'css'), 'center it');
  assert.equal(commentText('const x = 1; // no', 'typescript'), undefined);
});

t('instruction comment + empty line', () => {
  const { text, off } = at('const users = [];\n// make a function that uses .map()\n|');
  const i = detectInstruction(text, off, 'typescript')!;
  assert.equal(i.instruction, 'make a function that uses .map()');
  assert.equal(i.lastCommentLine, '// make a function that uses .map()');
});

t('multi-line instruction, python, indented', () => {
  const { text, off } = at('def f(xs):\n    # vrať jen sudá čísla\n    # seřazená sestupně\n    |\n');
  const i = detectInstruction(text, off, 'python')!;
  assert.equal(i.instruction, 'vrať jen sudá čísla seřazená sestupně');
  assert.equal(i.indent, '    ');
});

t('no instruction when code follows / lint comment', () => {
  const a = at('// sum the list\n|\nconst y = 2;\n');
  assert.equal(detectInstruction(a.text, a.off, 'typescript'), undefined);
  const b = at('// eslint-disable-next-line\n|');
  assert.equal(detectInstruction(b.text, b.off, 'typescript'), undefined);
});

t('enclosing function + body replacement', () => {
  const src = 'function f(a) {\n  const s = "}";\n  return a;\n}\n';
  const f = enclosingFunction(src, src.indexOf('return'), 'javascript', '  ')!;
  assert.equal(f.signature, 'function f(a) {');
  assert.equal(src[f.bodyEnd], '}');
  assert.equal(f.bodyEnd, src.lastIndexOf('}'));
  const out = src.slice(0, f.bodyStart) + bodyReplacement(['return a * 2;'], f, 'javascript') + src.slice(f.bodyEnd);
  assert.equal(out, 'function f(a) {\n  return a * 2;\n}\n');
});

t('python enclosing function', () => {
  const src = 'def f(a):\n    x = a\n    return x\n\nprint(1)\n';
  const f = enclosingFunction(src, src.indexOf('return'), 'python', '    ')!;
  const out = src.slice(0, f.bodyStart) + bodyReplacement(['return a'], f, 'python') + src.slice(f.bodyEnd);
  assert.equal(out, 'def f(a):\n    return a\n\nprint(1)\n');
});

t('APPROACH line becomes title', () => {
  const lines: string[] = [];
  const s = new BodyStreamer('typescript', 'function f(xs) {', (l) => lines.push(l), []);
  s.push('APPROACH: Set-based dedupe\nreturn [...new Set(xs)];\n');
  s.end();
  assert.equal(s.title, 'Set-based dedupe');
  assert.deepEqual(lines, ['return [...new Set(xs)];']);
});

t('echoed instruction comment is skipped', () => {
  const lines: string[] = [];
  const s = new BodyStreamer('typescript', null, (l) => lines.push(l), ['// double all']);
  s.push('// APPROACH: map\n// double all\nconst d = xs.map((x) => x * 2);');
  s.end();
  assert.deepEqual(lines, ['const d = xs.map((x) => x * 2);']);
});

t('repeated line start is cut (Doplň teď)', () => {
  const lines: string[] = [];
  const s = new BodyStreamer('javascript', null, (l) => lines.push(l), [], 'const total = ');
  s.push('APPROACH: reduce\nconst total = items.reduce((a, i) => a + i.price * i.qty, 0);');
  s.end();
  assert.deepEqual(lines, ['items.reduce((a, i) => a + i.price * i.qty, 0);']);
});

console.log(`${n} tests passed`);
