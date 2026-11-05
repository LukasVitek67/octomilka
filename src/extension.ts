import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import {
  LLAMA_TAG,
  PROFILES,
  Profile,
  Variant,
  autoProfile,
  engineAsset,
  engineUrl,
  download,
  extract,
  findFile,
  LlamaServer,
  infill,
  chatStream,
  buildMessages,
  buildIdeasMessages,
  parseIdeas,
  langName,
  ExtraChunk,
} from './engine';
import {
  detectStub,
  detectInstruction,
  stubGhost,
  BodyStreamer,
  trimOverlap,
  indentOf,
  indentLines,
  lineComment,
  Stub,
  Instruction,
  nameOf,
} from './stub';
import { SpotStore, SpotInfo, Located, resolveAt, locate } from './spots';
import { repoFrom, latestRelease, compareVersions, downloadRelease, shortNotes, Release } from './updater';
import { Activity } from './activity';
import { OctoView, ViewHost } from './view';

export type State = 'off' | 'needsSetup' | 'downloading' | 'starting' | 'ready' | 'error';

let out: vscode.OutputChannel;
const log = (m: string) => out.appendLine(`${new Date().toLocaleTimeString()} ${m}`);
const cfg = () => vscode.workspace.getConfiguration('octomilka');
const fmtGB = (b: number) => (b / 2 ** 30).toFixed(1).replace('.', ',') + ' GB';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Controller {
  state: State = 'off';
  busy = 0;
  progress = '';
  tab?: LlamaServer;
  gen?: LlamaServer;
  private initRun?: Promise<void>;
  private idleTimer: NodeJS.Timeout;
  /** Změna stavu → panel se překreslí. */
  readonly changed = new vscode.EventEmitter<void>();
  /** Kolik se bude stahovat při instalaci (pro tlačítko v panelu). */
  get downloadSize(): string {
    const p = PROFILES[this.profile];
    return fmtGB(p.tab.bytes + p.gen.bytes + 40e6);
  }

  constructor(
    private ctx: vscode.ExtensionContext,
    private status: vscode.StatusBarItem,
  ) {
    this.idleTimer = setInterval(() => this.idleCheck(), 60_000);
  }

  get dir(): string {
    return this.ctx.globalStorageUri.fsPath;
  }
  get profile(): Profile {
    const p = cfg().get<string>('profile', 'auto');
    return p === 'small' || p === 'medium' || p === 'large' ? p : autoProfile();
  }
  get variant(): Variant {
    if (!cfg().get('gpu', true) || this.ctx.globalState.get('forceCpu')) return 'cpu';
    return 'gpu';
  }

  render(): void {
    const s = this.status;
    const p = PROFILES[this.profile];
    const base = `Octomilka · ${p.label}`;
    const en = cfg().get('enabled', true);
    switch (this.state) {
      case 'off':
        s.text = '$(circle-slash) Octomilka';
        s.tooltip = `${base}\nVypnuto`;
        break;
      case 'needsSetup':
        s.text = '$(cloud-download) Octomilka: nainstalovat';
        s.tooltip = 'Klikni pro jednorázové stažení AI. Pak běží offline.';
        break;
      case 'downloading':
        s.text = `$(cloud-download) Octomilka ${this.progress}`;
        s.tooltip = 'Stahuju AI…';
        break;
      case 'starting':
        s.text = '$(sync~spin) Octomilka';
        s.tooltip = 'Spouštím AI…';
        break;
      case 'error':
        s.text = '$(warning) Octomilka';
        s.tooltip = 'Chyba – klikni pro menu / log';
        break;
      case 'ready':
        s.text = this.busy ? '$(sync~spin) Octomilka píše…' : en ? '$(sparkle) Octomilka' : '$(circle-slash) Octomilka';
        s.tooltip =
          `${base}\n${en ? 'Tab návrhy zapnuté' : 'Tab návrhy vypnuté'}\n` +
          `Tab: ${this.tab?.device || '…'} · funkce: ${this.gen?.running ? this.gen.device : 'spustí se při použití'}\n` +
          `Ctrl+Alt+Enter = dopsat funkci\nVše běží lokálně na tomto PC.`;
        break;
    }
    s.tooltip += '\n\nKlikni = otevřít panel Octomilka dole';
    s.show();
    this.changed.fire();
  }

  setState(s: State): void {
    this.state = s;
    this.render();
  }

  isReady(): boolean {
    return this.state === 'ready' && !!this.tab?.running;
  }

  init(interactive: boolean): Promise<void> {
    if (!this.initRun) {
      this.initRun = this.doInit(interactive).finally(() => (this.initRun = undefined));
    }
    return this.initRun;
  }

  private async paths() {
    const prof = PROFILES[this.profile];
    const variant = this.variant;
    const asset = engineAsset(variant);
    if (!asset) throw new Error(`Nepodporovaná platforma: ${process.platform}-${process.arch}`);
    const engineDir = path.join(this.dir, 'engine', `${LLAMA_TAG}-${variant}`);
    const binName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    const bin = await findFile(engineDir, binName);
    const tabPath = path.join(this.dir, 'models', prof.tab.file);
    const genPath = path.join(this.dir, 'models', prof.gen.file);
    return { prof, variant, asset, engineDir, binName, bin, tabPath, genPath };
  }

  private async doInit(interactive: boolean): Promise<void> {
    this.stopServers();
    try {
      let p = await this.paths();
      const exists = async (f: string) => !!(await fsp.stat(f).catch(() => undefined));
      const todo: { label: string; url: string; dest: string; bytes: number; archive?: boolean }[] = [];
      if (!p.bin)
        todo.push({
          label: 'engine llama.cpp',
          url: engineUrl(p.asset),
          dest: path.join(this.dir, 'downloads', p.asset),
          bytes: 40e6,
          archive: true,
        });
      if (!(await exists(p.tabPath))) todo.push({ label: p.prof.tab.label, url: p.prof.tab.url, dest: p.tabPath, bytes: p.prof.tab.bytes });
      if (!(await exists(p.genPath))) todo.push({ label: p.prof.gen.label, url: p.prof.gen.url, dest: p.genPath, bytes: p.prof.gen.bytes });

      if (todo.length) {
        const total = todo.reduce((a, t) => a + t.bytes, 0);
        if (!interactive) {
          this.setState('needsSetup');
          const pick = await vscode.window.showInformationMessage(
            `Octomilka potřebuje jednorázově stáhnout AI (${fmtGB(total)}, profil ${p.prof.label}). Potom běží úplně offline.`,
            'Stáhnout',
            'Později',
          );
          if (pick !== 'Stáhnout') return;
        }
        await this.checkDisk(total);
        await this.downloadAll(todo);
        p = await this.paths();
        if (!p.bin) {
          const archive = todo.find((t) => t.archive)!.dest;
          await extract(archive, p.engineDir);
          await fsp.rm(archive, { force: true });
          p = await this.paths();
          if (!p.bin) throw new Error('V balíčku enginu chybí llama-server');
        }
      }

      this.setState('starting');
      try {
        await this.startServers(p.bin!, p.tabPath, p.genPath, p.variant);
      } catch (e) {
        if (p.variant === 'gpu' && process.platform !== 'darwin') {
          log(`GPU verze nenaběhla (${(e as Error).message}), zkouším CPU verzi.`);
          await this.ctx.globalState.update('forceCpu', true);
          this.initRun = undefined;
          return this.doInit(true);
        }
        throw e;
      }
      this.setState('ready');
      log(`Připraveno. Profil ${p.prof.label}, ${p.variant.toUpperCase()}.`);
    } catch (e) {
      const msg = (e as Error).message;
      if ((e as Error).name === 'AbortError' || msg === 'cancelled') {
        this.setState('needsSetup');
        return;
      }
      log(`CHYBA: ${msg}`);
      this.setState('error');
      const pick = await vscode.window.showErrorMessage(`Octomilka: ${msg}`, 'Zkusit znovu', 'Log');
      if (pick === 'Zkusit znovu') void this.init(true);
      if (pick === 'Log') out.show();
    }
  }

  private async checkDisk(need: number): Promise<void> {
    try {
      await fsp.mkdir(this.dir, { recursive: true });
      const st = await fsp.statfs(this.dir);
      const free = st.bavail * st.bsize;
      if (free < need * 1.1) throw new Error(`Málo místa na disku: potřeba ${fmtGB(need)}, volno ${fmtGB(free)}`);
    } catch (e) {
      if ((e as Error).message.startsWith('Málo místa')) throw e;
    }
  }

  private downloadAll(todo: { label: string; url: string; dest: string; bytes: number }[]): Promise<void> {
    this.setState('downloading');
    const total = todo.reduce((a, t) => a + t.bytes, 0);
    return Promise.resolve(
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Octomilka', cancellable: true },
        async (progress, token) => {
          const ac = new AbortController();
          token.onCancellationRequested(() => ac.abort());
          let done = 0;
          let reported = 0;
          for (const t of todo) {
            let lastUi = 0;
            await download(
              t.url,
              t.dest,
              (n) => {
                done += n;
                const now = Date.now();
                if (now - lastUi < 250) return;
                lastUi = now;
                const pct = Math.min(99, Math.floor((done / total) * 100));
                progress.report({ message: `${t.label}: ${fmtGB(done)} / ${fmtGB(total)}`, increment: pct - reported });
                reported = pct;
                this.progress = `${pct} %`;
                this.render();
              },
              ac.signal,
            );
          }
        },
      ),
    );
  }

  private async startServers(bin: string, tabPath: string, genPath: string, variant: Variant): Promise<void> {
    // Každý server zkusí GPU (auto = vejde se do paměti?), jinak sám spadne na CPU.
    const ngls = variant === 'gpu' ? ['auto', '0'] : ['0'];
    this.tab = new LlamaServer('tab', bin, tabPath, ['-c', '8192', '-np', '1', '--cache-reuse', '256'], log, ngls);
    this.gen = new LlamaServer('funkce', bin, genPath, ['-c', '8192', '-np', '1', '--jinja'], log, ngls);
    await this.tab.start();
    if (cfg().get('autoFunction', true))
      void this.gen
        .start()
        .then(() => this.render())
        .catch((e) => log(`funkce: ${e.message}`));
  }

  async ensureGen(): Promise<LlamaServer> {
    if (!this.isReady() || !this.gen) {
      await this.init(true);
      if (!this.isReady() || !this.gen) throw new Error('AI není připravená');
    }
    await this.gen.start();
    return this.gen;
  }

  private idleCheck(): void {
    const mins = cfg().get<number>('idleMinutes', 15);
    if (this.gen?.running && Date.now() - this.gen.lastUsed > mins * 60_000) {
      log('Velký model nečinný, uvolňuju RAM.');
      this.gen.stop();
    }
  }

  stopServers(): void {
    this.tab?.stop();
    this.gen?.stop();
  }

  dispose(): void {
    clearInterval(this.idleTimer);
    this.stopServers();
  }
}

