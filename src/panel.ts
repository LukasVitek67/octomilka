// Panel "Řešení": historie všech návrhů pro jedno místo v kódu, ⭐ = co AI považuje za nejpravděpodobnější.
import * as vscode from 'vscode';
import { SpotInfo, SpotStore } from './spots';
import { html } from './panelHtml';

export interface PanelHost {
  store: SpotStore;
  apply(info: SpotInfo, variantId: string): Promise<void>;
  more(info: SpotInfo, approach?: string): Promise<void>;
  stop(): void;
}

export class SolutionsPanel {
  static current?: SolutionsPanel;
  private panel: vscode.WebviewPanel;
  info?: SpotInfo;
  stream?: { title: string; text: string };
  appliedId?: string;
  error?: string;
  ideas: string[] = [];

  static show(host: PanelHost, info: SpotInfo): SolutionsPanel {
    if (!SolutionsPanel.current) SolutionsPanel.current = new SolutionsPanel(host);
    const p = SolutionsPanel.current;
    if (p.info?.key !== info.key) {
      p.appliedId = undefined;
      p.stream = undefined;
      p.error = undefined;
      p.ideas = [];
    }
    p.info = info;
    p.panel.reveal(vscode.ViewColumn.Beside, true);
    p.render();
    return p;
  }

  private constructor(private host: PanelHost) {
    this.panel = vscode.window.createWebviewPanel(
      'octomilka.solutions',
      'Octomilka · řešení',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    this.panel.webview.html = html(this.panel.webview.cspSource);
    const subs = [
      this.panel.webview.onDidReceiveMessage(async (m) => {
        if (!this.info) return;
        if (m.type === 'apply') await this.host.apply(this.info, m.id);
        if (m.type === 'more') await this.host.more(this.info);
        if (m.type === 'idea' && typeof m.text === 'string') await this.host.more(this.info, m.text);
        if (m.type === 'stop') this.host.stop();
        if (m.type === 'copy') {
          const v = this.host.store.get(this.info.key)?.variants.find((x) => x.id === m.id);
          if (v) await vscode.env.clipboard.writeText(v.lines.join('\n'));
        }
        if (m.type === 'remove') await this.host.store.remove(this.info.key, m.id);
        if (m.type === 'ready') this.render();
      }),
      this.host.store.onDidChange((k) => k === this.info?.key && this.render()),
    ];
    this.panel.onDidDispose(() => {
      subs.forEach((s) => s.dispose());
      SolutionsPanel.current = undefined;
    });
  }

  render(): void {
    if (!this.info) return;
    const variants = this.host.store.ordered(this.info.key);
    void this.panel.webview.postMessage({
      type: 'state',
      kind: this.info.kind,
      label: this.info.label,
      instruction: this.info.instruction,
      file: decodeURIComponent(this.info.uri.split('/').pop() || ''),
      variants,
      appliedId: this.appliedId,
      stream: this.stream,
      error: this.error,
      ideas: this.ideas,
    });
  }
}
