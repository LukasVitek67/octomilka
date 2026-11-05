// Ruční end-to-end test se skutečnými modely (bez VS Code).
// Potřebuje stažený engine + modely v globalStorage (Windows, profil medium).
// Spuštění: npx tsc -p tsconfig.test.json && node out-test/test/e2e.js
import path from 'path';
import { LlamaServer, infill, chatStream, buildMessages } from '../src/engine';
import { detectStub, BodyStreamer, stubGhost, trimOverlap } from '../src/stub';

const D = path.join(process.env.APPDATA!, 'Code/User/globalStorage/lukas-vitek.octomilka');
const BIN = path.join(D, 'engine/b12125-gpu/llama-server.exe');
const log = (m: string) => {
  if (/připraven|nevyšlo|start:/.test(m)) console.log('  ' + m.slice(0, 160));
};

const FILE = `interface Item { name: string; price: number; qty: number }

export function cartTotal(items: Item[]): number {|}
`;

async function main() {
  const tab = new LlamaServer('tab', BIN, path.join(D, 'models/qwen2.5-coder-1.5b-q8_0.gguf'), ['-c', '8192', '-np', '1', '--cache-reuse', '256'], log);
  const gen = new LlamaServer('funkce', BIN, path.join(D, 'models/Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf'), ['-c', '8192', '-np', '1', '--jinja'], log);
  try {
    await tab.start();
    await gen.start();
    console.log(`devices: tab=${tab.device} gen=${gen.device}`);

    // 1) Tab / FIM uprostřed psaní
    const pre = 'function capitalize(s: string): string {\n  return ';
    const suf = '\n}\n';
    let t0 = Date.now();
    const fim = trimOverlap(await infill(tab, pre, suf, [], 2, new AbortController().signal), suf);
    console.log(`\nFIM ${Date.now() - t0} ms: ${JSON.stringify(fim)}`);
    if (!fim.trim()) throw new Error('prázdný FIM');

    // 2) Celá funkce z hlavičky – stejná cesta jako šedý text v editoru
    const off = FILE.indexOf('|');
    const text = FILE.replace('|', '');
    const stub = detectStub(text, off, 'typescript', '  ');
    if (!stub || stub.kind !== 'inline') throw new Error('stub nenalezen');
    const lines: string[] = [];
    const st = new BodyStreamer('typescript', stub.signature, (l) => lines.push(l));
    const ac = new AbortController();
    t0 = Date.now();
    let firstTok = 0;
    try {
      for await (const p of chatStream(gen, buildMessages('cart.ts', 'typescript', text.slice(0, off), text.slice(off), 'body'), 700, ac.signal)) {
        if (!firstTok) firstTok = Date.now() - t0;
        st.push(p);
        if (st.done) {
          ac.abort();
          break;
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) throw e;
    }
    st.end();
    const g = stubGhost(lines, stub);
    const result = text.slice(0, off) + g.text + text.slice(off);
    console.log(`\nFUNKCE první token ${firstTok} ms, hotovo ${Date.now() - t0} ms:\n${result}`);

    // 3) Výsledek musí jít spustit
    const js = result.replace(/^interface[^}]*}\n/m, '').replace(/: Item\[\]/g, '').replace(/\): number/g, ')').replace('export ', '');
    const fn = new Function(js + '\nreturn cartTotal;')();
    const total = fn([{ name: 'a', price: 10, qty: 2 }, { name: 'b', price: 5, qty: 3 }]);
    console.log(`cartTotal(...) = ${total}`);
    if (total !== 35) throw new Error('špatný výsledek');
    console.log('\nE2E OK');
  } finally {
    tab.stop();
    gen.stop();
  }
}

main().catch((e) => {
  console.error('E2E FAIL:', e.message);
  process.exit(1);
});
