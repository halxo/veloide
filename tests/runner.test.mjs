import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolvePaths, ensureDataDirs } = require('../electron/paths.cjs');
const { loadRegistry } = require('../electron/registry.cjs');
const { createToolchainManager } = require('../electron/toolchains.cjs');
const { createRunner } = require('../electron/runner.cjs');

async function runSnippet(runner, { languageId, filePath, content, isScratch = true, customRunCommands = {} }) {
  let stdout = '';
  let stderr = '';
  let preview = null;
  const res = await runner.run(
    { filePath, content, languageId, isScratch, workspaceRoot: null, customRunCommands },
    (ev) => {
      if (ev.type === 'stdout') stdout += ev.text;
      if (ev.type === 'stderr') stderr += ev.text;
      if (ev.type === 'preview') preview = ev;
    }
  );
  return { res, stdout, stderr, preview };
}

test('compiles and runs polyglot scratch programs end-to-end (C, C++, Python, JS, Go, Rust, Shell, JSON, HTML)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloide-run-'));
  try {
    const paths = resolvePaths({ env: { VELOIDE_DATA_DIR: path.join(root, 'data') } });
    ensureDataDirs(paths);
    const reg = loadRegistry(paths);
    const tc = createToolchainManager(paths, reg);
    const runner = createRunner(paths, reg, tc);

    // 1. C
    const cRes = await runSnippet(runner, {
      languageId: 'c',
      filePath: 'scratch.c',
      content: '#include <stdio.h>\nint main(void){ printf("C_OK_%d\\n", 6*7); return 0; }\n',
    });
    assert.equal(cRes.res.ok, true, cRes.stderr);
    assert.match(cRes.stdout, /C_OK_42/);

    // 2. C++
    const cppRes = await runSnippet(runner, {
      languageId: 'cpp',
      filePath: 'scratch.cpp',
      content: '#include <iostream>\nint main(){ std::cout << "CPP_OK\\n"; }\n',
    });
    assert.equal(cppRes.res.ok, true, cppRes.stderr);
    assert.match(cppRes.stdout, /CPP_OK/);

    // 3. Python
    const pyRes = await runSnippet(runner, {
      languageId: 'python',
      filePath: 'scratch.py',
      content: 'print("PY_OK", 2 + 2)\n',
    });
    assert.equal(pyRes.res.ok, true, pyRes.stderr);
    assert.match(pyRes.stdout, /PY_OK 4/);

    // 4. JavaScript
    const jsRes = await runSnippet(runner, {
      languageId: 'javascript',
      filePath: 'scratch.js',
      content: 'console.log("JS_OK_" + (10 + 5));\n',
    });
    assert.equal(jsRes.res.ok, true, jsRes.stderr);
    assert.match(jsRes.stdout, /JS_OK_15/);

    // 5. Go (if system go exists on runner)
    if (tc.findSystemBinary('go')) {
      const goRes = await runSnippet(runner, {
        languageId: 'go',
        filePath: 'scratch.go',
        content: 'package main\nimport "fmt"\nfunc main(){ fmt.Println("GO_OK") }\n',
      });
      assert.equal(goRes.res.ok, true, goRes.stderr);
      assert.match(goRes.stdout, /GO_OK/);
    }

    // 6. Rust (if system rustc exists on runner)
    if (tc.findSystemBinary('rustc')) {
      const rsRes = await runSnippet(runner, {
        languageId: 'rust',
        filePath: 'scratch.rs',
        content: 'fn main(){ println!("RUST_OK"); }\n',
      });
      assert.equal(rsRes.res.ok, true, rsRes.stderr);
      assert.match(rsRes.stdout, /RUST_OK/);
    }

    // 7. Built-in JSON validator & HTML preview
    const jsonRes = await runSnippet(runner, {
      languageId: 'json',
      filePath: 'data.json',
      content: '{"velo":"ide"}',
    });
    assert.equal(jsonRes.res.ok, true);
    assert.match(jsonRes.stdout, /Valid JSON/);

    const htmlRes = await runSnippet(runner, {
      languageId: 'html',
      filePath: 'index.html',
      content: '<h1>Hello</h1>',
    });
    assert.equal(htmlRes.res.ok, true);
    assert.equal(htmlRes.preview?.format, 'html');

    // 8. Custom per-extension run command
    const customRes = await runSnippet(runner, {
      languageId: 'plaintext',
      filePath: 'hello.myext',
      content: 'CUSTOM_WORLD',
      customRunCommands: { '.myext': 'node -e "console.log(require(\'fs\').readFileSync(process.argv[1], \'utf8\'))" {file}' },
    });
    assert.equal(customRes.res.ok, true, customRes.stderr);
    assert.match(customRes.stdout, /CUSTOM_WORLD/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('on-demand downloads, extracts, and runs an isolated managed toolchain (Luau)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloide-ondemand-'));
  try {
    const paths = resolvePaths({ env: { VELOIDE_DATA_DIR: path.join(root, 'data') } });
    ensureDataDirs(paths);
    const reg = loadRegistry(paths);
    const tc = createToolchainManager(paths, reg);
    const runner = createRunner(paths, reg, tc);

    // Install Luau (~7 MB zip) directly into isolated data/toolchains/luau
    const status = await tc.installToolchain('luau');
    assert.equal(status.installedManaged, true);
    assert.ok(status.managedBin && fs.existsSync(status.managedBin));
    assert.ok(status.diskBytes > 100000);

    // Run a Lua/Luau script using the newly installed isolated binary
    const luaRes = await runSnippet(runner, {
      languageId: 'lua',
      filePath: 'scratch.luau',
      content: 'print("LUAU_ONDEMAND_OK_" .. tostring(21 * 2))\n',
    });
    assert.equal(luaRes.res.ok, true, luaRes.stderr);
    assert.match(luaRes.stdout, /LUAU_ONDEMAND_OK_42/);

    // Verify clean removal frees storage
    const afterRemove = tc.removeToolchain('luau');
    assert.equal(afterRemove.installedManaged, false);
    assert.equal(afterRemove.diskBytes, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
