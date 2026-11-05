// Testy updateru. Část "live" sahá na skutečné GitHub API (spuštění: node out-test/test/updater.test.js live).
import assert from 'assert';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { compareVersions, repoFrom, shortNotes, latestRelease, downloadRelease, sha256File } from '../src/updater';

assert(compareVersions('0.3.0', '0.2.0') > 0);
assert(compareVersions('v0.10.0', '0.9.9') > 0);
assert(compareVersions('1.0.0', '1.0.0') === 0);
assert(compareVersions('0.2.0', '0.2.1') < 0);
assert.equal(repoFrom('https://github.com/LukasVitek67/octomilka.git'), 'LukasVitek67/octomilka');
assert.equal(repoFrom('git@github.com:someone/fork-x.git'), 'someone/fork-x');
assert.equal(repoFrom('https://gitlab.com/a/b'), undefined);
assert.equal(shortNotes('**Novinky**\n- **Jazyk:** opraveno\n- `x` y'), 'Jazyk: opraveno · x y');
console.log('updater unit ok');

if (process.argv[2] === 'live') {
  (async () => {
    const rel = await latestRelease('LukasVitek67/octomilka');
    assert(rel, 'žádný release');
    console.log(`latest ${rel.version} ${rel.asset.name} sha256=${rel.asset.sha256?.slice(0, 12)}…`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octo-upd-'));
    const f = await downloadRelease(rel, dir);
    assert.equal(await sha256File(f), rel.asset.sha256);
    // podvržený otisk musí instalaci zastavit
    await assert.rejects(downloadRelease({ ...rel, asset: { ...rel.asset, sha256: '0'.repeat(64) } }, dir), /SHA256/);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('updater live ok (stažení + ověření SHA256 + odmítnutí špatného otisku)');
  })().catch((e) => {
    console.error('FAIL', e);
    process.exit(1);
  });
}
