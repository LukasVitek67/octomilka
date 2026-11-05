// "Místa" v kódu (funkce / komentář se zadáním) a paměť všech navržených řešení pro každé z nich.
// Paměť je jen lokální: VS Code workspaceState na tomto PC.
import * as vscode from 'vscode';
import {
  detectStub,
  detectInstruction,
  enclosingFunction,
  functionAt,
  commentText,
  indentOf,
  indentLines,
  bodyReplacement,
  FnRange,
} from './stub';

export interface Variant {
  id: string;
  title: string;
  lines: string[];
  best: boolean; // AI ho považuje za nejpravděpodobnější (nejvyšší jistota)
  origin: 'ai' | 'user';
  at: number;
  /** Jistota AI 0–1 = průměrná pravděpodobnost tokenů kódu (geometrický průměr). */
  confidence?: number;
}

/** Odpovídá kód filtru "musí obsahovat" / "nesmí obsahovat"? (bez ohledu na velikost písmen) */
export function matchesFilter(lines: string[], must: string[], mustNot: string[]): boolean {
  const code = lines.join('\n').toLowerCase();
  return must.every((m) => code.includes(m.toLowerCase())) && !mustNot.some((m) => code.includes(m.toLowerCase()));
}

/** Pořadí: AI řešení podle jistoty (nejvyšší první), staré bez jistoty za nimi, tvůj kód na konci. */
export function rankVariants(vs: Variant[]): Variant[] {
  const score = (v: Variant) => (v.origin === 'user' ? -2 : v.confidence ?? (v.best ? -0.5 : -1));
  return [...vs].sort((a, b) => score(b) - score(a) || a.at - b.at);
}

function markBest(vs: Variant[]): void {
  vs.forEach((x) => (x.best = false));
  const top = rankVariants(vs).find((v) => v.origin === 'ai');
  if (top) top.best = true;
}

export interface SpotInfo {
  key: string;
  kind: 'fn' | 'instr';
  label: string; // hlavička funkce nebo poslední řádek komentáře (trim) = kotva v souboru
  instruction?: string;
  uri: string;
  lang: string;
}

export interface SpotData extends SpotInfo {
  variants: Variant[];
  updated: number;
}

const KEY = 'octomilka.spots.v1';
const MAX_SPOTS = 300;
const MAX_VARIANTS = 12;
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const sameCode = (a: string[], b: string[]) => norm(a.join('\n')) === norm(b.join('\n'));

export class SpotStore {
  private emitter = new vscode.EventEmitter<string>();
  readonly onDidChange = this.emitter.event;

  constructor(private mem: vscode.Memento) {}

  private all(): Record<string, SpotData> {
    return this.mem.get<Record<string, SpotData>>(KEY, {});
  }

  get(key: string): SpotData | undefined {
    return this.all()[key];
  }

  private async put(s: SpotData): Promise<void> {
    const all = { ...this.all() };
    s.updated = Date.now();
    all[s.key] = s;
    const keys = Object.keys(all);
    if (keys.length > MAX_SPOTS) {
      keys.sort((a, b) => all[a].updated - all[b].updated);
      for (const k of keys.slice(0, keys.length - MAX_SPOTS)) delete all[k];
    }
    await this.mem.update(KEY, all);
    this.emitter.fire(s.key);
  }

  /** Přidá řešení (duplicitní kód se neukládá). Vrací uložené řešení. */
  async add(
    info: SpotInfo,
    v: { title: string; lines: string[]; origin: 'ai' | 'user'; confidence?: number },
  ): Promise<Variant | undefined> {
    if (!v.lines.some((l) => l.trim())) return undefined;
    const s: SpotData = this.get(info.key) ?? { ...info, variants: [], updated: 0 };
    const dup = s.variants.find((x) => sameCode(x.lines, v.lines));
    if (dup) {
      // stejný kód od AI: doplnit jistotu a pojmenování, když chyběly
      if (v.origin === 'ai' && dup.origin === 'user') dup.origin = 'ai';
      if (v.confidence !== undefined && dup.confidence === undefined) dup.confidence = v.confidence;
      if (v.title && (dup.title === 'Tvůj kód' || !dup.title) && v.origin === 'ai') dup.title = v.title;
      markBest(s.variants);
      await this.put({ ...info, variants: s.variants, updated: 0 });
      return dup;
    }
    const item: Variant = {
      id: Math.random().toString(36).slice(2, 10),
      title: v.title || (v.origin === 'user' ? 'Tvůj kód' : 'Řešení'),
      lines: v.lines,
      best: false,
      origin: v.origin,
      at: Date.now(),
      confidence: v.confidence,
    };
    s.variants.push(item);
    while (s.variants.length > MAX_VARIANTS) {
      const worst = rankVariants(s.variants).filter((x) => x.origin === 'ai').pop();
      s.variants.splice(Math.max(0, s.variants.indexOf(worst ?? s.variants[0])), 1);
    }
    markBest(s.variants);
    await this.put({ ...info, variants: s.variants, updated: 0 });
    return item;
  }

