// Spodní panel Octomilka: živý stav AI, zkratky, řešení seřazená podle jistoty, finder (musí / nesmí obsahovat).
import * as vscode from 'vscode';
import { SpotInfo, SpotStore, Located, matchesFilter } from './spots';
import { viewHtml } from './viewHtml';

export interface Filters {
  must: string[];
  mustNot: string[];
}

export interface ViewHost {
  store: SpotStore;
  status(): unknown; // data pro stavový řádek
  resolveCursor(ed: vscode.TextEditor): Located | undefined;
  locateInfo(info: SpotInfo): Promise<Located | undefined>;
  apply(info: SpotInfo, id: string): Promise<void>;
  more(info: SpotInfo, approach?: string): Promise<void>;
  stop(): void;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

export class OctoView implements vscode.WebviewViewProvider {
  static readonly id = 'octomilka.view';
  private view?: vscode.WebviewView;
  private host!: ViewHost;
  info?: SpotInfo;
  private current: string[] = []; // co je teď v kódu na tom místě
  private filters = new Map<string, Filters>();
  private ideas = new Map<string, string[]>();
  private selected = new Map<string, string>();
  stream?: { title: string; text: string };
  error?: string;
  private timer?: NodeJS.Timeout;
  private follow?: NodeJS.Timeout;

  constructor(private ctx: vscode.ExtensionContext) {}

  bind(host: ViewHost): void {
    this.host = host;
    this.ctx.subscriptions.push(
      host.store.onDidChange((k) => k === this.info?.key && void this.refreshCurrent()),
      vscode.window.onDidChangeTextEditorSelection((e) => this.followSoon(e.textEditor)),
      vscode.window.onDidChangeActiveTextEditor((ed) => ed && this.followSoon(ed)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.info && e.document.uri.toString() === this.info.uri) {
          const ed = vscode.window.activeTextEditor;
          if (ed && ed.document === e.document) this.followSoon(ed);
        }
      }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = viewHtml(view.webview.cspSource, process.platform === 'darwin');
    view.webview.onDidReceiveMessage((m) => void this.onMessage(m));
    view.onDidChangeVisibility(() => this.tickTimer());
    view.onDidDispose(() => {
      this.view = undefined;
      this.tickTimer();
    });
    this.tickTimer();
    const ed = vscode.window.activeTextEditor;
    if (ed) this.followSoon(ed, 0);
  }

  get visible(): boolean {
    return !!this.view?.visible;
  }

  /** Ukázat panel dole, kurzor zůstane v editoru. */
  async reveal(): Promise<void> {
    if (this.view) {
      this.view.show(true);
      return;
    }
    await vscode.commands.executeCommand('workbench.view.extension.octomilka');
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  }

