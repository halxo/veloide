import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolvePaths, ensureDataDirs } = require('../electron/paths.cjs');
const { createFsService } = require('../electron/fsService.cjs');
const { loadRegistry } = require('../electron/registry.cjs');
const { createQwenManager, buildFimPrompt, sanitizeCompletion } = require('../electron/qwen.cjs');

test('builds Qwen2.5-Coder FIM prompts and sanitizes completions cleanly', () => {
  const prompt = buildFimPrompt({
    filename: 'math.ts',
    language: 'typescript',
    prefix: 'function add(a: number, b: number) {\n  return ',
    suffix: ';\n}',
  });

  assert.ok(prompt.startsWith('<|fim_prefix|>'));
  assert.ok(prompt.includes('<|file_sep|>math.ts'));
  assert.ok(prompt.includes('<|fim_suffix|>;\n}<|fim_middle|>'));

  // Strips stop tokens and duplicate trailing suffix
  assert.equal(sanitizeCompletion('a + b;<|endoftext|>garbage', ';'), 'a + b');
  assert.equal(sanitizeCompletion('line1\nline2\nline3\nline4\nline5\nline6', ''), 'line1\nline2\nline3\nline4');
});

test('manages Qwen enable/disable state and returns disabled when turned off', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloide-qwen-'));
  try {
    const paths = resolvePaths({ env: { VELOIDE_DATA_DIR: path.join(root, 'data') } });
    ensureDataDirs(paths);
    const fsSvc = createFsService(paths);
    const reg = loadRegistry(paths);
    const qwen = createQwenManager(paths, reg, fsSvc);

    const initial = qwen.getStatus();
    assert.equal(initial.enabled, false);
    assert.equal(initial.installed, false);
    assert.ok(initial.totalDownloadBytes > 1_000_000_000);

    const res = await qwen.complete({ prefix: 'const x = ', suffix: '', filename: 'a.ts', language: 'typescript' });
    assert.equal(res.disabled, true);
    assert.equal(res.text, '');

    const disabled = qwen.setEnabled(false);
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.asked, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
