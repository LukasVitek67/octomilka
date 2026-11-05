// Stažení enginu (llama.cpp) a modelů, správa lokálních serverů, volání AI.
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
import { spawn, execFile, ChildProcess } from 'child_process';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

export const LLAMA_TAG = 'b12125';
const GH = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/`;
const HF = 'https://huggingface.co/';

export interface ModelSpec {
  label: string;
  url: string;
  file: string;
  bytes: number;
}

const M = {
  tab05: {
    label: 'Qwen2.5-Coder 0.5B (Tab)',
    url: HF + 'ggml-org/Qwen2.5-Coder-0.5B-Q8_0-GGUF/resolve/main/qwen2.5-coder-0.5b-q8_0.gguf',
    file: 'qwen2.5-coder-0.5b-q8_0.gguf',
    bytes: 531068128,
  },
  tab15: {
    label: 'Qwen2.5-Coder 1.5B (Tab)',
    url: HF + 'ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF/resolve/main/qwen2.5-coder-1.5b-q8_0.gguf',
    file: 'qwen2.5-coder-1.5b-q8_0.gguf',
    bytes: 1646573056,
  },
  gen3: {
    label: 'Qwen2.5-Coder 3B Instruct (funkce)',
    url: HF + 'bartowski/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf',
    file: 'Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf',
    bytes: 1929903360,
  },
  gen7: {
    label: 'Qwen2.5-Coder 7B Instruct (funkce)',
    url: HF + 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf',
    file: 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf',
    bytes: 4683074336,
  },
  gen30: {
    label: 'Qwen3-Coder 30B-A3B Instruct (funkce)',
    url: HF + 'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF/resolve/main/Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf',
    file: 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf',
    bytes: 18556689568,
  },
} satisfies Record<string, ModelSpec>;

export type Profile = 'small' | 'medium' | 'large';
export const PROFILES: Record<Profile, { tab: ModelSpec; gen: ModelSpec; label: string }> = {
  small: { tab: M.tab05, gen: M.gen3, label: 'malý (8 GB RAM)' },
  medium: { tab: M.tab15, gen: M.gen7, label: 'střední (16 GB RAM)' },
  large: { tab: M.tab15, gen: M.gen30, label: 'velký (32 GB+ RAM)' },
};

export function autoProfile(): Profile {
  const gb = os.totalmem() / 2 ** 30;
  if (gb >= 30) return 'large';
  if (gb >= 12) return 'medium';
  return 'small';
}

export type Variant = 'gpu' | 'cpu';

export function engineAsset(variant: Variant): string | undefined {
  const p = process.platform;
  const a = process.arch;
  const n = (s: string) => `llama-${LLAMA_TAG}-bin-${s}`;
  const g = variant === 'gpu';
  if (p === 'win32' && a === 'x64') return n(g ? 'win-vulkan-x64.zip' : 'win-cpu-x64.zip');
  if (p === 'win32' && a === 'arm64') return n(g ? 'win-vulkan-arm64.zip' : 'win-cpu-arm64.zip');
  if (p === 'darwin') return n(a === 'arm64' ? 'macos-arm64.tar.gz' : 'macos-x64.tar.gz');
  if (p === 'linux' && a === 'x64') return n(g ? 'ubuntu-vulkan-x64.tar.gz' : 'ubuntu-x64.tar.gz');
  if (p === 'linux' && a === 'arm64') return n(g ? 'ubuntu-vulkan-arm64.tar.gz' : 'ubuntu-arm64.tar.gz');
  return undefined;
}
export const engineUrl = (asset: string) => GH + asset;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stažení se zobrazením průběhu a navázáním přerušeného stahování. */
export async function download(
  url: string,
  dest: string,
  onBytes: (n: number) => void,
  signal: AbortSignal,
): Promise<void> {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const part = dest + '.part';
  let start = 0;
  try {
    start = (await fsp.stat(part)).size;
  } catch {}
  const headers: Record<string, string> = { 'User-Agent': 'octomilka-vscode' };
  if (start > 0) headers.Range = `bytes=${start}-`;
  const res = await fetch(url, { headers, signal, redirect: 'follow' });
  if (res.status === 416) {
    await fsp.rm(part, { force: true });
    return download(url, dest, onBytes, signal);
  }
  if (!res.ok || !res.body) throw new Error(`Stažení selhalo: HTTP ${res.status} – ${url}`);
  const append = res.status === 206;
  if (append) onBytes(start);
  const file = fs.createWriteStream(part, { flags: append ? 'a' : 'w' });
  const body = Readable.fromWeb(res.body as any);
  body.on('data', (c: Buffer) => onBytes(c.length));
  await pipeline(body, file);
  await fsp.rename(part, dest);
}

export async function extract(archive: string, dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
  // Na Windows systémový bsdtar (umí .zip); tar z Gitu by zip nezvládl.
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  await new Promise<void>((res, rej) =>
    execFile(tar, ['-xf', archive, '-C', dir], { windowsHide: true }, (e, _o, se) =>
      e ? rej(new Error(`Rozbalení selhalo: ${se || e.message}`)) : res(),
    ),
  );
}

export async function findFile(dir: string, name: string): Promise<string | undefined> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const e of entries) if (e.isFile() && e.name === name) return path.join(dir, e.name);
  for (const e of entries) {
    if (e.isDirectory()) {
      const f = await findFile(path.join(dir, e.name), name);
      if (f) return f;
    }
  }
  return undefined;
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.unref();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => res(port));
    });
  });
}

export type Log = (msg: string) => void;

/** Jeden lokální llama-server (poslouchá jen na 127.0.0.1). */
export class LlamaServer {
  private proc?: ChildProcess;
  private ready?: Promise<void>;
  port = 0;
  lastUsed = Date.now();

  /** Na čem server nakonec běží (např. "GPU" / "CPU"). */
  device = '';

  constructor(
    readonly name: string,
    private bin: string,
    private model: string,
    private args: string[],
    private log: Log,
    /** Pokusy o -ngl v pořadí; "auto" = GPU podle volné paměti, "0" = jen CPU. */
    private ngls: string[] = ['auto', '0'],
  ) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }
  get running(): boolean {
    return !!this.proc;
  }

  start(): Promise<void> {
    if (this.ready) return this.ready;
    const ready = this.boot();
    this.ready = ready;
    ready.catch(() => {
      if (this.ready === ready) this.ready = undefined;
    });
    return ready;
  }

  private async boot(): Promise<void> {
    let err: Error | undefined;
    for (const ngl of this.ngls) {
      try {
        await this.bootOnce(ngl);
        this.device = ngl === '0' ? 'CPU' : 'GPU';
        return;
      } catch (e) {
        err = e as Error;
        this.log(`[${this.name}] -ngl ${ngl} nevyšlo: ${err.message}`);
      }
    }
    throw err!;
  }

  private async bootOnce(ngl: string): Promise<void> {
    this.port = await freePort();
    const dir = path.dirname(this.bin);
    const env = { ...process.env };
    if (process.platform === 'linux') env.LD_LIBRARY_PATH = dir + (env.LD_LIBRARY_PATH ? ':' + env.LD_LIBRARY_PATH : '');
    const args = ['-m', this.model, '--host', '127.0.0.1', '--port', String(this.port), '-ngl', ngl, ...this.args];
    this.log(`[${this.name}] start: ${path.basename(this.bin)} ${args.join(' ')}`);
    const p = spawn(this.bin, args, { cwd: dir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = p;
    let booted = false;
    let exit: string | undefined;
    const tail: string[] = [];
    const onOut = (d: Buffer) => {
      for (const line of d.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 40) tail.shift();
        if (!booted || /error|fail|fatal/i.test(line)) this.log(`[${this.name}] ${line}`);
      }
    };
    p.stdout!.on('data', onOut);
    p.stderr!.on('data', onOut);
    p.on('error', (e) => (exit = e.message));
    p.on('exit', (code, sig) => {
      exit = exit ?? `kód ${code ?? sig}`;
      this.log(`[${this.name}] ukončen (${exit})`);
      if (this.proc === p) {
        this.proc = undefined;
        this.ready = undefined;
      }
    });

    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      if (exit) throw new Error(`${this.name}: server nenaběhl (${exit}). ${tail.slice(-3).join(' | ')}`);
      try {
        const r = await fetch(this.url + '/health');
        if (r.ok) {
          booted = true;
          this.log(`[${this.name}] připraven na ${this.url}`);
          return;
        }
      } catch {}
      await sleep(300);
    }
    this.stop();
    throw new Error(`${this.name}: server nenaběhl do 5 minut`);
  }

  stop(): void {
    const p = this.proc;
    this.proc = undefined;
    this.ready = undefined;
    if (p && p.exitCode === null) p.kill();
  }
}

export interface ExtraChunk {
  filename: string;
  text: string;
}

/** FIM doplnění malým modelem (Tab). */
export async function infill(
  s: LlamaServer,
  prefix: string,
  suffix: string,
  extra: ExtraChunk[],
  nIndent: number,
  signal: AbortSignal,
): Promise<string> {
  s.lastUsed = Date.now();
  const r = await fetch(s.url + '/infill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      input_prefix: prefix,
      input_suffix: suffix,
      input_extra: extra,
      prompt: '',
      n_predict: 128,
      n_indent: nIndent,
      temperature: 0,
      top_k: 40,
      top_p: 0.9,
      samplers: ['top_k', 'top_p', 'infill'],
      cache_prompt: true,
      t_max_predict_ms: 2500,
      stream: false,
    }),
  });
  if (!r.ok) throw new Error(`infill HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j: any = await r.json();
  return typeof j.content === 'string' ? j.content : '';
}

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Streamovaný chat velkým modelem (OpenAI-kompatibilní endpoint llama-serveru). */
export async function* chatStream(
  s: LlamaServer,
  messages: ChatMsg[],
  maxTokens: number,
  signal: AbortSignal,
): AsyncGenerator<string> {
  s.lastUsed = Date.now();
  const r = await fetch(s.url + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ messages, max_tokens: maxTokens, temperature: 0.2, top_p: 0.9, stream: true, cache_prompt: true }),
  });
  if (!r.ok || !r.body) throw new Error(`chat HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const piece = JSON.parse(data).choices?.[0]?.delta?.content;
        if (piece) {
          s.lastUsed = Date.now();
          yield piece;
        }
      } catch {}
    }
  }
}

export function buildMessages(
  fileName: string,
  lang: string,
  before: string,
  after: string,
  mode: 'body' | 'free',
): ChatMsg[] {
  const rules =
    mode === 'body'
      ? `The file contains a function whose body is empty; the cursor is marked <FILL_HERE>. ` +
        `Write a complete, correct, idiomatic implementation of that function body. Infer what it must do from ` +
        `the function name, parameters, types, comments and the rest of the file. ` +
        `Output ONLY the body statements: no function signature, no closing brace of the function, ` +
        `no markdown fences, no explanation.`
      : `The cursor is marked <FILL_HERE>. Write the code that belongs there, following any comment or ` +
        `instruction directly above the cursor. Output ONLY the code to insert: no markdown fences, ` +
        `no explanation, do not repeat code that is already in the file.`;
  return [
    {
      role: 'system',
      content: `You are an expert ${lang} programmer working as a code completion engine inside a code editor. ${rules}`,
    },
    { role: 'user', content: `File: ${fileName}\n\n${before}<FILL_HERE>${after}` },
  ];
}
