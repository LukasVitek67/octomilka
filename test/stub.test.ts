import assert from 'assert';
import { detectStub, bodyLines, stubGhost, trimOverlap, looksLikeSignature } from '../src/stub';

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

console.log(`${n} tests passed`);