// ---------- pomocné ----------

function indentUnit(doc: vscode.TextDocument): string {
  const ed = vscode.window.visibleTextEditors.find((e) => e.document === doc);
  const o = ed?.options;
  if (o && o.insertSpaces === false) return '\t';
  const n = typeof o?.tabSize === 'number' ? o.tabSize : 4;
  return ' '.repeat(n);
}

function extraContext(doc: vscode.TextDocument): ExtraChunk[] {
  const chunks: ExtraChunk[] = [];
  for (const ed of vscode.window.visibleTextEditors) {
    const d = ed.document;
    if (d === doc || d.uri.scheme !== 'file' || chunks.length >= 3) continue;
    const line = ed.selection.active.line;
    const start = Math.max(0, line - 40);
    const end = Math.min(d.lineCount - 1, line + 40);
    const text = d.getText(new vscode.Range(start, 0, end, d.lineAt(end).text.length));
    if (text.trim()) chunks.push({ filename: path.basename(d.fileName), text: text.slice(0, 3000) });
  }
  return chunks;
}

function windowAround(doc: vscode.TextDocument, offset: number, beforeChars: number, afterChars: number) {
  const text = doc.getText();
  let b = Math.max(0, offset - beforeChars);
  if (b > 0) b = text.indexOf('\n', b) + 1 || b; // začít na celém řádku (lepší cache)
  let a = Math.min(text.length, offset + afterChars);
  if (a < text.length) {
    const nl = text.lastIndexOf('\n', a);
    if (nl > offset) a = nl;
  }
  return { text, before: text.slice(b, offset), after: text.slice(offset, a) };
}