  /** Stav se mění pořád (čas přemýšlení) – posílat 1× za sekundu, jen když je panel vidět. */
  private tickTimer(): void {
    const want = !!this.view?.visible;
    if (want && !this.timer) this.timer = setInterval(() => this.postStatus(), 1000);
    if (!want && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (want) this.render();
  }

  private followSoon(ed: vscode.TextEditor, ms = 350): void {
    if (!this.view?.visible || ed.document.uri.scheme === 'output') return;
    if (this.follow) clearTimeout(this.follow);
    this.follow = setTimeout(() => {
      const loc = this.host.resolveCursor(ed);
      if (loc) this.showSpot(loc);
    }, ms);
  }

  showSpot(loc: Located): void {
    if (this.info?.key !== loc.info.key) {
      this.stream = undefined;
      this.error = undefined;
    }
    this.info = loc.info;
    this.current = loc.current;
    this.render();
  }

  private async refreshCurrent(): Promise<void> {
    if (!this.info) return;
    const loc = await this.host.locateInfo(this.info);
    if (loc) this.current = loc.current;
    this.render();
  }

  filtersFor(key: string): Filters {
    let f = this.filters.get(key);
    if (!f) this.filters.set(key, (f = { must: [], mustNot: [] }));
    return f;
  }
  setIdeas(key: string, list: string[]): void {
    this.ideas.set(key, list);
    this.render();
  }
  select(key: string, id: string): void {
    this.selected.set(key, id);
  }

  private async onMessage(m: any): Promise<void> {
    const cmd = (c: string) => vscode.commands.executeCommand(c);
    switch (m.type) {
      case 'ready':
        return this.render();
      case 'setup':
        return void cmd('octomilka.setup');
      case 'toggle':
        return void cmd('octomilka.toggle');
      case 'log':
        return void cmd('octomilka.log');
      case 'profile':
        return void cmd('octomilka.profile');
      case 'updates':
        return void cmd('octomilka.checkUpdates');
      case 'settings':
        return void vscode.commands.executeCommand('workbench.action.openSettings', 'octomilka');
      case 'generate':
        await cmd('workbench.action.focusActiveEditorGroup');
        return void cmd('octomilka.generate');
      case 'stop':
        return this.host.stop();
    }
    if (!this.info) return;
    const info = this.info;
    const f = this.filtersFor(info.key);
    switch (m.type) {
      case 'select':
        this.selected.set(info.key, m.id);
        return this.render();
      case 'apply':
        this.selected.set(info.key, m.id);
        return this.host.apply(info, m.id);
      case 'copy': {
        const v = this.host.store.get(info.key)?.variants.find((x) => x.id === m.id);
        if (v) {
          await vscode.env.clipboard.writeText(v.lines.join('\n'));
          vscode.window.setStatusBarMessage('Octomilka: zkopírováno', 2000);
        }
        return;
      }
      case 'remove':
        return this.host.store.remove(info.key, m.id);
      case 'more':
        return this.host.more(info);
      case 'idea':
        return this.host.more(info, String(m.text));
      case 'addFilter': {
        const list = m.kind === 'mustNot' ? f.mustNot : f.must;
        const other = m.kind === 'mustNot' ? f.must : f.mustNot;
        for (const raw of String(m.text).split(',')) {
          const t = raw.trim();
          if (!t || list.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
          list.push(t);
          const i = other.findIndex((x) => x.toLowerCase() === t.toLowerCase());
          if (i >= 0) other.splice(i, 1);
        }
        return this.render();
      }
      case 'removeFilter': {
        const list = m.kind === 'mustNot' ? f.mustNot : f.must;
        const i = list.indexOf(m.text);
        if (i >= 0) list.splice(i, 1);
        return this.render();
      }
      case 'clearFilter':
        f.must = [];
        f.mustNot = [];
        return this.render();
    }
  }

  private postStatus(): void {
    void this.view?.webview.postMessage({ type: 'status', status: this.host.status() });
  }

  render(): void {
    if (!this.view) return;
    const info = this.info;
    let spot: unknown = null;
    let variants: unknown[] = [];
    let filters: Filters = { must: [], mustNot: [] };
    let selectedId: string | undefined;
    if (info) {
      filters = this.filtersFor(info.key);
      const cur = norm(this.current.join('\n'));
      const all = this.host.store.ordered(info.key);
      variants = all.map((v, i) => ({
        ...v,
        rank: i + 1,
        inCode: !!cur && norm(v.lines.join('\n')) === cur,
        matches: matchesFilter(v.lines, filters.must, filters.mustNot),
      }));
      const vis = (variants as any[]).filter((v) => v.matches);
      selectedId = this.selected.get(info.key);
      if (!vis.some((v) => v.id === selectedId)) selectedId = (vis.find((v) => v.inCode) ?? vis[0])?.id;
      spot = {
        kind: info.kind,
        label: info.kind === 'fn' ? info.label : info.instruction || info.label,
        file: decodeURIComponent(info.uri.split('/').pop() || ''),
      };
    }
    void this.view.webview.postMessage({
      type: 'state',
      status: this.host.status(),
      spot,
      variants,
      filters,
      selectedId,
      stream: this.stream,
      error: this.error,
      ideas: info ? this.ideas.get(info.key) ?? [] : [],
    });
  }
}
