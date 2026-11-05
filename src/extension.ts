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
  ExtraChunk,
} from './engine';
import { detectStub, stubGhost, bodyLines, BodyStreamer, trimOverlap, indentOf, Stub } from './stub';

type State = 'off' | 'needsSetup' | 'downloading' | 'starting' | 'ready' | 'error';

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
    s.show();
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

// ---------- Tab návrhy ----------

class Completer implements vscode.InlineCompletionItemProvider {
  private cache = new Map<string, vscode.InlineCompletionItem[]>();

  constructor(private c: Controller) {}

  async provideInlineCompletionItems(
    doc: vscode.TextDocument,
    pos: vscode.Position,
    ictx: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (!cfg().get('enabled', true) || !this.c.isReady()) return;
    const key = `${doc.uri}#${doc.version}#${doc.offsetAt(pos)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const lineText = doc.lineAt(pos.line).text;
    const lineSuffix = lineText.slice(pos.character);
    if (lineSuffix.trim().length > 8) return; // kurzor uprostřed řádku s textem

    if (ictx.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
      await sleep(cfg().get<number>('debounceMs', 200));
      if (token.isCancellationRequested) return;
    }

    const offset = doc.offsetAt(pos);
    const ac = new AbortController();
    const sub = token.onCancellationRequested(() => ac.abort());
    try {
      const stub = cfg().get('autoFunction', true)
        ? detectStub(doc.getText(), offset, doc.languageId, indentUnit(doc))
        : undefined;
      let items: vscode.InlineCompletionItem[] | undefined;
      if (stub) items = await this.functionBody(doc, pos, offset, stub, ac.signal);
      else items = await this.fim(doc, pos, offset, ac.signal);
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
    const nIndent = indentOf(doc.lineAt(pos.line).text).length;
    let text = await infill(this.c.tab!, before, after, extraContext(doc), nIndent, signal);
    text = trimOverlap(text, after);
    const lines = text.split('\n');
    if (lines.length > 15) text = lines.slice(0, 15).join('\n');
    if (!text.trim()) return;
    return [new vscode.InlineCompletionItem(text, new vscode.Range(pos, pos))];
  }

  private async functionBody(
    doc: vscode.TextDocument,
    pos: vscode.Position,
    offset: number,
    stub: Stub,
    signal: AbortSignal,
  ) {
    const gen = await this.c.ensureGen();
    const { before, after } = windowAround(doc, offset, 3500, 1200);
    const msgs = buildMessages(path.basename(doc.fileName), doc.languageId, before, after, 'body');
    const lines: string[] = [];
    const st = new BodyStreamer(doc.languageId, stub.signature, (l) => lines.push(l));
    this.c.busy++;
    this.c.render();
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    signal.addEventListener('abort', onAbort);
    try {
      for await (const piece of chatStream(gen, msgs, 700, ac.signal)) {
        st.push(piece);
        if (st.done) {
          ac.abort();
          break;
        }
      }
    } catch (e) {
      if (!ac.signal.aborted || signal.aborted) throw e;
    } finally {
      signal.removeEventListener('abort', onAbort);
      this.c.busy--;
      this.c.render();
    }
    st.end();
    if (!lines.some((l) => l.trim())) return;
    const g = stubGhost(lines, stub);
    const range = new vscode.Range(g.fromLineStart ? new vscode.Position(pos.line, 0) : pos, pos);
    return [new vscode.InlineCompletionItem(g.text, range)];
  }
}

// ---------- Ctrl+Alt+Enter: dopsat funkci / kód (streamuje rovnou do souboru) ----------

async function generateCommand(c: Controller): Promise<void> {
  const ed = vscode.window.activeTextEditor;
  if (!ed) return;
  const doc = ed.document;
  const unit = indentUnit(doc);
  let pos = ed.selection.active;
  const stub = detectStub(doc.getText(), doc.offsetAt(pos), doc.languageId, unit);

  let gen: LlamaServer;
  try {
    gen = await c.ensureGen();
  } catch (e) {
    vscode.window.showErrorMessage(`Octomilka: ${(e as Error).message}`);
    return;
  }

  // Připravit prázdný řádek uvnitř těla / pod komentářem, kam se bude psát.
  let inner: string;
  let mode: 'body' | 'free';
  const lineText = doc.lineAt(pos.line).text;
  if (stub) {
    mode = 'body';
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
  } else {
    mode = 'free';
    inner = indentOf(lineText);
    if (lineText.trim()) {
      const end = doc.lineAt(pos.line).range.end;
      await ed.edit((e) => e.insert(end, '\n' + inner));
      pos = new vscode.Position(pos.line + 1, inner.length);
    }
  }
  ed.selection = new vscode.Selection(pos, pos);

  const offset = doc.offsetAt(pos);
  const { before, after } = windowAround(doc, offset, 3500, 1200);
  const msgs = buildMessages(path.basename(doc.fileName), doc.languageId, before, after, mode);

  let insertAt = doc.offsetAt(pos);
  let first = true;
  let chain = Promise.resolve();
  const write = (line: string) => {
    const text = first ? line : '\n' + (line ? inner + line : '');
    first = false;
    chain = chain.then(async () => {
      const p = doc.positionAt(insertAt);
      const ok = await ed.edit((e) => e.insert(p, text), { undoStopBefore: false, undoStopAfter: false });
      if (ok) insertAt += text.length;
    });
  };
  const st = new BodyStreamer(doc.languageId, mode === 'body' ? stub!.signature : null, write);

  const ac = new AbortController();
  const stopOnSwitch = vscode.window.onDidChangeActiveTextEditor(() => ac.abort());
  c.busy++;
  c.render();
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Octomilka píše…', cancellable: true },
      async (_p, token) => {
        token.onCancellationRequested(() => ac.abort());
        try {
          for await (const piece of chatStream(gen, msgs, 1200, ac.signal)) {
            st.push(piece);
            if (st.done) {
              ac.abort();
              break;
            }
          }
        } catch (e) {
          if (!ac.signal.aborted) throw e;
        }
        st.end();
        await chain;
      },
    );
  } catch (e) {
    log(`generování: ${(e as Error).message}`);
    vscode.window.showErrorMessage(`Octomilka: ${(e as Error).message}`);
  } finally {
    stopOnSwitch.dispose();
    c.busy--;
    c.render();
  }
}

// ---------- aktivace ----------

export function activate(ctx: vscode.ExtensionContext): void {
  out = vscode.window.createOutputChannel('Octomilka');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'octomilka.menu';
  const c = new Controller(ctx, status);

  ctx.subscriptions.push(
    out,
    status,
    { dispose: () => c.dispose() },
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, new Completer(c)),
    vscode.commands.registerCommand('octomilka.generate', () => generateCommand(c)),
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
      const items: (vscode.QuickPickItem & { id: string })[] = [];
      if (c.state === 'needsSetup' || c.state === 'error' || c.state === 'off')
        items.push({ id: 'setup', label: '$(cloud-download) Nainstalovat / spustit AI' });
      items.push(
        { id: 'toggle', label: en ? '$(circle-slash) Vypnout Tab návrhy' : '$(sparkle) Zapnout Tab návrhy' },
        { id: 'gen', label: '$(wand) Dopsat funkci / kód u kurzoru', description: 'Ctrl+Alt+Enter' },
        { id: 'profile', label: '$(server) Velikost modelů…', description: PROFILES[c.profile].label },
        { id: 'redl', label: '$(refresh) Restartovat / stáhnout znovu' },
        { id: 'log', label: '$(output) Log' },
      );
      const pick = await vscode.window.showQuickPick(items, { title: 'Octomilka – lokální AI' });
      if (!pick) return;
      if (pick.id === 'setup' || pick.id === 'redl') vscode.commands.executeCommand('octomilka.setup');
      if (pick.id === 'toggle') vscode.commands.executeCommand('octomilka.toggle');
      if (pick.id === 'gen') vscode.commands.executeCommand('octomilka.generate');
      if (pick.id === 'log') out.show();
      if (pick.id === 'profile') {
        const opts = [
          { id: 'auto', label: 'Automaticky', description: `podle RAM → ${PROFILES[autoProfile()].label}` },
          ...(['small', 'medium', 'large'] as Profile[]).map((p) => ({
            id: p,
            label: PROFILES[p].label,
            description: `${PROFILES[p].tab.label} + ${PROFILES[p].gen.label}`,
          })),
        ];
        const pp = await vscode.window.showQuickPick(opts, { title: 'Velikost modelů' });
        if (pp) await cfg().update('profile', pp.id, vscode.ConfigurationTarget.Global);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('octomilka.profile') || e.affectsConfiguration('octomilka.gpu')) {
        void ctx.globalState.update('forceCpu', undefined).then(() => c.init(true));
      } else if (e.affectsConfiguration('octomilka')) c.render();
    }),
  );

  c.render();
  void c.init(false);
}

export function deactivate(): void {}