// ---------- společné generování velkým modelem ----------

interface GenResult {
  title: string;
  lines: string[];
  /** Jistota AI 0–1: geometrický průměr pravděpodobností tokenů kódu (bez řádku APPROACH). */
  confidence?: number;
}

async function generateFor(
  gen: LlamaServer,
  doc: vscode.TextDocument,
  loc: Located,
  opts: {
    temperature: number;
    avoid?: { title: string; code: string }[];
    approach?: string;
    must?: string[];
    mustNot?: string[];
    signal: AbortSignal;
    onLine?: (l: string) => void;
    onRaw?: (t: string) => void;
    onToken?: () => void;
    /** Už napsaný začátek řádku před kurzorem (když ho model zopakuje, odstřihne se). */
    linePrefix?: string;
  },
): Promise<GenResult> {
  const msgs = buildMessages({
    fileName: doc.fileName,
    langId: doc.languageId,
    before: loc.before,
    after: loc.after,
    mode: loc.mode,
    instruction: loc.info.instruction,
    avoid: opts.avoid,
    approach: opts.approach,
    must: opts.must,
    mustNot: opts.mustNot,
  });
  const lines: string[] = [];
  const st = new BodyStreamer(doc.languageId, loc.signature, (l) => {
    lines.push(l);
    opts.onLine?.(l);
  }, loc.skipLines, opts.linePrefix);
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts.signal.addEventListener('abort', onAbort);
  let raw = '';
  // jistota: jen tokeny kódu, ne úvodní řádek "APPROACH: …"
  let sum = 0;
  let n = 0;
  let seen = '';
  const onLogprob = (lp: number, tok: string) => {
    const inHeader = /^\s*\W*APPROACH/i.test(seen) && !seen.includes('\n');
    seen += tok;
    if (inHeader || st.done || !tok.trim()) return;
    sum += lp;
    n++;
  };
  try {
    for await (const piece of chatStream(gen, msgs, 900, ac.signal, opts.temperature, onLogprob)) {
      raw += piece;
      opts.onRaw?.(raw);
      opts.onToken?.();
      st.push(piece);
      if (st.done) {
        ac.abort();
        break;
      }
    }
  } catch (e) {
    if (!ac.signal.aborted || opts.signal.aborted) throw e;
  } finally {
    opts.signal.removeEventListener('abort', onAbort);
  }
  st.end();
  return { title: st.title, lines, confidence: n ? Math.exp(sum / n) : undefined };
}

/** Šedý text pro kód pod komentářem se zadáním. */
function instrGhost(lines: string[], ins: Instruction): { text: string; fromLineStart: boolean } {
  if (ins.indent.startsWith(ins.curBefore)) return { text: indentLines(lines, ins.indent), fromLineStart: true };
  return { text: [lines[0] ?? '', indentLines(lines.slice(1), ins.indent)].filter((x, i) => i === 0 || x).join('\n'), fromLineStart: false };
}

const shortLabel = (info: { kind: string; label: string; instruction?: string }) => {
  if (info.kind === 'fn') return nameOf(info.label) || info.label.slice(0, 40);
  const t = info.instruction || info.label;
  return t.length > 48 ? t.slice(0, 47) + '…' : t;
};

// ---------- Tab návrhy ----------

class Completer implements vscode.InlineCompletionItemProvider {
  private cache = new Map<string, vscode.InlineCompletionItem[]>();
  /** "Doplň teď!" – do tohoto času je další návrh vynucený. */
  private forceUntil = 0;

  constructor(
    private c: Controller,
    private store: SpotStore,
    private act: Activity,
  ) {}

  force(): void {
    this.forceUntil = Date.now() + 5000;
  }

