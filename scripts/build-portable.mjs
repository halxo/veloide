#!/usr/bin/env node
/**
 * Packages an electron-builder unpacked directory into a ready-to-run Portable archive
 * with the `portable` marker file and README-PORTABLE.txt included.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const releaseDir = path.join(root, 'release');

const target = process.argv[2] || process.platform;
const arch = process.argv[3] || (target === 'mac' ? 'arm64' : 'x64');

const PORTABLE_README = `VeloIde v${version} — Portable Mode
=======================================

This folder is completely self-contained. Carry it on a USB stick or drop it anywhere.

How it works:
  - The empty "portable" file next to VeloIde tells it to store ALL data inside "./data/".
  - Nothing is written to AppData, ~/.veloide, the Windows Registry, or system PATH.
  - Compilers you install on demand go into "./data/toolchains/".
  - Qwen2.5-Coder-1.5B (if enabled) goes into "./data/models/".
  - Temp build artifacts in "./data/tmp/" are automatically cleared when you quit.

Offline USB tip:
  Open VeloIde, press Ctrl+K, and run "Portable: Prepare for Offline (Prefill Compilers)"
  to preload your favorite compilers and Qwen2.5-Coder-1.5B before going offline.

Updates & source:
  https://github.com/halxo/veloide/releases/latest
`;

function ensureExists(p, label) {
  if (!fs.existsSync(p)) {
    throw new Error(`${label} not found at ${p}`);
  }
}

if (target === 'win' || target === 'win32') {
  const unpacked = path.join(releaseDir, 'win-unpacked');
  ensureExists(unpacked, 'win-unpacked');

  const stageName = `VeloIde-Portable-${version}-win-x64`;
  const stageDir = path.join(releaseDir, stageName);
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.cpSync(unpacked, stageDir, { recursive: true });

  fs.writeFileSync(path.join(stageDir, 'portable'), 'VeloIde portable mode marker\n', 'utf8');
  fs.writeFileSync(path.join(stageDir, 'README-PORTABLE.txt'), PORTABLE_README, 'utf8');
  fs.mkdirSync(path.join(stageDir, 'data'), { recursive: true });

  const outZip = path.join(releaseDir, `${stageName}.zip`);
  fs.rmSync(outZip, { force: true });

  if (process.platform === 'win32') {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${stageDir}' -DestinationPath '${outZip}' -CompressionLevel Optimal`,
      ],
      { stdio: 'inherit' }
    );
  } else {
    execFileSync('zip', ['-rq', outZip, stageName], { cwd: releaseDir, stdio: 'inherit' });
  }

  fs.rmSync(stageDir, { recursive: true, force: true });
  console.log(`Built ${outZip}`);
} else if (target === 'linux') {
  const unpacked = path.join(releaseDir, 'linux-unpacked');
  ensureExists(unpacked, 'linux-unpacked');

  const stageName = `VeloIde-Portable-${version}-linux-x64`;
  const stageDir = path.join(releaseDir, stageName);
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.cpSync(unpacked, stageDir, { recursive: true });

  fs.writeFileSync(path.join(stageDir, 'portable'), 'VeloIde portable mode marker\n', 'utf8');
  fs.writeFileSync(path.join(stageDir, 'README-PORTABLE.txt'), PORTABLE_README, 'utf8');
  fs.mkdirSync(path.join(stageDir, 'data'), { recursive: true });

  const outTar = path.join(releaseDir, `${stageName}.tar.gz`);
  fs.rmSync(outTar, { force: true });
  execFileSync('tar', ['-czf', outTar, '-C', releaseDir, stageName], { stdio: 'inherit' });

  fs.rmSync(stageDir, { recursive: true, force: true });
  console.log(`Built ${outTar}`);
} else if (target === 'mac' || target === 'darwin') {
  const candidates = arch === 'arm64' ? ['mac-arm64', 'mac'] : ['mac', 'mac-arm64'];
  const foundDir = candidates.map((d) => path.join(releaseDir, d)).find((p) => fs.existsSync(p));
  const unpacked = foundDir || path.join(releaseDir, candidates[0]);
  ensureExists(unpacked, 'mac unpacked bundle');

  const stageName = `VeloIde-Portable-${version}-mac-${arch}`;
  const stageDir = path.join(releaseDir, stageName);
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.cpSync(unpacked, stageDir, { recursive: true });

  fs.writeFileSync(path.join(stageDir, 'portable'), 'VeloIde portable mode marker\n', 'utf8');
  fs.writeFileSync(path.join(stageDir, 'README-PORTABLE.txt'), PORTABLE_README, 'utf8');
  fs.mkdirSync(path.join(stageDir, 'data'), { recursive: true });

  const outZip = path.join(releaseDir, `${stageName}.zip`);
  fs.rmSync(outZip, { force: true });
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', stageDir, outZip], {
    stdio: 'inherit',
  });

  fs.rmSync(stageDir, { recursive: true, force: true });
  console.log(`Built ${outZip}`);
} else {
  console.error(`Unknown portable target: ${target}`);
  process.exit(1);
}
