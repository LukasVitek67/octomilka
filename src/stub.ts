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

/**
 * Proudově čte výstup modelu po řádcích a vydává čisté řádky těla
 * (bez markdownu, bez zopakované hlavičky a bez uzavírací závorky),
 * odsazené relativně k tělu (0 = úroveň těla).
 */
export class BodyStreamer {
  private buf = '';
  private started = false;
  private echoed = false;
  private baseline = 0;
  private pending: string | null = null;
  private blanks = 0;
  done = false;

  constructor(
    private lang: string,
    private signature: string | null, // null = volný režim (ne tělo funkce)
    private emit: (line: string) => void,
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
