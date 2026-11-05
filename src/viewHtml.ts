// HTML spodního panelu (bez závislosti na vscode, aby šel náhled v prohlížeči).
export function viewHtml(csp: string, mac: boolean): string {
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const k = mac
    ? { now: '⌥Enter', word: '⌘→', next: '⌥] / ⌥[', gen: '⌘⌥Enter', alt: '⌥⇧Enter' }
    : { now: 'Alt+Enter', word: 'Ctrl+→', next: 'Alt+] / Alt+[', gen: 'Ctrl+Alt+Enter', alt: 'Alt+Shift+Enter' };
  return /* html */ `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg: var(--vscode-panel-background, var(--vscode-editor-background));
    --fg: var(--vscode-foreground);
    --muted: var(--vscode-descriptionForeground);
    --line: var(--vscode-panel-border, var(--vscode-widget-border, #8884));
    --card: var(--vscode-sideBar-background, #8881);
    --code: var(--vscode-textCodeBlock-background, #8881);
    --accent: var(--vscode-focusBorder, #3b82f6);
    --ok: var(--vscode-charts-green, #3fb950);
    --warn: var(--vscode-charts-yellow, #d29922);
    --bad: var(--vscode-charts-red, #f85149);
    --think: var(--vscode-charts-purple, #a371f7);
    --info: var(--vscode-charts-blue, #4493f8);
    --mono: var(--vscode-editor-font-family, monospace);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; display: flex; flex-direction: column;
    font: 13px/1.45 var(--vscode-font-family); color: var(--fg); background: var(--bg);
  }
  button {
    font: inherit; font-size: 12px; cursor: pointer; border-radius: 4px; padding: 4px 10px;
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: .5; cursor: default; }
  button:focus-visible, input:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }
  .link { background: none; border: 0; padding: 2px 4px; color: var(--vscode-textLink-foreground); }
  .link:hover { background: none; text-decoration: underline; }
  kbd {
    font: 11px/1.6 var(--mono); padding: 0 5px; border-radius: 3px; white-space: nowrap;
    border: 1px solid var(--line); background: var(--code);
  }
  code { font-family: var(--mono); }

  /* ---- stavový řádek ---- */
  #status {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 7px 12px; border-bottom: 1px solid var(--line);
  }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; background: var(--muted); }
  .dot.ok { background: var(--ok); }
  .dot.warn { background: var(--warn); }
  .dot.bad { background: var(--bad); }
  .dot.info { background: var(--info); }
  .dot.think { background: var(--think); }
  .dot.pulse { animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .3; transform: scale(.8); } }
  @media (prefers-reduced-motion: reduce) { .dot.pulse { animation: none; } }
  #say { font-weight: 600; }
  #say small { font-weight: 400; color: var(--muted); }
  .grow { flex: 1 1 auto; }
  .models { display: flex; gap: 6px; flex-wrap: wrap; }
  .pill {
    display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted);
    border: 1px solid var(--line); border-radius: 999px; padding: 1px 9px 1px 7px; white-space: nowrap;
  }
  .pill .dot { width: 7px; height: 7px; }
  .bar { height: 3px; background: var(--line); border-radius: 2px; overflow: hidden; width: 160px; }
  .bar i { display: block; height: 100%; background: var(--info); }

  /* ---- hlavní rozložení ---- */
  #main {
    flex: 1 1 auto; min-height: 0; display: grid;
    grid-template-columns: minmax(250px, 1fr) minmax(280px, 1.35fr) 300px;
  }
  #main > section { min-height: 0; overflow: auto; padding: 10px 12px; }
  #main > section + section { border-left: 1px solid var(--line); }
  /* užší panel: celý obsah se roluje najednou, sekce mají přirozenou výšku */
  @media (max-width: 980px) {
    #main {
      grid-template-columns: minmax(240px, 1fr) minmax(260px, 1.3fr);
      grid-auto-rows: auto; align-content: start; overflow: auto;
    }
    #main > section { overflow: visible; }
    #help { grid-column: 1 / -1; border-left: 0 !important; border-top: 1px solid var(--line); }
  }
  @media (max-width: 600px) {
    #main { display: block; }
    #main > section + section { border-left: 0; border-top: 1px solid var(--line); }
  }
  h2 {
    margin: 0 0 6px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
    font-weight: 600; color: var(--muted);
  }
  .anchor {
    font-family: var(--mono); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .sub { color: var(--muted); font-size: 12px; }
  .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

  /* finder */
  .finder { margin: 10px 0 8px; }
  .finder input {
    flex: 1 1 140px; min-width: 0; font: inherit; font-size: 12px; padding: 4px 8px; border-radius: 4px;
    color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--line));
  }
  .chips { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
  .chip {
    display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 1px 4px 1px 8px;
    border-radius: 999px; border: 1px solid; background: transparent; color: var(--fg);
  }
  .chip.must { border-color: var(--ok); }
  .chip.not { border-color: var(--bad); }
  .chip b { font-weight: 600; }
  .chip button { padding: 0 5px; background: none; border: 0; color: var(--muted); font-size: 13px; line-height: 1; }
  .chip button:hover { color: var(--fg); background: none; }

  /* seznam řešení */
  .list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
  .item {
    display: grid; grid-template-columns: 22px 1fr auto; align-items: center; gap: 8px;
    width: 100%; text-align: left; padding: 6px 8px; border-radius: 5px;
    background: transparent; border: 1px solid transparent; color: var(--fg);
  }
  .item:hover { background: var(--vscode-list-hoverBackground); }
  .item.sel { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); border-color: var(--accent); }
  .item.live { border-style: dashed; border-color: var(--think); cursor: default; }
  .rank { font-variant-numeric: tabular-nums; color: var(--muted); }
  .item.sel .rank { color: inherit; }
  .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tags { display: inline-flex; gap: 4px; margin-left: 6px; vertical-align: 1px; }
  .tag { font-size: 10px; padding: 0 6px; border-radius: 999px; white-space: nowrap; }
  .tag.best { background: var(--warn); color: var(--bg); font-weight: 700; }
  .tag.incode { border: 1px solid var(--accent); }
  .tag.user { border: 1px solid var(--muted); color: var(--muted); }
  .conf { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-variant-numeric: tabular-nums; }
  .meter { width: 46px; height: 5px; border-radius: 3px; background: var(--line); overflow: hidden; }
  .meter i { display: block; height: 100%; }
  .hidden-note { margin-top: 6px; font-size: 12px; color: var(--muted); }
  .ideas { margin-top: 12px; }
  .idea {
    display: block; width: 100%; text-align: left; margin-top: 4px; padding: 5px 8px;
    background: transparent; border: 1px dashed var(--line); color: var(--fg);
  }
  .idea:hover { background: var(--vscode-list-hoverBackground); }
  .idea span { color: var(--muted); }

  /* náhled */
  .phead { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .phead .title { font-weight: 600; font-size: 13px; }
  pre {
    margin: 0; padding: 10px 12px; border-radius: 5px; overflow: auto; background: var(--code);
    font: var(--vscode-editor-font-size, 13px)/1.45 var(--mono); tab-size: 4;
  }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .note { font-size: 12px; color: var(--muted); margin-top: 8px; }
  .error { color: var(--vscode-errorForeground, var(--bad)); font-size: 12px; margin-top: 8px; }

  /* prázdné stavy */
  .empty { max-width: 560px; }
  .empty h3 { margin: 0 0 8px; font-size: 14px; }
  .steps { margin: 0; padding-left: 20px; }
  .steps li { margin-bottom: 8px; }
  .cta { margin-top: 10px; }

  /* nápověda */
  table { border-collapse: collapse; width: 100%; }
  td { padding: 3px 0; vertical-align: top; font-size: 12px; }
  td:first-child { padding-right: 10px; white-space: nowrap; }
  .tools { display: flex; flex-wrap: wrap; gap: 2px 6px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line); }
</style>
</head>
<body>
<div id="status" role="status" aria-live="polite">
  <span class="dot" id="dot"></span>
  <span id="say">Načítám…</span>
  <span id="statusActions" class="row"></span>
  <span class="grow"></span>
  <span class="models" id="models"></span>
</div>
<div id="main">
  <section id="left"></section>
  <section id="right"></section>
  <section id="help">
    <h2>Zkratky</h2>
    <table>
      <tr><td><kbd>${k.now}</kbd></td><td><b>Doplň teď!</b> AI hned něco navrhne</td></tr>
      <tr><td><kbd>Tab</kbd></td><td>přijmout šedý návrh</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>zahodit návrh</td></tr>
      <tr><td><kbd>${k.word}</kbd></td><td>přijmout jen další slovo</td></tr>
      <tr><td><kbd>${k.next}</kbd></td><td>přepnout na jiný návrh</td></tr>
      <tr><td><kbd>${k.gen}</kbd></td><td>dopsat funkci / kód u kurzoru</td></tr>
      <tr><td><kbd>${k.alt}</kbd></td><td>vymyslet jiné řešení</td></tr>
      <tr><td><kbd>// zadání</kbd> + <kbd>Enter</kbd></td><td>AI napíše kód podle komentáře (klidně česky)</td></tr>
    </table>
    <div class="tools">
      <button class="link" data-cmd="toggle" id="toggleBtn">Vypnout návrhy</button>
      <button class="link" data-cmd="profile">Velikost AI</button>
      <button class="link" data-cmd="updates">Aktualizace</button>
      <button class="link" data-cmd="settings">Nastavení</button>
      <button class="link" data-cmd="log">Log</button>
    </div>
  </section>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const K = ${JSON.stringify(k)};
  let S = null; // poslední stav
  let draft = '';

  const JOB = {
    fn: 'Píše celou funkci', instr: 'Píše kód podle komentáře', alt: 'Píše jiné řešení',
    ideas: 'Vymýšlí, jak to udělat jinak', cmd: 'Píše kód do souboru', tab: 'Navrhuje doplnění',
  };
  const secs = (t) => Math.max(0, Math.round((Date.now() - t) / 1000));

  function renderStatus(st) {
    if (!st) return;
    const dot = $('dot'), say = $('say'), act = $('statusActions');
    let cls = '', text = '', btns = '';
    const big = st.jobs.filter((j) => j.kind !== 'tab');
    const tab = st.jobs.find((j) => j.kind === 'tab');
    if (st.engine === 'needsSetup') {
      cls = 'warn'; text = 'AI ještě není stažená.';
      btns = '<button class="primary" data-cmd="setup">Stáhnout AI (' + esc(st.downloadSize) + ')</button>';
    } else if (st.engine === 'downloading') {
      cls = 'info pulse'; text = 'Stahuju AI… ' + esc(st.progress) + ' <small>(jen poprvé, pak funguje bez internetu)</small>';
      btns = '<span class="bar"><i style="width:' + (parseInt(st.progress) || 0) + '%"></i></span>';
    } else if (st.engine === 'starting') {
      cls = 'info pulse'; text = 'Spouštím AI… <small>(pár sekund)</small>';
    } else if (st.engine === 'error') {
      cls = 'bad'; text = 'Něco se pokazilo.';
      btns = '<button class="primary" data-cmd="setup">Zkusit znovu</button><button data-cmd="log">Co se stalo?</button>';
    } else if (st.engine === 'off') {
      cls = ''; text = 'AI neběží.';
      btns = '<button class="primary" data-cmd="setup">Spustit AI</button>';
    } else if (big.length) {
      const j = big[0];
      cls = 'think pulse';
      text = 'Přemýšlí: ' + esc(JOB[j.kind] || 'pracuje') + (j.label ? ' <small>· ' + esc(j.label) + '</small>' : '') +
        ' <small>· ' + secs(j.started) + ' s · ' + j.tokens + ' tokenů</small>';
      btns = '<button data-cmd="stop">Zastavit</button>';
    } else if (!st.enabled) {
      cls = ''; text = 'Návrhy jsou vypnuté.';
      btns = '<button class="primary" data-cmd="toggle">Zapnout</button>';
    } else if (tab) {
      cls = 'ok pulse'; text = 'Navrhuje doplnění… <small>(stačí psát dál)</small>';
    } else {
      cls = 'ok'; text = 'Připraveno. <small>Piš kód a AI bude šedě napovídat.</small>';
      btns = '<button data-cmd="suggestNow" title="AI hned navrhne doplnění tam, kde máš kurzor (' + K.now + ')">Doplň teď! <kbd>' + K.now + '</kbd></button>';
    }
    dot.className = 'dot ' + cls;
    say.innerHTML = text;
    if (act.dataset.html !== btns) { act.innerHTML = btns; act.dataset.html = btns; }
    const pill = (name, m, tip) => {
      const c = m.phase === 'running' ? 'ok' : m.phase === 'starting' ? 'info pulse' : '';
      const where = m.phase === 'running' ? (m.device === 'GPU' ? 'grafika' : 'procesor') : m.phase === 'starting' ? 'startuje' : 'spí';
      return '<span class="pill" title="' + esc(tip) + '"><span class="dot ' + c + '"></span>' + name + ': ' + where + '</span>';
    };
    $('models').innerHTML = st.engine === 'ready'
      ? pill('Rychlá AI', st.tab, 'Malý model pro šedé návrhy při psaní.') +
        pill('Chytrá AI', st.gen, 'Velký model pro celé funkce a jiná řešení. Když ho dlouho nepoužíváš, uvolní se z paměti a při dalším použití sám naběhne.')
      : '';
    $('toggleBtn').textContent = st.enabled ? 'Vypnout návrhy' : 'Zapnout návrhy';
  }

  function confColor(c) { return c >= 0.85 ? 'var(--ok)' : c >= 0.7 ? 'var(--warn)' : 'var(--bad)'; }
  function conf(v) {
    if (typeof v.confidence !== 'number') return '<span class="conf sub" title="Jistotu u tohohle řešení nemám (starší verze nebo tvůj kód).">–</span>';
    const p = Math.round(v.confidence * 100);
    return '<span class="conf" title="Jistota AI: jak moc si byl model jistý každým kouskem kódu. Vyšší = spíš správně, ale není to záruka."><span class="meter"><i style="width:' + p + '%;background:' + confColor(v.confidence) + '"></i></span>' + p + ' %</span>';
  }

  function renderMain() {
    const s = S;
    const left = $('left'), right = $('right');
    if (!s) return;
    const st = s.status;
    if (st.engine === 'needsSetup' || st.engine === 'off' || st.engine === 'error') {
      left.innerHTML = '<div class="empty"><h3>Octomilka = AI, která ti pomáhá psát kód. Běží jen na tvém počítači.</h3>' +
        (st.engine === 'needsSetup'
          ? '<p class="sub">Nejdřív se musí jednou stáhnout (' + esc(st.downloadSize) + '). Pak funguje i bez internetu a zadarmo.</p><div class="cta"><button class="primary" data-cmd="setup">Stáhnout AI</button></div>'
          : '<div class="cta"><button class="primary" data-cmd="setup">Spustit AI</button></div>') + '</div>';
      right.innerHTML = howTo();
      return;
    }
    if (!s.spot) {
      left.innerHTML = '<div class="empty"><h3>Klikni do nějaké funkce</h3><p class="sub">Tady pak uvidíš všechna řešení, která AI pro tu funkci vymyslela, seřazená od nejlepšího.</p></div>';
      right.innerHTML = howTo();
      return;
    }
    const f = s.filters;
    const hasF = f.must.length || f.mustNot.length;
    const vis = s.variants.filter((v) => v.matches);
    const hidden = s.variants.length - vis.length;
    const busy = !!s.stream;
    let h = '<h2>Řešení pro</h2><div class="anchor" title="' + esc(s.spot.label) + '">' + esc(s.spot.label) + '</div>' +
      '<div class="sub">' + (s.spot.kind === 'fn' ? 'funkce' : 'zadání z komentáře') + ' · ' + esc(s.spot.file) + '</div>' +
      '<div class="row" style="margin-top:8px"><button class="primary" data-act="more" ' + (busy ? 'disabled' : '') + '>' +
      (busy ? 'Přemýšlím…' : !s.variants.some((v) => v.origin === 'ai') ? 'Navrhnout řešení' : hasF ? 'Vymyslet řešení podle filtru' : 'Vymyslet jiné řešení') +
      '</button>' + (busy ? '<button data-cmd="stop">Zastavit</button>' : '<span class="sub"><kbd>' + K.alt + '</kbd></span>') + '</div>';

    h += '<div class="finder"><div class="row"><input id="q" placeholder="Filtr: napiš slovo, např. map" value="' + esc(draft) + '" aria-label="Slovo do filtru">' +
      '<button data-filter="must" title="Ukázat jen řešení, která tohle obsahují. AI ho pak bude používat.">Musí obsahovat</button>' +
      '<button data-filter="mustNot" title="Schovat řešení, která tohle obsahují. AI se tomu pak vyhne.">Nesmí obsahovat</button></div>';
    if (hasF) {
      h += '<div class="chips">' +
        f.must.map((x) => '<span class="chip must">musí: <b>' + esc(x) + '</b><button data-unf="must" data-text="' + esc(x) + '" aria-label="Odebrat">×</button></span>').join('') +
        f.mustNot.map((x) => '<span class="chip not">nesmí: <b>' + esc(x) + '</b><button data-unf="mustNot" data-text="' + esc(x) + '" aria-label="Odebrat">×</button></span>').join('') +
        '<button class="link" data-act="clearFilter">zrušit filtr</button></div>';
    }
    h += '</div>';

    h += '<div class="list" role="list">';
    vis.forEach((v) => {
      h += '<button role="listitem" class="item' + (v.id === s.selectedId ? ' sel' : '') + '" data-sel="' + v.id + '" title="Klikni = ukázat kód · dvojklik = použít">' +
        '<span class="rank">' + v.rank + '.</span><span class="t">' + esc(v.title) +
        '<span class="tags">' + (v.best ? '<span class="tag best">⭐ nejlepší</span>' : '') +
        (v.inCode ? '<span class="tag incode">v kódu</span>' : '') + (v.origin === 'user' ? '<span class="tag user">tvůj</span>' : '') + '</span></span>' +
        conf(v) + '</button>';
    });
    if (busy) h += '<div class="item live"><span class="rank">…</span><span class="t">' + esc(s.stream.title || 'Vymýšlím nové řešení') + '</span><span class="conf sub">píšu</span></div>';
    h += '</div>';
    if (!vis.length && !busy) h += '<div class="hidden-note">' + (s.variants.length ? 'Žádné řešení neodpovídá filtru. Klikni na „Vymyslet řešení podle filtru“.' : 'Zatím tu nic není. Klikni na „Navrhnout řešení“, nebo v kódu počkej na šedý návrh.') + '</div>';
    if (hidden) h += '<div class="hidden-note">Skryto filtrem: ' + hidden + '</div>';
    if (s.ideas.length && !busy) {
      h += '<div class="ideas"><h2>Nápady AI – klikni a napíše ho</h2>' + s.ideas.map((x) => {
        const i = x.indexOf(':');
        return '<button class="idea" data-idea="' + esc(x) + '"><b>' + esc(i > 0 ? x.slice(0, i) : x) + '</b>' + (i > 0 ? '<span> – ' + esc(x.slice(i + 1).trim()) + '</span>' : '') + '</button>';
      }).join('') + '</div>';
    }
    left.innerHTML = h;

    // náhled
    let r = '';
    if (busy) {
      r = '<div class="phead"><span class="dot think pulse"></span><span class="title">' + esc(s.stream.title || 'Píšu nové řešení…') + '</span></div><pre>' + esc(s.stream.text || ' ') + '</pre>' +
        '<div class="note">Až to dopíšu, rovnou to vložím do kódu. Nelíbí se? Ctrl+Z nebo vyber jiné řešení vlevo.</div>';
    } else {
      const v = vis.find((x) => x.id === s.selectedId);
      if (v) {
        r = '<div class="phead"><span class="title">' + v.rank + '. ' + esc(v.title) + '</span>' + (v.best ? '<span class="tag best">⭐ AI myslí, že tohle je nejlepší</span>' : '') + conf(v) + '</div>' +
          '<pre>' + esc(v.lines.join('\\n')) + '</pre><div class="actions">' +
          (v.inCode ? '<button disabled>Tohle už máš v kódu</button>' : '<button class="primary" data-act="apply" data-id="' + v.id + '">Použít tohle řešení</button>') +
          '<button data-act="copy" data-id="' + v.id + '">Kopírovat</button><button data-act="remove" data-id="' + v.id + '" title="Smazat z historie">Zapomenout</button></div>' +
          (v.origin === 'ai' && !v.best ? '<div class="note">Jiná řešení od AI se můžou splést, tak si je před použitím přečti.</div>' : '');
      } else r = howTo();
    }
    if (s.error) r += '<div class="error">' + esc(s.error) + '</div>';
    right.innerHTML = r;
    const q = $('q');
    if (q) {
      q.oninput = () => (draft = q.value);
      q.onkeydown = (e) => { if (e.key === 'Enter') addFilter(e.shiftKey ? 'mustNot' : 'must'); };
    }
  }

  function howTo() {
    return '<div class="empty"><h3>Jak na to</h3><ol class="steps">' +
      '<li>Napiš hlavičku funkce, třeba <code>function secti(a, b) {</code>. AI šedě navrhne zbytek. <kbd>Tab</kbd> = přijmout.</li>' +
      '<li>AI mlčí? Zmáčkni <kbd>' + K.now + '</kbd> = „Doplň teď!“ a hned něco navrhne.</li>' +
      '<li>Nebo napiš komentář, co chceš, třeba <code>// seřaď pole od největšího</code>, a dej <kbd>Enter</kbd>.</li>' +
      '<li>Nelíbí se ti to? <kbd>' + K.alt + '</kbd> a AI vymyslí jiné řešení. Všechna uvidíš tady a můžeš mezi nimi přepínat.</li></ol></div>';
  }

  function addFilter(kind) {
    const q = $('q');
    const t = (q ? q.value : '').trim();
    if (!t) { q && q.focus(); return; }
    draft = '';
    vscode.postMessage({ type: 'addFilter', kind, text: t });
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.cmd) return vscode.postMessage({ type: b.dataset.cmd });
    if (b.dataset.act) return vscode.postMessage({ type: b.dataset.act, id: b.dataset.id });
    if (b.dataset.sel) return vscode.postMessage({ type: 'select', id: b.dataset.sel });
    if (b.dataset.idea) return vscode.postMessage({ type: 'idea', text: b.dataset.idea });
    if (b.dataset.filter) return addFilter(b.dataset.filter);
    if (b.dataset.unf) return vscode.postMessage({ type: 'removeFilter', kind: b.dataset.unf, text: b.dataset.text });
  });
  document.addEventListener('dblclick', (e) => {
    const b = e.target.closest('button[data-sel]');
    if (b) vscode.postMessage({ type: 'apply', id: b.dataset.sel });
  });

  window.addEventListener('message', ({ data }) => {
    if (data.type === 'status') {
      if (S) S.status = data.status;
      renderStatus(data.status);
      return;
    }
    if (data.type !== 'state') return;
    const focusQ = document.activeElement && document.activeElement.id === 'q';
    S = data;
    renderStatus(S.status);
    renderMain();
    if (focusQ && $('q')) { const q = $('q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
