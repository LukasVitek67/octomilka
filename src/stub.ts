// Detekce "prázdné funkce" u kurzoru a úprava výstupu velkého modelu.
// Bez závislosti na vscode, aby šlo testovat v čistém Node.

export type StubKind = 'inline' | 'open' | 'emptyLine';

export interface Stub {
  kind: StubKind;
  signature: string; // hlavička funkce (trim)
  sigIndent: string; // odsazení hlavičky
  inner: string; // odsazení těla
  curBefore: string; // text řádku před kurzorem
}

const CONTROL =
  /^(if|else|for|foreach|while|switch|catch|do|try|with|using|lock|elif|except|finally|match|when|return|new|unless|until|loop|select|case)\b/;
const MODIFIERS =
  /^(export|default|public|private|protected|internal|static|async|override|virtual|abstract|final|sealed|pub(\([^)]*\))?|unsafe|extern|inline|const|let|var)\s+/;

export const indentOf = (s: string): string => /^[ \t]*/.exec(s)![0];

export function looksLikeSignature(line: string, lang: string): boolean {
  const t = line.trim();
  if (lang === 'python') return /^(async\s+)?def\s+\w+\s*\(.*\)\s*(->\s*.+)?:$/.test(t);
  if (!t.endsWith('{') || !t.includes('(') || !t.includes(')')) return false;
  if (t.startsWith('}') || t.startsWith('//') || t.startsWith('*')) return false;
  let head = t;
  while (MODIFIERS.test(head)) head = head.replace(MODIFIERS, '');
  if (CONTROL.test(head)) return false;
  if (/^(class|struct|interface|enum|namespace|impl|trait|module)\b/.test(head)) return false;
  return true;
}

/** Název funkce z hlavičky (best effort). */
export function nameOf(signature: string): string {
  const m =
    /(?:def|function|fn|func|sub)\s+([\w$]+)/.exec(signature) ||
    /([\w$]+)\s*=\s*(?:async\s*)?(?:function\b|\()/.exec(signature) ||
    /([\w$]+)\s*(?:<[^>]*>)?\s*\(/.exec(signature);
  return m ? m[1] : '';
}

function isClosing(t: string): boolean {
  return /^\}[)\];,]*$/.test(t);
}

/**
 * Je kurzor uvnitř funkce s prázdným tělem?
 *  inline:    `function f(a) {|}`
 *  open:      `function f(a) {|` + další řádek `}`  (nebo `def f():|` v Pythonu)
 *  emptyLine: kurzor na prázdném řádku mezi hlavičkou a `}`
 */
export function detectStub(text: string, offset: number, lang: string, indentUnit: string): Stub | undefined {
  const py = lang === 'python';
  const before = text.slice(0, offset);
  const after = text.slice(offset);
  const lineStart = before.lastIndexOf('\n') + 1;
  const curBefore = before.slice(lineStart);
  const nl = after.indexOf('\n');
  const curAfter = nl < 0 ? after : after.slice(0, nl);
  const restLines = nl < 0 ? [] : after.slice(nl + 1).split('\n');
  const nextNonBlank = restLines.find((l) => l.trim() !== '');

  const bodyEndsOk = (sigIndent: string): boolean => {
    if (py) return nextNonBlank === undefined || indentOf(nextNonBlank).length <= sigIndent.length;
    return nextNonBlank !== undefined && isClosing(nextNonBlank.trim()) && indentOf(nextNonBlank) === sigIndent;
  };
  const mk = (kind: StubKind, sigLine: string): Stub => {
    const sigIndent = indentOf(sigLine);
    return { kind, signature: sigLine.trim(), sigIndent, inner: sigIndent + indentUnit, curBefore };
  };

  // 1) kurzor na konci hlavičky
  if (curBefore.trim() && looksLikeSignature(curBefore, lang)) {
    const sigIndent = indentOf(curBefore);
    if (!py && /^\}/.test(curAfter.trim())) return mk('inline', curBefore);
    if (curAfter.trim() === '' && bodyEndsOk(sigIndent)) return mk('open', curBefore);
    return undefined;
  }

  // 2) kurzor na prázdném řádku v těle
  if (curBefore.trim() === '' && curAfter.trim() === '') {
    const prevLines = before.slice(0, Math.max(0, lineStart - 1)).split('\n');
    let i = prevLines.length - 1;
    while (i >= 0 && prevLines[i].trim() === '') i--;
    if (i < 0) return undefined;
    const sig = prevLines[i];
    if (!looksLikeSignature(sig, lang)) return undefined;
    if (bodyEndsOk(indentOf(sig))) return mk('emptyLine', sig);
  }
  return undefined;
}

