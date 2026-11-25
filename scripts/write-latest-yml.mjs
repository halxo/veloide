#!/usr/bin/env node
/**
 * Generates electron-updater's `latest.yml` for the Windows NSIS installer
 * so GitHub Releases can be published atomically without electron-builder's
 * concurrent-upload duplicate-release race.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const releaseDir = path.join(root, 'release');
const exeName = `VeloIde-Setup-${version}.exe`;
const exePath = path.join(releaseDir, exeName);

if (!fs.existsSync(exePath)) {
  throw new Error(`Expected installer not found: ${exePath}`);
}

const stat = fs.statSync(exePath);
const hash = crypto.createHash('sha512');
hash.update(fs.readFileSync(exePath));
const sha512 = hash.digest('base64');
const releaseDate = new Date().toISOString();

const yml = [
  `version: ${version}`,
  `files:`,
  `  - url: ${exeName}`,
  `    sha512: ${sha512}`,
  `    size: ${stat.size}`,
  `path: ${exeName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  '',
].join('\n');

const outPath = path.join(releaseDir, 'latest.yml');
fs.writeFileSync(outPath, yml, 'utf8');
console.log(`Wrote ${outPath} (${stat.size} bytes, sha512=${sha512.slice(0, 16)}...)`);