  async provideInlineCompletionItems(
    doc: vscode.TextDocument,
    pos: vscode.Position,
    ictx: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    // Vynucený návrh: "Doplň teď!" (Alt+Enter) nebo ruční vyvolání ve VS Code.
    const pushed = this.forceUntil > Date.now();
    const forced = pushed || ictx.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;
    if (!this.c.isReady() || (!pushed && !cfg().get('enabled', true))) return;
    const key = `${doc.uri}#${doc.version}#${doc.offsetAt(pos)}`;
    const hit = this.cache.get(key);
    if (hit && !pushed) return hit;

    const lineText = doc.lineAt(pos.line).text;
    const lineSuffix = lineText.slice(pos.character);
    if (!forced && lineSuffix.trim().length > 8) return; // kurzor uprostřed řádku s textem

    if (!forced) {
      await sleep(cfg().get<number>('debounceMs', 200));
      if (token.isCancellationRequested) return;
    }
    if (pushed) this.forceUntil = 0;

    const offset = doc.offsetAt(pos);
    const ac = new AbortController();
    const sub = token.onCancellationRequested(() => ac.abort());
    try {
      let items: vscode.InlineCompletionItem[] | undefined;
      if (forced || cfg().get('autoFunction', true)) {
        const text = doc.getText();
        const unit = indentUnit(doc);
        const ins = detectInstruction(text, offset, doc.languageId);
        const stub = ins ? undefined : detectStub(text, offset, doc.languageId, unit);
        if (ins || stub) items = await this.smart(doc, pos, offset, unit, stub, ins, ac);
      }
      if (!items) items = await this.fim(doc, pos, offset, ac.signal);
      // Na povel a malá AI nic nevymyslela → zkusí to velká.
      if (!items && pushed && !token.isCancellationRequested) items = await this.bigFree(doc, pos, offset, ac);
      if (!items && pushed) vscode.window.setStatusBarMessage('Octomilka: tady mě nic nenapadlo', 3000);
      if (!items || token.isCancellationRequested) return;
      this.cache.set(key, items);
      if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value!);
      return items;
    } catch (e) {
      if (!ac.signal.aborted) log(`návrh: ${(e as Error).message}`);
      return;
    } finally {
      sub.dispose();
    }
  }

  private async fim(doc: vscode.TextDocument, pos: vscode.Position, offset: number, signal: AbortSignal) {
    const { before, after } = windowAround(doc, offset, 6000, 2000);
    // Název souboru a jazyk na začátek, jinak malý model u krátkého souboru hádá jazyk.
    const c = lineComment(doc.languageId);
    const header = `${c.open} ${path.basename(doc.fileName)} (${langName(doc.languageId, doc.fileName)})${c.close}\n`;
    const nIndent = indentOf(doc.lineAt(pos.line).text).length;
    const job = this.act.start('tab', '');
    try {
      let text = await infill(this.c.tab!, header + before, after, extraContext(doc), nIndent, signal);
      text = trimOverlap(text, after);
      const lines = text.split('\n');
      if (lines.length > 15) text = lines.slice(0, 15).join('\n');
      if (!text.trim()) return;
      return [new vscode.InlineCompletionItem(text, new vscode.Range(pos, pos))];
    } finally {
      this.act.end(job);
    }
  }

  /** "Doplň teď!" bez funkce/komentáře: velká AI dopíše, co dává smysl u kurzoru. */
  private async bigFree(doc: vscode.TextDocument, pos: vscode.Position, offset: number, ac: AbortController) {
    const gen = await this.c.ensureGen();
    const indent = indentOf(doc.lineAt(pos.line).text);
    const { before, after } = windowAround(doc, offset, 3500, 1200);
    const loc = {
      info: { key: '', kind: 'fn', label: '', uri: doc.uri.toString(), lang: doc.languageId },
      range: [offset, offset],
      current: [],
      before,
      after,
      signature: null,
      skipLines: [],
      mode: 'free',
      replacement: (l: string[]) => indentLines(l, indent),
    } as unknown as Located;
    const job = this.act.start('cmd', 'doplnění na povel', () => ac.abort());
    try {
      const linePrefix = doc.lineAt(pos.line).text.slice(0, pos.character);
      const r = await generateFor(gen, doc, loc, { temperature: 0.1, signal: ac.signal, onToken: () => this.act.tick(job), linePrefix });
      if (ac.signal.aborted || !r.lines.some((l) => l.trim())) return;
      const text = [r.lines[0], ...r.lines.slice(1).map((l) => (l ? indent + l : ''))].join('\n');
      return [new vscode.InlineCompletionItem(text, new vscode.Range(pos, pos))];
    } finally {
      this.act.end(job);
    }
  }

  /** Celá funkce / kód podle komentáře velkým modelem. Pamatuje si všechna řešení pro dané místo. */
  private async smart(
    doc: vscode.TextDocument,
    pos: vscode.Position,
    offset: number,
    unit: string,
    stub: Stub | undefined,
    ins: Instruction | undefined,
    ac: AbortController,
  ) {
    const loc = resolveAt(doc, offset, this.store, unit);
    if (!loc) return;
    let variants = this.store.ordered(loc.info.key);
    if (!variants.length) {
      const gen = await this.c.ensureGen();
      const job = this.act.start(stub ? 'fn' : 'instr', shortLabel(loc.info), () => ac.abort());
      this.c.busy++;
      this.c.render();
      try {
        const r = await generateFor(gen, doc, loc, { temperature: 0.1, signal: ac.signal, onToken: () => this.act.tick(job) });
        if (ac.signal.aborted) return;
        await this.store.add(loc.info, { title: r.title, lines: r.lines, origin: 'ai', confidence: r.confidence });
      } finally {
        this.act.end(job);
        this.c.busy--;
        this.c.render();
      }
      variants = this.store.ordered(loc.info.key);
    }
    // Nejlepší (nejvyšší jistota) první; ostatní jde přepínat Alt+] / Alt+[.
    return variants
      .filter((v) => v.lines.some((l) => l.trim()))
      .map((v) => {
        const g = stub ? stubGhost(v.lines, stub) : instrGhost(v.lines, ins!);
        const range = new vscode.Range(g.fromLineStart ? new vscode.Position(pos.line, 0) : pos, pos);
        return new vscode.InlineCompletionItem(g.text, range);
      });
  }
}