// ---------- komentáře ----------

const HASH = new Set([
  'python', 'shellscript', 'ruby', 'perl', 'r', 'yaml', 'toml', 'powershell', 'dockerfile', 'makefile',
  'coffeescript', 'julia', 'elixir', 'nim', 'crystal', 'properties', 'dotenv', 'gdscript',
]);
const DASH = new Set(['sql', 'lua', 'haskell', 'ada', 'elm', 'plsql']);
const PCT = new Set(['matlab', 'latex', 'tex', 'erlang', 'prolog']);
const SEMI = new Set(['clojure', 'lisp', 'scheme', 'ini', 'asm', 'racket']);
const XML = new Set(['html', 'xml', 'markdown', 'svg', 'xsl', 'razor']);
const CSS = new Set(['css', 'scss', 'less']);

/** Jak se v jazyce píše jednořádkový komentář. */
export function lineComment(lang: string): { open: string; close: string } {
  if (HASH.has(lang)) return { open: '#', close: '' };
  if (DASH.has(lang)) return { open: '--', close: '' };
  if (PCT.has(lang)) return { open: '%', close: '' };
  if (SEMI.has(lang)) return { open: ';', close: '' };
  if (XML.has(lang)) return { open: '<!--', close: ' -->' };
  if (CSS.has(lang)) return { open: '/*', close: ' */' };
  return { open: '//', close: '' };
}

