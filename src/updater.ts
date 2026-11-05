// Automatické aktualizace z GitHub Releases. Bez závislosti na vscode (testovatelné v Node).
// Jediná síťová komunikace: dotaz na GitHub API + stažení .vsix. Nic se neodesílá.
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as crypto from 'crypto';
import * as path from 'path';

export interface Release {
  version: string;
  tag: string;
  url: string; // stránka release
  notes: string;
  asset: { name: string; url: string; size: number; sha256?: string };
}

/** owner/repo z "https://github.com/owner/repo(.git)" – forky se tak aktualizují ze svého repa. */
export function repoFrom(url: string | undefined): string | undefined {
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url ?? '');
  return m ? `${m[1]}/${m[2]}` : undefined;
}

const parse = (v: string) =>
  v
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .slice(0, 3)
    .map((x) => parseInt(x, 10) || 0);

/** >0 když a je novější než b. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

export async function latestRelease(repo: string, signal?: AbortSignal): Promise<Release | undefined> {
  const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'octomilka-vscode' },
    signal,
  });
  if (r.status === 404) return undefined; // zatím žádný release
  if (!r.ok) throw new Error(`GitHub API HTTP ${r.status}`);
  const j: any = await r.json();
  if (j.draft || j.prerelease) return undefined;
  const a = (j.assets ?? []).find((x: any) => typeof x.name === 'string' && x.name.endsWith('.vsix'));
  if (!a) return undefined;
  const dl: string = a.browser_download_url;
  // Stahovat jen z release tohoto repa na github.com.
  if (!dl.startsWith(`https://github.com/${repo}/releases/download/`)) throw new Error('Neočekávaná adresa .vsix');
  const sha = typeof a.digest === 'string' && a.digest.startsWith('sha256:') ? a.digest.slice(7).toLowerCase() : undefined;
  return {
    version: String(j.tag_name).replace(/^v/i, ''),
    tag: j.tag_name,
    url: j.html_url,
    notes: String(j.body ?? ''),
    asset: { name: a.name, url: dl, size: a.size, sha256: sha },
  };
}

export async function sha256File(file: string): Promise<string> {
  const h = crypto.createHash('sha256');
  await new Promise<void>((res, rej) => fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => res()).on('error', rej));
  return h.digest('hex');
}

/** Stáhne .vsix do dir a ověří velikost + SHA256 (když ho GitHub poskytl). Vrací cestu. */
export async function downloadRelease(rel: Release, dir: string, signal?: AbortSignal): Promise<string> {
  await fsp.mkdir(dir, { recursive: true });
  const dest = path.join(dir, path.basename(rel.asset.name));
  const r = await fetch(rel.asset.url, { headers: { 'User-Agent': 'octomilka-vscode' }, redirect: 'follow', signal });
  if (!r.ok) throw new Error(`Stažení aktualizace selhalo: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (rel.asset.size && buf.length !== rel.asset.size) throw new Error('Stažená aktualizace má špatnou velikost');
  if (rel.asset.sha256) {
    const got = crypto.createHash('sha256').update(buf).digest('hex');
    if (got !== rel.asset.sha256) throw new Error('Stažená aktualizace nesedí s otiskem SHA256 – neinstaluju ji');
  }
  await fsp.writeFile(dest, buf);
  return dest;
}

/** Zkrácené poznámky k vydání pro notifikaci. */
export function shortNotes(notes: string, max = 220): string {
  const t = notes
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/^[-*]\s+/, '').replace(/\*\*/g, '').replace(/`/g, '').trim())
    .filter((l) => l && !/^(novinky|instalace|pozor)/i.test(l))
    .join(' · ');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
