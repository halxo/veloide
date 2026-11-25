import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolvePaths, ensureDataDirs } = require('../electron/paths.cjs');
const { createFsService } = require('../electron/fsService.cjs');

test('guarded saves, external conflict detection, and 3-snapshot rotation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloide-fs-'));
  try {
    const paths = resolvePaths({ env: { VELOIDE_DATA_DIR: path.join(root, 'data') } });
    ensureDataDirs(paths);
    const fsSvc = createFsService(paths);

    const file = path.join(root, 'app.py');
    const first = fsSvc.saveFile(file, 'v1\n');
    assert.equal(first.ok, true);
    assert.equal(first.snapshots.length, 0);

    // Save 4 revisions -> ring caps at 3 snapshots
    let mtime = first.mtimeMs;
    for (const v of ['v2\n', 'v3\n', 'v4\n', 'v5\n']) {
      const res = fsSvc.saveFile(file, v, { expectedMtimeMs: mtime });
      assert.equal(res.ok, true);
      mtime = res.mtimeMs;
    }

    const snaps = fsSvc.listSnapshots(file);
    assert.equal(snaps.length, 3);
    assert.equal(fsSvc.readSnapshotContent(file, snaps[0].id), 'v4\n');
    assert.equal(fsSvc.readSnapshotContent(file, snaps[2].id), 'v2\n');

    // Simulate external modification (shift mtime by +5 seconds)
    fs.writeFileSync(file, 'external-edit\n');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(file, future, future);

    const conflictRes = fsSvc.saveFile(file, 'overwrite\n', { expectedMtimeMs: mtime });
    assert.equal(conflictRes.ok, false);
    assert.equal(conflictRes.conflict, true);

    const forced = fsSvc.saveFile(file, 'overwrite\n', { expectedMtimeMs: mtime, force: true });
    assert.equal(forced.ok, true);
    assert.equal(fs.readFileSync(file, 'utf8'), 'overwrite\n');

    // Folder tree + search
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'node_modules', 'ignored.js'), 'findme_needle');
    fs.writeFileSync(path.join(root, 'target.ts'), 'const x = "findme_needle";\n');

    const tree = fsSvc.readDirectoryTree(root);
    assert.ok(tree.entries.some((e) => e.name === 'target.ts'));
    assert.ok(!tree.entries.some((e) => e.name === 'node_modules'));

    const hits = await fsSvc.searchInFolder(root, 'findme_needle');
    assert.ok(hits.some((h) => h.relativePath.endsWith('target.ts')));
    assert.ok(!hits.some((h) => h.relativePath.includes('node_modules')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