// ---------- Ctrl+Alt+Enter: dopsat funkci / kód (streamuje rovnou do souboru) ----------

async function generateCommand(c: Controller, store: SpotStore, act: Activity): Promise<void> {
  const ed = vscode.window.activeTextEditor;
  if (!ed) {
    vscode.window.showInformationMessage('Octomilka: nejdřív klikni do souboru s kódem.');
    return;
  }
  const doc = ed.document;
  const unit = indentUnit(doc);
  let pos = ed.selection.active;
  const text0 = doc.getText();
  const ins = detectInstruction(text0, doc.offsetAt(pos), doc.languageId);
  const stub = ins ? undefined : detectStub(text0, doc.offsetAt(pos), doc.languageId, unit);

  let gen: LlamaServer;
  try {
    gen = await c.ensureGen();
  } catch (e) {
    vscode.window.showErrorMessage(`Octomilka: ${(e as Error).message}`);
    return;
  }

  // Připravit prázdný řádek uvnitř těla / pod komentářem, kam se bude psát.
  let inner: string;
  const lineText = doc.lineAt(pos.line).text;
  if (stub) {
    inner = stub.inner;
    let prep = '';
    if (stub.kind === 'inline') prep = '\n' + inner + '\n' + stub.sigIndent;
    else if (stub.kind === 'open') prep = '\n' + inner;
    if (prep) {
      await ed.edit((e) => e.insert(pos, prep));
      pos = doc.positionAt(doc.offsetAt(pos) + 1 + inner.length);
    } else {
      const r = new vscode.Range(pos.line, 0, pos.line, lineText.length);
      await ed.edit((e) => e.replace(r, inner));
      pos = new vscode.Position(pos.line, inner.length);
    }
  } else if (ins) {
    inner = ins.indent; // signature pro odstranění zopakované hlavičky dodá resolveAt
    const r = new vscode.Range(pos.line, 0, pos.line, lineText.length);
    await ed.edit((e) => e.replace(r, inner));
    pos = new vscode.Position(pos.line, inner.length);
  } else {
    inner = indentOf(lineText);
    if (lineText.trim()) {
      const end = doc.lineAt(pos.line).range.end;
      await ed.edit((e) => e.insert(end, '\n' + inner));
      pos = new vscode.Position(pos.line + 1, inner.length);
    }
  }
  ed.selection = new vscode.Selection(pos, pos);

  const offset = doc.offsetAt(pos);
  // Místo pro paměť (funkce / zadání) – v prázdném stavu, ještě před psaním.
  const loc: Located =
    (stub || ins ? resolveAt(doc, offset, store, unit) : undefined) ??
    (() => {
      const { before, after } = windowAround(doc, offset, 3500, 1200);
      return {
        info: { key: '', kind: 'fn', label: '', uri: doc.uri.toString(), lang: doc.languageId },
        range: [offset, offset],
        current: [],
        before,
        after,
        signature: null,
        skipLines: [],
        mode: 'instr',
        replacement: (l: string[]) => indentLines(l, inner),
      } as Located;
    })();
  const freeMode = !stub && !ins;

  let insertAt = doc.offsetAt(pos);
  let first = true;
  let chain = Promise.resolve();
  const write = (line: string) => {
    const t = first ? line : '\n' + (line ? inner + line : '');
    first = false;
    chain = chain.then(async () => {
      const p = doc.positionAt(insertAt);
      const ok = await ed.edit((e) => e.insert(p, t), { undoStopBefore: false, undoStopAfter: false });
      if (ok) insertAt += t.length;
    });
  };

  const ac = new AbortController();
  const stopOnSwitch = vscode.window.onDidChangeActiveTextEditor(() => ac.abort());
  const job = act.start('cmd', loc.info.key ? shortLabel(loc.info) : path.basename(doc.fileName), () => ac.abort());
  c.busy++;
  c.render();
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Octomilka píše…', cancellable: true },
      async (_p, token) => {
        token.onCancellationRequested(() => ac.abort());
        const msgsMode = freeMode ? { ...loc, mode: 'free' as const } : loc;
        const r = await generateFor(gen, doc, msgsMode as Located, {
          temperature: 0.1,
          signal: ac.signal,
          onLine: write,
          onToken: () => act.tick(job),
        });
        await chain;
        if (!freeMode && loc.info.key && !ac.signal.aborted)
          await store.add(loc.info, { title: r.title, lines: r.lines, origin: 'ai', confidence: r.confidence });
      },
    );
  } catch (e) {
    if (!ac.signal.aborted) {
      log(`generování: ${(e as Error).message}`);
      vscode.window.showErrorMessage(`Octomilka: ${(e as Error).message}`);
    }
  } finally {
    stopOnSwitch.dispose();
    act.end(job);
    c.busy--;
    c.render();
  }
}

// ---------- Jiné řešení (spodní panel) ----------

class Solutions implements ViewHost {
  private abort?: AbortController;
  private hints = new Map<string, number>();

  constructor(
    private c: Controller,
    readonly store: SpotStore,
    private act: Activity,
    private view: OctoView,
  ) {}

  status() {
    return {
      engine: this.c.state,
      progress: this.c.progress,
      downloadSize: this.c.downloadSize,
      profile: PROFILES[this.c.profile].label,
      enabled: cfg().get('enabled', true),
      tab: { phase: this.c.tab?.phase ?? 'stopped', device: this.c.tab?.device ?? '' },
      gen: { phase: this.c.gen?.phase ?? 'stopped', device: this.c.gen?.device ?? '' },
      jobs: this.act.list(),
    };
  }

