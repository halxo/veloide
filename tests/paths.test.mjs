import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  resolvePaths,
  ensureDataDirs,
  toStoredPath,
  fromStoredPath,
  cleanTmpDir,
} = require('../electron/paths.cjs');

test('defaults to installed mode under ~/.veloide when no portable marker exists', () => {
  const tmpExecDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloide-inst-'));
  try {
    const paths = resolvePaths({
      execPath: path.join(tmpExecDir, 'VeloIde'),
      argv: ['VeloIde'],
      env: {},
      platform: 'linux',
    });
    assert.equal(paths.isPortable, false);
    assert.equal(paths.dataRoot, path.join(os.homedir(), '.veloide'));
  } finally {
    fs.rmSync(tmpExecDir, { recursive: true, force: true });
  }
});

test('activates portable mode when `portable` marker sits next to executable', () => {
  const usbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'veloide-usb-'));
  try {
    fs.writeFileSync(path.join(usbRoot, 'portable'), '');
    const paths = resolvePaths({
      execPath: path.join(usbRoot, 'VeloIde.exe'),
      argv: ['VeloIde.exe'],
      env: {},
      platform: 'win32',
    });

    assert.equal(paths.isPortable, true);
    assert.equal(paths.portableBase, usbRoot);
    assert.equal(paths.dataRoot, path.join(usbRoot, 'data'));
    assert.equal(paths.toolchainsDir, path.join(usbRoot, 'data', 'toolchains'));
    assert.equal(paths.modelsDir, path.join(usbRoot, 'data', 'models'));

    ensureDataDirs(paths);
    assert.ok(fs.existsSync(paths.electronUserData));
    assert.ok(fs.existsSync(paths.toolchainsDir));

    // Relative path portability across USB drive-letter changes
    const fileOnStick = path.join(usbRoot, 'projects', 'fix.py');
    const stored = toStoredPath(paths, fileOnStick);
    assert.equal(stored, '$PORTABLE/projects/fix.py');

    // Simulate USB remounted at a different path
    const remounted = { ...paths, portableBase: '/mnt/usb-f' };
    assert.equal(fromStoredPath(remounted, stored), path.resolve('/mnt/usb-f', 'projects/fix.py'));

    // Temp cleanup on exit
    fs.writeFileSync(path.join(paths.tmpDir, 'scratch.c'), 'int main(){}');
    cleanTmpDir(paths);
    assert.equal(fs.existsSync(paths.tmpDir), false);
  } finally {
    fs.rmSync(usbRoot, { recursive: true, force: true });
  }
});

test('detects portable marker beside macOS .app bundle', () => {
  const macUsb = fs.mkdtempSync(path.join(os.tmpdir(), 'veloide-mac-'));
  try {
    const macosBinDir = path.join(macUsb, 'VeloIde.app', 'Contents', 'MacOS');
    fs.mkdirSync(macosBinDir, { recursive: true });
    fs.writeFileSync(path.join(macUsb, 'portable'), '');

    const paths = resolvePaths({
      execPath: path.join(macosBinDir, 'VeloIde'),
      argv: ['VeloIde'],
      env: {},
      platform: 'darwin',
    });

    assert.equal(paths.isPortable, true);
    assert.equal(paths.portableBase, macUsb);
    assert.equal(paths.dataRoot, path.join(macUsb, 'data'));
  } finally {
    fs.rmSync(macUsb, { recursive: true, force: true });
  }
});
