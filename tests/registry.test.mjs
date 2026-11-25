import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadRegistry, detectLanguage, detectProjectRun } = require('../electron/registry.cjs');

test('detects languages across extensions and shebangs', () => {
  const reg = loadRegistry();
  assert.ok(reg.languages.length >= 45);
  assert.ok(Object.keys(reg.toolchains).length >= 20);

  assert.equal(detectLanguage(reg, { filePath: 'main.c' })?.id, 'c');
  assert.equal(detectLanguage(reg, { filePath: 'main.cpp' })?.id, 'cpp');
  assert.equal(detectLanguage(reg, { filePath: 'main.rs' })?.id, 'rust');
  assert.equal(detectLanguage(reg, { filePath: 'main.go' })?.id, 'go');
  assert.equal(detectLanguage(reg, { filePath: 'app.ts' })?.id, 'typescript');
  assert.equal(detectLanguage(reg, { filePath: 'Program.cs' })?.id, 'csharp');
  assert.equal(detectLanguage(reg, { filePath: 'query.sql' })?.id, 'sql');
  assert.equal(detectLanguage(reg, { filePath: 'main.zig' })?.id, 'zig');
  assert.equal(detectLanguage(reg, { filePath: 'script.lua' })?.id, 'lua');

  // Shebang fallback when file has no extension
  assert.equal(
    detectLanguage(reg, { filePath: 'my-script', content: '#!/usr/bin/env python3\nprint(1)\n' })?.id,
    'python'
  );
  assert.equal(
    detectLanguage(reg, { filePath: 'runme', content: '#!/bin/bash\necho ok\n' })?.id,
    'shell'
  );
});

test('detects project files and .veloide/run overrides', () => {
  const reg = loadRegistry();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloide-proj-'));
  try {
    const srcDir = path.join(root, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const rsFile = path.join(srcDir, 'main.rs');
    fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname="demo"\n');
    fs.writeFileSync(rsFile, 'fn main() {}\n');

    const cargoProj = detectProjectRun(reg, rsFile, root);
    assert.equal(cargoProj?.kind, 'project');
    assert.equal(cargoProj?.detectorFile, 'Cargo.toml');
    assert.deepEqual(cargoProj?.cmd, ['cargo', 'run']);

    // .veloide/run takes highest priority
    fs.mkdirSync(path.join(root, '.veloide'), { recursive: true });
    fs.writeFileSync(path.join(root, '.veloide', 'run'), 'cargo run --release\n');
    const override = detectProjectRun(reg, rsFile, root);
    assert.equal(override?.kind, 'override');
    assert.equal(override?.shellCommand, 'cargo run --release');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