  resolveCursor(ed: vscode.TextEditor): Located | undefined {
    const doc = ed.document;
    if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'untitled') return undefined;
    const loc = resolveAt(doc, doc.offsetAt(ed.selection.active), this.store, indentUnit(doc));
    if (loc) this.hints.set(loc.info.key, loc.range[0]);
    return loc;
  }

  async locateInfo(info: SpotInfo): Promise<Located | undefined> {
    try {
      return (await this.find(info)).loc;
    } catch {
      return undefined;
    }
  }

  private async docFor(info: SpotInfo): Promise<vscode.TextDocument> {
    return vscode.workspace.textDocuments.find((d) => d.uri.toString() === info.uri) ?? vscode.workspace.openTextDocument(vscode.Uri.parse(info.uri));
  }

  private async find(info: SpotInfo): Promise<{ doc: vscode.TextDocument; loc: Located }> {
    const doc = await this.docFor(info);
    const loc = locate(doc, info, this.hints.get(info.key) ?? 0, this.store, indentUnit(doc));
    if (!loc) throw new Error('To místo už v souboru nenacházím (změnila se hlavička funkce nebo komentář?).');
    this.hints.set(info.key, loc.range[0]);
    return { doc, loc };
  }

  /** Příkaz z editoru: najdi místo u kurzoru, ukaž panel a (volitelně) vymysli jiné řešení. */
  async fromCursor(generate: boolean): Promise<void> {
    const ed = vscode.window.activeTextEditor;
    await this.view.reveal();
    if (!ed) return;
    const loc = this.resolveCursor(ed);
    if (!loc) {
      vscode.window.showInformationMessage('Octomilka: klikni do nějaké funkce, nebo na prázdný řádek pod komentář se zadáním.');
      return;
    }
    if (loc.current.length) await this.store.add(loc.info, { title: 'Tvůj kód', lines: loc.current, origin: 'user' });
    this.view.showSpot(loc);
    if (generate) await this.more(loc.info);
  }

  stop(): void {
    this.abort?.abort();
    this.act.stopAll();
  }

  async more(info: SpotInfo, approach?: string): Promise<void> {
    const view = this.view;
    this.abort?.abort();
    const ac = new AbortController();
    this.abort = ac;
    view.error = undefined;
    view.stream = { title: '', text: '' };
    view.render();
    const f = view.filtersFor(info.key);
    const must = [...f.must];
    const mustNot = [...f.mustNot];
    this.c.busy++;
    this.c.render();
    let job = 0;
    try {
      const gen = await this.c.ensureGen();
      const { doc, loc } = await this.find(info);
      if (loc.current.length) await this.store.add(info, { title: 'Tvůj kód', lines: loc.current, origin: 'user' });
      const known = this.store.ordered(info.key);
      const hasAi = known.some((v) => v.origin === 'ai');
      const avoid = hasAi ? known.map((v) => ({ title: v.title, code: v.lines.slice(0, 18).join('\n') })) : undefined;

      // Krok 1 (jen u jiného řešení): AI vyjmenuje jiné správné přístupy. Bez toho 7B model vymýšlí nesmysly.
      if (hasAi) {
        const fkey = `${must.join('|')}#${mustNot.join('|')}`;
        let list = this.ideasCache.get(info.key + fkey) ?? [];
        if (approach) list = list.filter((x) => x !== approach);
        else {
          if (!list.length) {
            job = this.act.start('ideas', shortLabel(info), () => ac.abort());
            view.stream = { title: 'Vymýšlím, jak to udělat jinak…', text: '' };
            view.render();
            let raw = '';
            const opts = { fileName: doc.fileName, langId: doc.languageId, before: loc.before, after: loc.after, mode: loc.mode, instruction: loc.info.instruction, avoid, must, mustNot };
            for await (const p of chatStream(gen, buildIdeasMessages(opts), 200, ac.signal, 0.3)) {
              raw += p;
              this.act.tick(job);
              view.stream = { title: 'Vymýšlím, jak to udělat jinak…', text: raw };
              view.render();
            }
            this.act.end(job);
            job = 0;
            const used = new Set(known.map((v) => v.title.toLowerCase()));
            list = parseIdeas(raw).filter((x) => !used.has(x.split(':')[0].trim().toLowerCase()));
          }
          approach = list.shift();
        }
        this.ideasCache.set(info.key + fkey, list);
        view.setIdeas(info.key, list);
      }

      job = this.act.start(hasAi ? 'alt' : 'fn', shortLabel(info), () => ac.abort());
      let last = 0;
      const r = await generateFor(gen, doc, loc, {
        temperature: hasAi ? 0.3 : 0.1, // první = nejpravděpodobnější, další podle zvoleného přístupu
        avoid,
        approach,
        must,
        mustNot,
        signal: ac.signal,
        onToken: () => this.act.tick(job),
        onRaw: (raw) => {
          const now = Date.now();
          if (now - last < 120) return;
          last = now;
          const m = /APPROACH\**\s*:\s*(.*)/i.exec(raw);
          const title = m ? m[1].split('\n')[0].trim() : approach?.split(':')[0] ?? '';
          view.stream = { title, text: raw.replace(/^.*APPROACH.*\n?/im, '') };
          view.render();
        },
      });
      if (ac.signal.aborted) return;
      const before = this.store.ordered(info.key).length;
      const v = await this.store.add(info, { title: r.title, lines: r.lines, origin: 'ai', confidence: r.confidence });
      view.stream = undefined;
      if (!v) throw new Error('AI nevrátila žádný kód. Zkus to znovu.');
      if (this.store.ordered(info.key).length === before) view.error = 'AI zopakovala už známé řešení – zkus to znovu.';
      view.select(info.key, v.id);
      await this.apply(info, v.id);
    } catch (e) {
      if (!ac.signal.aborted) {
        view.error = (e as Error).message;
        log(`jiné řešení: ${(e as Error).message}`);
      }
    } finally {
      if (job) this.act.end(job);
      if (this.abort === ac) this.abort = undefined;
      view.stream = undefined;
      view.render();
      this.c.busy--;
      this.c.render();
    }
  }

  /** Nevyužité nápady na jiné přístupy (klíč = místo + filtr), jen v paměti této relace. */
  private ideasCache = new Map<string, string[]>();

  async apply(info: SpotInfo, id: string): Promise<void> {
    const v = this.store.get(info.key)?.variants.find((x) => x.id === id);
    if (!v) return;
    try {
      const { doc, loc } = await this.find(info);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, new vscode.Range(doc.positionAt(loc.range[0]), doc.positionAt(loc.range[1])), loc.replacement(v.lines));
      await vscode.workspace.applyEdit(edit);
      this.view.error = undefined;
      const ed = vscode.window.visibleTextEditors.find((e) => e.document === doc);
      ed?.revealRange(new vscode.Range(doc.positionAt(loc.range[0]), doc.positionAt(loc.range[0])), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      const again = locate(doc, info, loc.range[0], this.store, indentUnit(doc));
      if (again) this.view.showSpot(again);
    } catch (e) {
      this.view.error = (e as Error).message;
      this.view.render();
    }
  }
}

