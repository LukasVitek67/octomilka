// Náhled spodního panelu s ukázkovými daty (jen vývoj). node tools/preview/mkview.cjs → tools/preview/out/*.html
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const out = path.join(OUT, 'viewHtml.cjs');
execSync(`npx esbuild src/viewHtml.ts --format=cjs --outfile="${out}" --log-level=warning`, { cwd: path.join(__dirname, '..', '..') });
const { viewHtml } = require(out);

const theme = {
  dark: '--vscode-font-family:Segoe UI,sans-serif;--vscode-editor-font-family:Consolas,monospace;--vscode-foreground:#cccccc;--vscode-panel-background:#181818;--vscode-descriptionForeground:#9d9d9d;--vscode-panel-border:#2b2b2b;--vscode-sideBar-background:#181818;--vscode-charts-yellow:#cca700;--vscode-charts-green:#89d185;--vscode-charts-red:#f14c4c;--vscode-charts-purple:#b180d7;--vscode-charts-blue:#3794ff;--vscode-focusBorder:#0078d4;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#026ec1;--vscode-button-secondaryBackground:#313131;--vscode-button-secondaryForeground:#ccc;--vscode-button-secondaryHoverBackground:#3c3c3c;--vscode-textCodeBlock-background:#2b2b2b;--vscode-list-hoverBackground:#2a2d2e;--vscode-list-activeSelectionBackground:#04395e;--vscode-list-activeSelectionForeground:#fff;--vscode-input-background:#313131;--vscode-input-foreground:#ccc;--vscode-input-border:#3c3c3c;--vscode-textLink-foreground:#4daafc;--vscode-errorForeground:#f85149;',
  light: '--vscode-font-family:Segoe UI,sans-serif;--vscode-editor-font-family:Consolas,monospace;--vscode-foreground:#3b3b3b;--vscode-panel-background:#f8f8f8;--vscode-descriptionForeground:#717171;--vscode-panel-border:#e5e5e5;--vscode-sideBar-background:#f8f8f8;--vscode-charts-yellow:#bf8803;--vscode-charts-green:#388a34;--vscode-charts-red:#e51400;--vscode-charts-purple:#652d90;--vscode-charts-blue:#1a85ff;--vscode-focusBorder:#005fb8;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#0258a8;--vscode-button-secondaryBackground:#e5e5e5;--vscode-button-secondaryForeground:#3b3b3b;--vscode-button-secondaryHoverBackground:#cccccc;--vscode-textCodeBlock-background:#ebebeb;--vscode-list-hoverBackground:#f2f2f2;--vscode-list-activeSelectionBackground:#e8e8e8;--vscode-list-activeSelectionForeground:#000;--vscode-input-background:#fff;--vscode-input-foreground:#3b3b3b;--vscode-input-border:#cecece;--vscode-textLink-foreground:#005fb8;--vscode-errorForeground:#f85149;',
};
const v = (id, title, conf, extra, lines) => ({ id, title, confidence: conf, origin: 'ai', best: false, at: 1, lines, inCode: false, matches: true, ...extra });
const ready = { engine: 'ready', progress: '', downloadSize: '6,3 GB', profile: 'střední (16 GB RAM)', enabled: true, tab: { phase: 'running', device: 'GPU' }, gen: { phase: 'running', device: 'CPU' }, jobs: [] };
const scenarios = {
  main: {
    status: { ...ready, jobs: [{ id: 1, kind: 'alt', label: 'isPrime', started: Date.now() - 12000, tokens: 85 }] },
    spot: { kind: 'fn', label: 'function isPrime(n: number): boolean {', file: 'prime.ts' },
    filters: { must: ['for'], mustNot: ['Array'] },
    selectedId: 'a',
    variants: [
      v('a', 'Dělení do odmocniny', 0.93, { best: true, rank: 1, inCode: true }, ['if (n <= 1) return false;', 'if (n <= 3) return true;', 'if (n % 2 === 0 || n % 3 === 0) return false;', 'for (let i = 5; i * i <= n; i += 6) {', '  if (n % i === 0 || n % (i + 2) === 0) return false;', '}', 'return true;']),
      v('b', 'Rekurzivní dělení', 0.78, { rank: 2 }, ['const check = (d: number): boolean => d * d > n || (n % d !== 0 && check(d + 1));', 'return n > 1 && check(2);']),
      v('c', 'Eratosthenovo síto', 0.71, { rank: 3, matches: false }, ['const sieve = new Array(n + 1).fill(true);']),
      { id: 'u', title: 'Tvůj kód', origin: 'user', best: false, at: 2, lines: ['return n > 1;'], rank: 4, inCode: false, matches: true },
    ],
    stream: { title: 'Tabulka malých prvočísel', text: 'const SMALL = [2, 3, 5, 7, 11, 13];\nif (n < 2) return false;\nfor (const p of SMALL) {' },
    ideas: [],
    error: null,
  },
  idle: null, // doplní se níže
  setup: { status: { ...ready, engine: 'needsSetup', tab: { phase: 'stopped' }, gen: { phase: 'stopped' } }, spot: null, variants: [], filters: { must: [], mustNot: [] }, ideas: [] },
  nospot: { status: { ...ready, gen: { phase: 'stopped', device: '' } }, spot: null, variants: [], filters: { must: [], mustNot: [] }, ideas: [] },
};
scenarios.idle = { ...scenarios.main, status: ready, stream: null, filters: { must: [], mustNot: [] }, variants: scenarios.main.variants.map((x) => ({ ...x, matches: true })), ideas: ['Lookup table: Precompute small primes and test only against them.', 'Wheel factorization: Skip multiples of 2, 3 and 5.'] };

for (const [name, st] of Object.entries(scenarios)) {
  for (const t of ['dark', 'light']) {
    let page = viewHtml('self', false).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
    page = page.replace('<style>', `<style>:root{${theme[t]}}`);
    const mock = `const vscode = { postMessage: (m) => { console.log('post', JSON.stringify(m)); if (m.type === 'ready') setTimeout(() => window.postMessage(Object.assign({ type: 'state' }, ${JSON.stringify(st)}), '*'), 0); } };`;
    page = page.replace('const vscode = acquireVsCodeApi();', mock);
    fs.writeFileSync(path.join(OUT, `view-${name}-${t}.html`), page);
  }
}
console.log('ok', Object.keys(scenarios).join(', '));