  async remove(key: string, id: string): Promise<void> {
    const s = this.get(key);
    if (!s) return;
    s.variants = s.variants.filter((x) => x.id !== id);
    markBest(s.variants);
    await this.put(s);
  }

  /** Seřazeno od nejpravděpodobnější (nejvyšší jistota AI) po nejhorší. */
  ordered(key: string): Variant[] {
    const s = this.get(key);
    return s ? rankVariants(s.variants) : [];
  }
}

export const fnKey = (uri: string, sig: string) => `${uri}::fn::${norm(sig)}`;
export const instrKey = (uri: string, comment: string) => `${uri}::instr::${norm(comment)}`;

/** Místo nalezené v aktuálním textu souboru. */
export interface Located {
  info: SpotInfo;
  range: [number, number]; // co se nahradí při použití řešení
  current: string[]; // co tam teď je (řádky bez společného odsazení)
  before: string; // kontext pro prompt (místo samotné vynecháno)
  after: string;
  signature: string | null; // pro BodyStreamer
  skipLines: string[];
  mode: 'body' | 'instr';
  replacement: (lines: string[]) => string;
}

function dedentBlock(s: string): string[] {
  const lines = s.replace(/\r/g, '').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const ne = lines.filter((l) => l.trim());
  if (!ne.length) return [];
  const min = Math.min(...ne.map((l) => indentOf(l).length));
  return lines.map((l) => (l.trim() ? l.slice(min).trimEnd() : ''));
}

function context(text: string, start: number, end: number): { before: string; after: string } {
  let b = Math.max(0, start - 3500);
  if (b > 0) b = text.indexOf('\n', b) + 1 || b;
  let a = Math.min(text.length, end + 1200);
  if (a < text.length) {
    const nl = text.lastIndexOf('\n', a);
    if (nl > end) a = nl;
  }
  return { before: text.slice(b, start), after: text.slice(end, a) };
}

function lineStarts(text: string, trimmed: string): number[] {
  const out: number[] = [];
  let ls = 0;
  for (;;) {
    let e = text.indexOf('\n', ls);
    if (e < 0) e = text.length;
    if (text.slice(ls, e).trim() === trimmed) out.push(ls);
    if (e >= text.length) break;
    ls = e + 1;
  }
  return out;
}

const nearest = (xs: number[], hint: number) =>
  xs.length ? xs.reduce((a, b) => (Math.abs(b - hint) < Math.abs(a - hint) ? b : a)) : undefined;

function fromFn(uri: string, lang: string, text: string, f: FnRange): Located {
  const info: SpotInfo = { key: fnKey(uri, f.signature), kind: 'fn', label: f.signature, uri, lang };
  const { before, after } = context(text, f.bodyStart, f.bodyEnd);
  return {
    info,
    range: [f.bodyStart, f.bodyEnd],
    current: dedentBlock(text.slice(f.bodyStart, f.bodyEnd)),
    before,
    after,
    signature: f.signature,
    skipLines: [],
    mode: 'body',
    replacement: (lines) => bodyReplacement(lines, f, lang),
  };
}