// ---------- automatické aktualizace (GitHub Releases) ----------

class Updater {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private ctx: vscode.ExtensionContext) {}

  get current(): string {
    return this.ctx.extension.packageJSON.version;
  }
  get repo(): string | undefined {
    return repoFrom(this.ctx.extension.packageJSON.repository?.url);
  }

  start(): void {
    if (this.ctx.extensionMode !== vscode.ExtensionMode.Production) return; // při vývoji (F5) neaktualizovat
    setTimeout(() => void this.check(false), 20_000);
    this.timer = setInterval(() => void this.check(false), 6 * 3600_000);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async check(manual: boolean): Promise<void> {
    const mode = cfg().get<string>('autoUpdate', 'auto');
    if (!manual && mode === 'off') return;
    if (this.running) return;
    const last = this.ctx.globalState.get<number>('updateCheckedAt', 0);
    if (!manual && Date.now() - last < 12 * 3600_000) return;
    const repo = this.repo;
    if (!repo) {
      if (manual) vscode.window.showWarningMessage('Octomilka: v package.json chybí GitHub repozitář, nemám odkud aktualizovat.');
      return;
    }
    this.running = true;
    try {
      const rel = await latestRelease(repo);
      await this.ctx.globalState.update('updateCheckedAt', Date.now());
      if (!rel || compareVersions(rel.version, this.current) <= 0) {
        if (manual) vscode.window.showInformationMessage(`Octomilka: máš nejnovější verzi (${this.current}).`);
        return;
      }
      log(`Nová verze ${rel.version} (mám ${this.current}).`);
      if (!manual && this.ctx.globalState.get('updateSkip') === rel.version) return;
      if (mode === 'auto' && !manual) await this.install(rel, false);
      else await this.offer(rel);
    } catch (e) {
      log(`aktualizace: ${(e as Error).message}`);
      if (manual) vscode.window.showErrorMessage(`Octomilka: kontrola aktualizací selhala – ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async offer(rel: Release): Promise<void> {
    const notes = shortNotes(rel.notes);
    const pick = await vscode.window.showInformationMessage(
      `Octomilka ${rel.version} je venku (máš ${this.current}).${notes ? ' ' + notes : ''}`,
      'Aktualizovat',
      'Co je nového',
      'Přeskočit tuto verzi',
    );
    if (pick === 'Aktualizovat') await this.install(rel, true);
    if (pick === 'Co je nového') void vscode.env.openExternal(vscode.Uri.parse(rel.url));
    if (pick === 'Přeskočit tuto verzi') await this.ctx.globalState.update('updateSkip', rel.version);
  }

  private async install(rel: Release, withProgress: boolean): Promise<void> {
    const dir = path.join(this.ctx.globalStorageUri.fsPath, 'updates');
    const run = async () => {
      await fsp.rm(dir, { recursive: true, force: true });
      const vsix = await downloadRelease(rel, dir); // ověří velikost + SHA256 z GitHubu
      await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsix));
    };
    if (withProgress)
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Octomilka: instaluju ${rel.version}…` }, run);
    else await run();
    log(`Nainstalována verze ${rel.version}, projeví se po načtení okna.`);
    const pick = await vscode.window.showInformationMessage(
      `Octomilka se aktualizovala na ${rel.version}. Projeví se po znovunačtení okna.`,
      'Načíst znovu',
      'Co je nového',
    );
    if (pick === 'Načíst znovu') void vscode.commands.executeCommand('workbench.action.reloadWindow');
    if (pick === 'Co je nového') void vscode.env.openExternal(vscode.Uri.parse(rel.url));
  }
}

// ---------- aktivace ----------