/** Text komentáře na řádku, nebo undefined, když řádek není (celý) komentář. */
export function commentText(line: string, lang: string): string | undefined {
  const t = line.trim();
  let m: RegExpExecArray | null;
  if (HASH.has(lang)) return (m = /^#+\s?(.*)$/.exec(t)) && !t.startsWith('#!') ? m[1] : undefined;
  if (DASH.has(lang)) return (m = /^--+\s?(.*)$/.exec(t)) ? m[1] : undefined;
  if (PCT.has(lang)) return (m = /^%+\s?(.*)$/.exec(t)) ? m[1] : undefined;
  if (SEMI.has(lang)) return (m = /^;+\s?(.*)$/.exec(t)) ? m[1] : undefined;
  if ((m = /^<!--\s?(.*?)\s*-->$/.exec(t))) return m[1];
  if ((m = /^\/\*+\s?(.*?)\s*\*\/$/.exec(t))) return m[1];
  if (!CSS.has(lang) && !XML.has(lang) && (m = /^\/\/+\s?(.*)$/.exec(t))) return m[1];
  if (lang === 'php' && (m = /^#\s?(.*)$/.exec(t))) return m[1];
  return undefined;
}

const NOT_INSTRUCTION = /^(eslint|@ts-|prettier|#?region|#?endregion|noinspection|pylint|type:|noqa|istanbul|jshint|copyright|license|-{3,}|={3,}|\*+$)/i;

export interface Instruction {
  instruction: string; // spojený text komentáře
  lastCommentLine: string; // poslední řádek komentáře (trim) – klíč do paměti
  indent: string; // odsazení komentáře = odsazení kódu
  curBefore: string;
}

/**
 * Uživatel napsal komentář jako zadání a odentroval:
 *   // make a function that uses .map()
 *   |
 * Pod kurzorem nesmí rovnou pokračovat existující kód.
 */
export function detectInstruction(text: string, offset: number, lang: string): Instruction | undefined {
  const before = text.slice(0, offset);
  const after = text.slice(offset);
  const lineStart = before.lastIndexOf('\n') + 1;
  const curBefore = before.slice(lineStart);
  const nl = after.indexOf('\n');
  const curAfter = nl < 0 ? after : after.slice(0, nl);
  if (curBefore.trim() !== '' || curAfter.trim() !== '') return undefined;

  const prev = before.slice(0, Math.max(0, lineStart - 1)).split('\n');
  const parts: string[] = [];
  let i = prev.length - 1;
  let last = '';
  let indent = '';
  if (lineStart === 0) return undefined;
  for (; i >= 0 && parts.length < 8; i--) {
    const c = commentText(prev[i], lang);
    if (c === undefined) break;
    if (!parts.length) {
      last = prev[i].trim();
      indent = indentOf(prev[i]);
    }
    parts.unshift(c.trim());
  }
  if (!parts.length) return undefined;
  const instruction = parts.filter(Boolean).join(' ').trim();
  if (instruction.length < 6 || !/\p{L}{3,}/u.test(instruction) || NOT_INSTRUCTION.test(instruction)) return undefined;

  const next = nl < 0 ? undefined : after.slice(nl + 1).split('\n')[0];
  if (next !== undefined && next.trim() && !isClosing(next.trim()) && indentOf(next).length >= indent.length) return undefined;
  return { instruction, lastCommentLine: last, indent, curBefore };
}

// ---------- hledání funkce kolem kurzoru (pro "jiné řešení") ----------

/** Index párové `}` k `{` na pozici open; přeskakuje řetězce a komentáře. */
export function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === '\\') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const e = text.indexOf('\n', i);
      if (e < 0) return -1;
      i = e;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      if (e < 0) return -1;
      i = e + 1;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

export interface FnRange {
  signature: string;
  sigIndent: string;
  inner: string;
  bodyStart: number; // hned za `{` / za koncem řádku `def …:`
  bodyEnd: number; // pozice párové `}` / konec posledního řádku těla
}

export function functionAt(text: string, sigLineStart: number, lang: string, indentUnit: string): FnRange | undefined {
  let eol = text.indexOf('\n', sigLineStart);
  if (eol < 0) eol = text.length;
  const line = text.slice(sigLineStart, eol);
  if (!looksLikeSignature(line, lang)) return undefined;
  const sigIndent = indentOf(line);
  const base = { signature: line.trim(), sigIndent, inner: sigIndent + indentUnit };
  if (lang === 'python') {
    let end = eol;
    let p = eol;
    while (p < text.length) {
      let e = text.indexOf('\n', p + 1);
      if (e < 0) e = text.length;
      const l = text.slice(p + 1, e);
      if (l.trim() && indentOf(l).length <= sigIndent.length) break;
      if (l.trim()) end = e;
      p = e;
    }
    return { ...base, bodyStart: eol, bodyEnd: end };
  }
  const open = sigLineStart + line.lastIndexOf('{');
  const close = matchBrace(text, open);
  if (close < 0) return undefined;
  return { ...base, bodyStart: open + 1, bodyEnd: close };
}

/** Nejbližší funkce, v jejímž těle (nebo na hlavičce) je kurzor. */
export function enclosingFunction(text: string, offset: number, lang: string, indentUnit: string): FnRange | undefined {
  let ls = text.lastIndexOf('\n', offset - 1) + 1;
  for (let n = 0; n < 400 && ls >= 0; n++) {
    const f = functionAt(text, ls, lang, indentUnit);
    if (f && offset <= f.bodyEnd) return f;
    if (ls === 0) break;
    ls = text.lastIndexOf('\n', ls - 2) + 1;
  }
  return undefined;
}

/** Text, který nahradí tělo funkce [bodyStart, bodyEnd). */
export function bodyReplacement(lines: string[], f: FnRange, lang: string): string {
  const body = lines.map((l) => (l ? f.inner + l : '')).join('\n');
  return lang === 'python' ? '\n' + body : '\n' + body + '\n' + f.sigIndent;
}

/** Odsadí řádky volného kódu (např. pod komentářem). */
export function indentLines(lines: string[], indent: string): string {
  return lines.map((l) => (l ? indent + l : '')).join('\n');
}

/**
 * Proudově čte výstup modelu po řádcích a vydává čisté řádky těla
 * (bez markdownu, bez zopakované hlavičky a bez uzavírací závorky),
 * odsazené relativně k tělu (0 = úroveň těla).
 * Řádek `APPROACH: …` na začátku uloží do `title`.
 */
export class BodyStreamer {
  private buf = '';
  private started = false;
  private echoed = false;
  private baseline = 0;
  private pending: string | null = null;
  private blanks = 0;
  done = false;
  title = '';

  constructor(
    private lang: string,
    private signature: string | null, // null = volný režim (ne tělo funkce)
    private emit: (line: string) => void,
    private skipLines: string[] = [], // řádky (trim), které model může zopakovat, např. komentář se zadáním
  ) {}

  push(chunk: string): void {
    if (this.done) return;
    this.buf += chunk.replace(/\r/g, '');
    let i: number;
    while (!this.done && (i = this.buf.indexOf('\n')) >= 0) {
      const l = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      this.line(l);
    }
  }

  end(): void {
    if (!this.done && this.buf) this.line(this.buf);
    this.buf = '';
    this.finish();
  }

  private line(l: string): void {
    const t = l.trim();
    if (t.startsWith('```')) {
      if (this.started) this.finish(); // konec code bloku = konec odpovědi
      return;
    }
    if (!this.started) {
      if (!t) return;
      const ap = /^(?:\/\/+|#+|--|;+|%|\/\*+|<!--)?\s*\**APPROACH\**\s*:\s*(.*?)\s*(?:\*\/|-->)?$/i.exec(t);
      if (ap) {
        if (!this.title) this.title = ap[1].replace(/[`*]/g, '').trim();
        return;
      }
      if (this.skipLines.includes(t)) return;
      if (this.signature !== null && this.isEcho(l)) {
        this.echoed = true;
        return;
      }
      this.started = true;
      this.baseline = indentOf(l).length;
    }
    if (!t) {
      this.blanks++;
      return;
    }
    const ind = indentOf(l).length;
    if (this.signature !== null && ind < this.baseline) {
      // odsazení pod úroveň těla = konec funkce, tenhle řádek už nepatří do těla
      this.finish();
      return;
    }
    if (this.pending !== null) this.out(this.pending);
    for (; this.blanks > 0; this.blanks--) this.emit('');
    this.pending = l;
  }

  private isEcho(l: string): boolean {
    if (!looksLikeSignature(l, this.lang)) return false;
    const want = nameOf(this.signature!);
    return !want || nameOf(l) === want;
  }

  private balance = 0; // { minus } ve vydaných řádcích

  private out(l: string): void {
    const ind = indentOf(l).length;
    this.balance += (l.match(/\{/g)?.length ?? 0) - (l.match(/\}/g)?.length ?? 0);
    this.emit(l.slice(Math.min(ind, this.baseline)));
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    if (this.pending !== null) {
      // poslední `}` bez páru = uzavírací závorka funkce, ta už v souboru je
      const dropClosing =
        this.signature !== null && this.lang !== 'python' && isClosing(this.pending.trim()) && this.balance <= 0;
      if (!dropClosing) this.out(this.pending);
    }
    this.pending = null;
  }
}

export function bodyLines(raw: string, lang: string, signature: string | null): string[] {
  const out: string[] = [];
  const s = new BodyStreamer(lang, signature, (l) => out.push(l));
  s.push(raw);
  s.end();
  return out;
}

/** Šedý text pro inline návrh z hotových řádků těla. */
export function stubGhost(lines: string[], stub: Stub): { text: string; fromLineStart: boolean } {
  const ind = (l: string) => (l ? stub.inner + l : '');
  const body = lines.map(ind).join('\n');
  switch (stub.kind) {
    case 'inline':
      return { text: '\n' + body + '\n' + stub.sigIndent, fromLineStart: false };
    case 'open':
      return { text: '\n' + body, fromLineStart: false };
    case 'emptyLine':
      if (stub.inner.startsWith(stub.curBefore)) return { text: body, fromLineStart: true };
      return { text: [lines[0] ?? '', ...lines.slice(1).map(ind)].join('\n'), fromLineStart: false };
  }
}

/** Ořízne návrh tam, kde začne opakovat text, který už je za kurzorem. */
export function trimOverlap(completion: string, suffix: string): string {
  const next = suffix.split('\n').map((l) => l.trim()).filter(Boolean)[0];
  let out = completion.replace(/\r/g, '');
  if (next) {
    const lines = out.split('\n');
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === next) {
        out = lines.slice(0, i).join('\n');
        break;
      }
    }
  }
  return out.replace(/\s+$/, (m) => (m.includes('\n') ? '' : m));
}