function fromInstr(
  uri: string,
  lang: string,
  text: string,
  commentLineStart: number,
  instruction: string,
  store: SpotStore,
): Located {
  let eol = text.indexOf('\n', commentLineStart);
  if (eol < 0) eol = text.length;
  const commentLine = text.slice(commentLineStart, eol);
  const label = commentLine.trim();
  const indent = indentOf(commentLine);
  const info: SpotInfo = { key: instrKey(uri, label), kind: 'instr', label, instruction, uri, lang };
  const start = Math.min(eol + 1, text.length);
  let range: [number, number] | undefined;
  // Je pod komentářem jedno z dřív použitých řešení? Pak ho budeme nahrazovat.
  const vs = [...(store.get(info.key)?.variants ?? [])].sort((a, b) => b.lines.join('\n').length - a.lines.join('\n').length);
  for (const v of vs) {
    const cand = indentLines(v.lines, indent);
    if (cand && text.startsWith(cand, start)) {
      range = [start, start + cand.length];
      break;
    }
  }
  let prefixNL = false;
  if (!range) {
    let e = text.indexOf('\n', start);
    if (e < 0) e = text.length;
    if (eol < text.length && !text.slice(start, e).trim()) range = [start, e]; // prázdný řádek pod komentářem
    else {
      range = [eol, eol];
      prefixNL = true;
    }
  }
  const { before, after } = context(text, range[0], range[1]);
  // Komentář uvnitř funkce: model občas zopakuje její hlavičku – BodyStreamer ji podle ní zahodí.
  const outer = enclosingFunction(text, commentLineStart, lang, '  ');
  return {
    info,
    range,
    current: dedentBlock(text.slice(range[0], range[1])),
    before: prefixNL ? before + '\n' : before,
    after,
    signature: outer ? outer.signature : null,
    skipLines: [label],
    mode: 'instr',
    replacement: (lines) => (prefixNL ? '\n' : '') + indentLines(lines, indent),
  };
}

/** Text komentářového bloku končícího na řádku commentLineStart (pro zadání). */
function instructionAt(text: string, commentLineStart: number, lang: string): string | undefined {
  const lines = text.slice(0, commentLineStart).split('\n');
  lines.pop();
  let eol = text.indexOf('\n', commentLineStart);
  if (eol < 0) eol = text.length;
  const own = commentText(text.slice(commentLineStart, eol), lang);
  if (own === undefined) return undefined;
  const parts = [own.trim()];
  for (let i = lines.length - 1; i >= 0 && parts.length < 8; i--) {
    const c = commentText(lines[i], lang);
    if (c === undefined) break;
    parts.unshift(c.trim());
  }
  return parts.filter(Boolean).join(' ');
}

/** Najde místo u kurzoru: komentář se zadáním, nebo funkci. */
export function resolveAt(doc: vscode.TextDocument, offset: number, store: SpotStore, unit: string): Located | undefined {
  const text = doc.getText();
  const uri = doc.uri.toString();
  const lang = doc.languageId;

  // 1) prázdný řádek pod komentářem se zadáním
  const ins = detectInstruction(text, offset, lang);
  if (ins) {
    const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
    const commentStart = text.lastIndexOf('\n', lineStart - 2) + 1;
    return fromInstr(uri, lang, text, commentStart, ins.instruction, store);
  }

  // 2) prázdná funkce
  const stub = detectStub(text, offset, lang, unit);
  if (stub) {
    const f = enclosingFunction(text, offset, lang, unit);
    if (f) return fromFn(uri, lang, text, f);
  }

  // 3) uvnitř kódu, který vznikl z komentáře se zadáním (máme ho v paměti)
  let ls = text.lastIndexOf('\n', offset - 1) + 1;
  for (let n = 0; n < 120; n++) {
    let e = text.indexOf('\n', ls);
    if (e < 0) e = text.length;
    const line = text.slice(ls, e);
    if (commentText(line, lang) !== undefined && store.get(instrKey(uri, line.trim()))) {
      const instruction = instructionAt(text, ls, lang) ?? line.trim();
      const loc = fromInstr(uri, lang, text, ls, instruction, store);
      if (offset <= loc.range[1] + 1) return loc;
    }
    if (ls === 0) break;
    ls = text.lastIndexOf('\n', ls - 2) + 1;
  }

  // 4) funkce kolem kurzoru
  const f = enclosingFunction(text, offset, lang, unit);
  if (f) return fromFn(uri, lang, text, f);
  return undefined;
}

/** Znovu najde uložené místo v souboru (kurzor mezitím mohl odjet). */
export function locate(doc: vscode.TextDocument, info: SpotInfo, hint: number, store: SpotStore, unit: string): Located | undefined {
  const text = doc.getText();
  const starts = lineStarts(text, info.label);
  const at = nearest(starts, hint);
  if (at === undefined) return undefined;
  if (info.kind === 'fn') {
    const f = functionAt(text, at, info.lang, unit);
    return f ? fromFn(info.uri, info.lang, text, f) : undefined;
  }
  return fromInstr(info.uri, info.lang, text, at, info.instruction ?? info.label, store);
}