export function activate(ctx: vscode.ExtensionContext): void {
  out = vscode.window.createOutputChannel('Octomilka');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'octomilka.showPanel';
  const c = new Controller(ctx, status);
  const store = new SpotStore(ctx.workspaceState);
  const act = new Activity();
  const view = new OctoView(ctx);
  const sol = new Solutions(c, store, act, view);
  view.bind(sol);
  const upd = new Updater(ctx);
  const completer = new Completer(c, store, act);

  /** "Doplň teď!" – AI hned navrhne, i když zrovna mlčí (i uprostřed řádku, bez čekání). */
  const suggestNow = async () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) {
      vscode.window.showInformationMessage('Octomilka: nejdřív klikni do souboru s kódem.');
      return;
    }
    if (!c.isReady()) {
      if (c.state === 'starting' || c.state === 'downloading') {
        vscode.window.showInformationMessage('Octomilka: AI se ještě připravuje, chvilku strpení.');
        return;
      }
      const pick = await vscode.window.showInformationMessage('Octomilka: AI ještě neběží.', 'Spustit AI');
      if (pick) await c.init(true);
      if (!c.isReady()) return;
    }
    completer.force();
    vscode.window.setStatusBarMessage('$(sync~spin) Octomilka: doplňuju…', 3000);
    await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
    await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
  };

  const pickProfile = async () => {
    const opts = [
      { id: 'auto', label: 'Automaticky (doporučeno)', description: `podle RAM → ${PROFILES[autoProfile()].label}` },
      ...(['small', 'medium', 'large'] as Profile[]).map((p) => ({
        id: p,
        label: PROFILES[p].label,
        description: `${PROFILES[p].tab.label} + ${PROFILES[p].gen.label}`,
      })),
    ];
    const pp = await vscode.window.showQuickPick(opts, { title: 'Jak velkou AI používat? Větší = chytřejší, ale pomalejší a víc RAM.' });
    if (pp) await cfg().update('profile', pp.id, vscode.ConfigurationTarget.Global);
  };

  ctx.subscriptions.push(
    out,
    status,
    { dispose: () => c.dispose() },
    { dispose: () => upd.dispose() },
    vscode.window.registerWebviewViewProvider(OctoView.id, view, { webviewOptions: { retainContextWhenHidden: true } }),
    c.changed.event(() => view.render()),
    act.onChange(() => view.render()),
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, completer),
    vscode.commands.registerCommand('octomilka.suggestNow', suggestNow),
    vscode.commands.registerCommand('octomilka.generate', () => generateCommand(c, store, act)),
    vscode.commands.registerCommand('octomilka.alternative', () => sol.fromCursor(true)),
    vscode.commands.registerCommand('octomilka.solutions', () => sol.fromCursor(false)),
    vscode.commands.registerCommand('octomilka.showPanel', () => view.reveal()),
    vscode.commands.registerCommand('octomilka.stop', () => sol.stop()),
    vscode.commands.registerCommand('octomilka.profile', pickProfile),
    vscode.commands.registerCommand('octomilka.checkUpdates', () => upd.check(true)),
    vscode.commands.registerCommand('octomilka.toggle', async () => {
      const v = !cfg().get('enabled', true);
      await cfg().update('enabled', v, vscode.ConfigurationTarget.Global);
      c.render();
    }),
    vscode.commands.registerCommand('octomilka.setup', async () => {
      await ctx.globalState.update('forceCpu', undefined);
      return c.init(true);
    }),
    vscode.commands.registerCommand('octomilka.log', () => out.show()),
    vscode.commands.registerCommand('octomilka.menu', async () => {
      const en = cfg().get('enabled', true);
      const items: (vscode.QuickPickItem & { id: string })[] = [
        { id: 'panel', label: '$(layout-panel) Otevřít panel Octomilka' },
      ];
      if (c.state === 'needsSetup' || c.state === 'error' || c.state === 'off')
        items.push({ id: 'setup', label: '$(cloud-download) Nainstalovat / spustit AI' });
      items.push(
        { id: 'toggle', label: en ? '$(circle-slash) Vypnout Tab návrhy' : '$(sparkle) Zapnout Tab návrhy' },
        { id: 'now', label: '$(zap) Doplň teď!', description: 'Alt+Enter' },
        { id: 'gen', label: '$(wand) Dopsat funkci / kód u kurzoru', description: 'Ctrl+Alt+Enter' },
        { id: 'alt', label: '$(versions) Jiné řešení', description: 'Alt+Shift+Enter' },
        { id: 'profile', label: '$(server) Velikost AI…', description: PROFILES[c.profile].label },
        { id: 'redl', label: '$(refresh) Restartovat / stáhnout znovu' },
        { id: 'upd', label: '$(sync) Zkontrolovat aktualizace', description: `verze ${upd.current}` },
        { id: 'log', label: '$(output) Log' },
      );
      const pick = await vscode.window.showQuickPick(items, { title: 'Octomilka – lokální AI' });
      if (!pick) return;
      const run: Record<string, string> = {
        panel: 'octomilka.showPanel',
        setup: 'octomilka.setup',
        redl: 'octomilka.setup',
        toggle: 'octomilka.toggle',
        now: 'octomilka.suggestNow',
        gen: 'octomilka.generate',
        alt: 'octomilka.alternative',
        profile: 'octomilka.profile',
        upd: 'octomilka.checkUpdates',
        log: 'octomilka.log',
      };
      void vscode.commands.executeCommand(run[pick.id]);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('octomilka.profile') || e.affectsConfiguration('octomilka.gpu')) {
        void ctx.globalState.update('forceCpu', undefined).then(() => c.init(true));
      } else if (e.affectsConfiguration('octomilka')) c.render();
    }),
  );

  c.render();
  void c.init(false);
  upd.start();
  // Poprvé po instalaci ukázat panel s návodem.
  if (!ctx.globalState.get('panelShown')) {
    void ctx.globalState.update('panelShown', true);
    setTimeout(() => void view.reveal(), 1500);
  }
}

export function deactivate(): void {}
