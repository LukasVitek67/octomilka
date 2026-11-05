// HTML panelu Řešení (bez závislosti na vscode, aby šel náhled v prohlížeči).
export function html(csp: string): string {
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return /* html */ `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --gap: 12px; --radius: 6px; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px 16px 88px;
    font: 13px/1.5 var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  header { margin-bottom: 16px; }
  .eyebrow { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
  .anchor {
    margin-top: 4px; font-family: var(--vscode-editor-font-family); font-size: 13px;
    white-space: pre-wrap; word-break: break-word;
  }
  .legend { margin-top: 8px; color: var(--vscode-descriptionForeground); font-size: 12px; }
  .card {
    border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, #8884));
    border-radius: var(--radius); margin-bottom: var(--gap); overflow: hidden;
    background: var(--vscode-sideBar-background, transparent);
  }
  .card.best { border-color: var(--vscode-charts-yellow, #d7ba7d); }
  .card.applied { box-shadow: inset 3px 0 0 var(--vscode-focusBorder); }
  .head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; flex-wrap: wrap; }
  .num { font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); min-width: 22px; }
  .title { font-weight: 600; flex: 1 1 auto; min-width: 120px; }
  .badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; white-space: nowrap; }
  .badge.best { background: var(--vscode-charts-yellow, #d7ba7d); color: var(--vscode-editor-background); font-weight: 600; }
  .badge.user { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .badge.applied { border: 1px solid var(--vscode-focusBorder); color: var(--vscode-focusBorder); }
  .actions { display: flex; gap: 4px; }
  button {
    font: inherit; font-size: 12px; cursor: pointer; border-radius: 4px; padding: 3px 10px;
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.icon { padding: 3px 7px; background: transparent; color: var(--vscode-descriptionForeground); }
  button.icon:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  pre {
    margin: 0; padding: 10px 12px; overflow-x: auto;
    font: var(--vscode-editor-font-size, 13px)/1.45 var(--vscode-editor-font-family);
    background: var(--vscode-textCodeBlock-background, #8881);
    border-top: 1px solid var(--vscode-panel-border, #8883);
  }
  .live .head { color: var(--vscode-descriptionForeground); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-progressBar-background); animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .25; } }
  @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
  .ideas { margin: 4px 0 var(--gap); }
  .ideas h2 { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; font-weight: 600; margin: 0 0 6px; color: var(--vscode-descriptionForeground); }
  .idea {
    display: block; width: 100%; text-align: left; margin-bottom: 6px; padding: 7px 10px;
    background: transparent; border: 1px dashed var(--vscode-panel-border, #8886); color: var(--vscode-foreground);
  }
  .idea:hover { background: var(--vscode-list-hoverBackground); }
  .idea b { font-weight: 600; }
  .idea span { color: var(--vscode-descriptionForeground); }
  .empty, .error { padding: 24px 0; color: var(--vscode-descriptionForeground); }
  .error { color: var(--vscode-errorForeground); }
  footer {
    position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px;
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
    background: var(--vscode-editor-background);
    border-top: 1px solid var(--vscode-panel-border, #8884);
  }
  footer .hint { color: var(--vscode-descriptionForeground); font-size: 12px; }
  kbd { font-family: var(--vscode-editor-font-family); font-size: 11px; padding: 0 4px; border-radius: 3px; border: 1px solid var(--vscode-widget-border, #8886); }
</style>
</head>
<body>
<header>
  <div class="eyebrow" id="kind"></div>
  <div class="anchor" id="anchor"></div>
  <div class="legend">⭐ = řešení, které AI považuje za nejpravděpodobnější (první návrh s nejvyšší jistotou). Další řešení jsou záměrně jiné přístupy a AI si je pamatuje, aby je neopakovala. Malé lokální modely se občas spletou, tak si alternativy před použitím zkontroluj.</div>
</header>
<main id="list"></main>
<footer>
  <button class="primary" id="more">Jiné řešení</button>
  <button id="stop" hidden>Zastavit</button>
  <span class="hint"><kbd>Alt+Shift+Enter</kbd> v editoru · šedé návrhy přepínáš <kbd>Alt+]</kbd> / <kbd>Alt+[</kbd></span>
</footer>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let busy = false;
  $('more').onclick = () => !busy && vscode.postMessage({ type: 'more' });
  $('stop').onclick = () => vscode.postMessage({ type: 'stop' });
  $('list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (b) vscode.postMessage({ type: b.dataset.act, id: b.dataset.id });
    const idea = e.target.closest('button[data-idea]');
    if (idea && !busy) vscode.postMessage({ type: 'idea', text: idea.dataset.idea });
  });
  window.addEventListener('message', ({ data: s }) => {
    if (s.type !== 'state') return;
    busy = !!s.stream;
    $('kind').textContent = (s.kind === 'fn' ? 'Funkce' : 'Zadání z komentáře') + ' · ' + s.file;
    $('anchor').textContent = s.kind === 'fn' ? s.label : (s.instruction || s.label);
    $('more').disabled = busy;
    $('more').textContent = busy ? 'Vymýšlím…' : (s.variants.some((v) => v.origin === 'ai') ? 'Jiné řešení' : 'Navrhnout řešení');
    $('stop').hidden = !busy;
    let h = '';
    s.variants.forEach((v, i) => {
      const cls = ['card', v.best ? 'best' : '', v.id === s.appliedId ? 'applied' : ''].join(' ');
      h += '<section class="' + cls + '"><div class="head">' +
        '<span class="num">#' + (i + 1) + '</span>' +
        '<span class="title">' + esc(v.title) + '</span>' +
        (v.best ? '<span class="badge best">⭐ AI doporučuje</span>' : '') +
        (v.origin === 'user' && v.title !== 'Tvůj kód' ? '<span class="badge user">tvůj kód</span>' : '') +
        (v.id === s.appliedId ? '<span class="badge applied">v kódu</span>' : '') +
        '<span class="actions">' +
        '<button class="primary" data-act="apply" data-id="' + v.id + '">Použít</button>' +
        '<button class="icon" title="Kopírovat" aria-label="Kopírovat" data-act="copy" data-id="' + v.id + '">⧉</button>' +
        '<button class="icon" title="Zapomenout" aria-label="Zapomenout" data-act="remove" data-id="' + v.id + '">✕</button>' +
        '</span></div><pre>' + esc(v.lines.join('\\n')) + '</pre></section>';
    });
    if (s.stream) {
      h += '<section class="card live"><div class="head"><span class="dot"></span><span class="title">' +
        esc(s.stream.title || 'Vymýšlím jiné řešení…') + '</span></div><pre>' + esc(s.stream.text || ' ') + '</pre></section>';
    }
    if (s.ideas && s.ideas.length && !s.stream) {
      h += '<div class="ideas"><h2>Další nápady AI – klikni a napíše ho</h2>' + s.ideas.map((x) => {
        const i = x.indexOf(':');
        const name = i > 0 ? x.slice(0, i) : x;
        const how = i > 0 ? x.slice(i + 1) : '';
        return '<button class="idea" data-idea="' + esc(x) + '"><b>' + esc(name) + '</b>' + (how ? '<span> – ' + esc(how.trim()) + '</span>' : '') + '</button>';
      }).join('') + '</div>';
    }
    if (!h) h = '<div class="empty">Zatím žádné řešení. Klikni na „Navrhnout řešení“.</div>';
    if (s.error) h += '<div class="error">' + esc(s.error) + '</div>';
    $('list').innerHTML = h;
    if (s.stream) window.scrollTo(0, document.body.scrollHeight);
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
