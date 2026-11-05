// Ruční end-to-end test se skutečnými modely (bez VS Code).
// Potřebuje stažený engine + modely v globalStorage (Windows, profil medium).
// Spuštění: npx tsc -p tsconfig.test.json && node out-test/test/e2e.js
import path from 'path';
import { LlamaServer, infill, chatStream, buildMessages, buildIdeasMessages, parseIdeas, PromptOpts } from '../src/engine';
import { detectStub, detectInstruction, BodyStreamer, stubGhost, trimOverlap, indentLines } from '../src/stub';

const D = path.join(process.env.APPDATA!, 'Code/User/globalStorage/lukas-vitek.octomilka');
const BIN = path.join(D, 'engine/b12125-gpu/llama-server.exe');
const log = (m: string) => {
  if (/připraven|nevyšlo/.test(m)) console.log('  ' + m.slice(0, 140));
};

async function gen(s: LlamaServer, o: PromptOpts, signature: string | null, skip: string[], temperature: number) {
  const lines: string[] = [];
  const st = new BodyStreamer(o.langId, signature, (l) => lines.push(l), skip);
  const ac = new AbortController();
  const t0 = Date.now();
  try {
    for await (const p of chatStream(s, buildMessages(o), 900, ac.signal, temperature)) {
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
  return { title: st.title, lines, ms: Date.now() - t0 };
}

function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' – ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}

const looksCSharp = (s: string) => /\b(public|private)\s+static\b|Console\.|\bvar\s+\w+\s*=\s*new\s+List<|\bforeach\s*\(\s*var\b/.test(s);

async function main() {
  const tab = new LlamaServer('tab', BIN, path.join(D, 'models/qwen2.5-coder-1.5b-q8_0.gguf'), ['-c', '8192', '-np', '1', '--cache-reuse', '256'], log);
  const big = new LlamaServer('funkce', BIN, path.join(D, 'models/Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf'), ['-c', '8192', '-np', '1', '--jinja'], log);
  try {
    await tab.start();
    await big.start();
    console.log(`devices: tab=${tab.device} funkce=${big.device}\n`);

    // 1) Tab v téměř prázdném .ts souboru – s hlavičkou souboru musí zůstat TypeScript
    const header = '// sum.ts (TypeScript)\n';
    const pre = 'function sum(xs: number[]): number {\n  ';
    const suf = '\n}\n';
    let t0 = Date.now();
    const fim = trimOverlap(await infill(tab, header + pre, suf, [], 2, new AbortController().signal), suf);
    check('Tab v .ts', !!fim.trim() && !looksCSharp(fim), `${Date.now() - t0} ms ${JSON.stringify(fim)}`);

    // 2) Celá funkce z hlavičky v .ts – musí být TypeScript a fungovat
    const FILE = 'function isPrime(n: number): boolean {|}\n';
    const off = FILE.indexOf('|');
    const text = FILE.replace('|', '');
    const stub = detectStub(text, off, 'typescript', '  ')!;
    const best = await gen(big, { fileName: 'C:/x/prime.ts', langId: 'typescript', before: text.slice(0, off), after: text.slice(off), mode: 'body' }, stub.signature, [], 0.1);
    const fnSrc = text.slice(0, off) + stubGhost(best.lines, stub).text + text.slice(off);
    console.log(`\n[${best.title}] ${best.ms} ms\n${fnSrc}`);
    check('funkce je TypeScript', !looksCSharp(fnSrc));
    const isPrime = new Function(fnSrc.replace(/: number/g, '').replace(/\): boolean/, ')') + '\nreturn isPrime;')();
    check('isPrime funguje', [2, 3, 5, 17, 29, 97].every(isPrime) && ![-7, 0, 1, 4, 9, 15, 25, 49, 91].some(isPrime));
    check('má název řešení (APPROACH)', !!best.title, best.title);

    // 3) Jiné řešení – krok 1 nápady, krok 2 kód podle prvního nápadu
    const altBase: PromptOpts = { fileName: 'C:/x/prime.ts', langId: 'typescript', before: text.slice(0, off), after: text.slice(off), mode: 'body', avoid: [{ title: best.title, code: best.lines.join('\n') }] };
    t0 = Date.now();
    let ideasRaw = '';
    for await (const p of chatStream(big, buildIdeasMessages(altBase), 160, new AbortController().signal, 0.3)) ideasRaw += p;
    const ideas = parseIdeas(ideasRaw);
    console.log(`\nnápady (${Date.now() - t0} ms):\n  ${ideas.join('\n  ')}`);
    check('3 nápady', ideas.length === 3);
    const alt = await gen(big, { ...altBase, approach: ideas[0] }, stub.signature, [], 0.3);
    const altSrc = text.slice(0, off) + stubGhost(alt.lines, stub).text + text.slice(off);
    console.log(`\n[${alt.title}] ${alt.ms} ms\n${altSrc}`);
    check('jiné řešení se liší', alt.lines.join('\n').replace(/\s/g, '') !== best.lines.join('\n').replace(/\s/g, ''));
    let isPrime2: (n: number) => boolean = () => false;
    let altOk = false;
    try {
      const js = altSrc.replace(/: number(\[\])?/g, '').replace(/\): boolean/g, ')').replace(/<[\w\[\]]+>/g, '');
      isPrime2 = new Function(js + '\nreturn isPrime;')();
      altOk = [2, 3, 5, 17, 29, 97].every(isPrime2) && ![-7, 0, 1, 4, 9, 15, 25, 49, 91].some(isPrime2);
    } catch (e) {
      console.log('  chyba: ' + (e as Error).message);
    }
    check('jiné řešení funguje', altOk);

    // 4) Zadání komentářem
    const F2 = 'const prices = [120, 80, 45];\n// make a function that uses .map() to add 21 % VAT\n|';
    const o2 = F2.indexOf('|');
    const t2 = F2.replace('|', '');
    const ins = detectInstruction(t2, o2, 'javascript')!;
    check('komentář poznán jako zadání', !!ins, ins?.instruction);
    const r = await gen(big, { fileName: 'C:/x/vat.js', langId: 'javascript', before: t2.slice(0, o2), after: '', mode: 'instr', instruction: ins.instruction }, null, [ins.lastCommentLine], 0.1);
    const code = indentLines(r.lines, ins.indent);
    console.log(`\n[${r.title}] ${r.ms} ms\n${code}`);
    check('použije .map()', /\.map\(/.test(code));
    check('nezopakuje komentář', !code.includes('make a function that uses'));

    // 5) Zadání česky
    const F3 = 'def nacti(cesta):\n    # vrať počet řádků v souboru, prázdné nepočítej\n    |\n';
    const o3 = F3.indexOf('|');
    const t3 = F3.replace('|', '');
    const ins3 = detectInstruction(t3, o3, 'python')!;
    const r3 = await gen(big, { fileName: 'C:/x/soubor.py', langId: 'python', before: t3.slice(0, o3), after: t3.slice(o3), mode: 'instr', instruction: ins3.instruction }, 'def nacti(cesta):', [ins3.lastCommentLine], 0.1);
    console.log(`\n[${r3.title}] ${r3.ms} ms\n${indentLines(r3.lines, ins3.indent)}`);
    check('nezopakuje hlavičku funkce', !r3.lines.some((l) => l.trim().startsWith('def nacti')));
    check('české zadání → Python', /open\(|readlines|strip\(\)/.test(r3.lines.join('\n')) && !/function |=>/.test(r3.lines.join('\n')));
  } finally {
    tab.stop();
    big.stop();
  }
  console.log(process.exitCode ? '\nE2E FAIL' : '\nE2E OK');
}

main().catch((e) => {
  console.error('E2E FAIL:', e.message);
  process.exit(1);
});
