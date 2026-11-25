import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

// Strip types directly from src/editor/errorParser.ts using Node 22's built-in stripper
const parserPath = path.resolve(import.meta.dirname, '..', 'src', 'editor', 'errorParser.ts');
const tsCode = fs.readFileSync(parserPath, 'utf8');
const jsCode = stripTypeScriptTypes(tsCode);
const { parseDiagnostics } = await import(
  `data:text/javascript;base64,${Buffer.from(jsCode).toString('base64')}`
);

test('parses GCC/Clang, Rust, Python, Go, C#, and Node error diagnostics', () => {
  const sample = [
    "main.c:14:5: error: expected ';' before 'return'",
    'error[E0425]: cannot find value `foo` in this scope',
    '  --> src/main.rs:8:12',
    'Traceback (most recent call last):',
    '  File "/tmp/app.py", line 22, in main',
    '    print(1 / 0)',
    'ZeroDivisionError: division by zero',
    './main.go:19:2: undefined: bar',
    'Program.cs(7,15): error CS1002: ; expected',
    '    at boom (/tmp/app.ts:31:9)',
  ].join('\n');

  const diags = parseDiagnostics(sample);
  assert.equal(diags.length, 6);

  assert.equal(diags[0].file, 'main.c');
  assert.equal(diags[0].line, 14);
  assert.equal(diags[0].column, 5);

  assert.equal(diags[1].file, 'src/main.rs');
  assert.equal(diags[1].line, 8);
  assert.equal(diags[1].column, 12);

  assert.equal(diags[2].file, '/tmp/app.py');
  assert.equal(diags[2].line, 22);
  assert.match(diags[2].message, /ZeroDivisionError/);

  assert.equal(diags[3].file, './main.go');
  assert.equal(diags[3].line, 19);

  assert.equal(diags[4].file, 'Program.cs');
  assert.equal(diags[4].line, 7);
  assert.equal(diags[4].column, 15);

  assert.equal(diags[5].file, '/tmp/app.ts');
  assert.equal(diags[5].line, 31);
});
