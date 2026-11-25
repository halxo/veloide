#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const registryPath = path.resolve(import.meta.dirname, '..', 'registry', 'toolchains.json');
const reg = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

let errors = 0;
const fail = (msg) => {
  console.error('FAIL:', msg);
  errors++;
};

if (!reg.qwen?.model?.url || !reg.qwen?.model?.sha256) {
  fail('Missing qwen model URL or SHA-256');
}
for (const p of ['win32-x64', 'linux-x64', 'darwin-arm64', 'darwin-x64']) {
  if (!reg.qwen?.runtime?.platforms?.[p]?.url) {
    fail(`Missing qwen runtime URL for ${p}`);
  }
}

const tcIds = new Set(Object.keys(reg.toolchains || {}));
if (tcIds.size < 18) {
  fail(`Expected at least 18 managed toolchains, found ${tcIds.size}`);
}

for (const [id, tc] of Object.entries(reg.toolchains)) {
  if (tc.id !== id) fail(`Toolchain key mismatch: ${id} vs ${tc.id}`);
  for (const dep of tc.dependsOn || []) {
    if (!tcIds.has(dep)) fail(`Toolchain ${id} depends on unknown toolchain ${dep}`);
  }
  const platforms = Object.values(tc.platforms || {});
  if (platforms.length === 0) fail(`Toolchain ${id} has no platform URLs`);
  for (const asset of platforms) {
    if (!asset.url || !asset.url.startsWith('https://')) {
      fail(`Toolchain ${id} has non-HTTPS URL: ${asset.url}`);
    }
  }
}

const langIds = new Set();
for (const lang of reg.languages || []) {
  if (langIds.has(lang.id)) fail(`Duplicate language id: ${lang.id}`);
  langIds.add(lang.id);
  if (lang.toolchain && !tcIds.has(lang.toolchain)) {
    fail(`Language ${lang.id} references unknown toolchain ${lang.toolchain}`);
  }
  if (!lang.extensions || lang.extensions.length === 0) {
    fail(`Language ${lang.id} has no extensions`);
  }
}

if (errors > 0) {
  console.error(`Registry validation failed with ${errors} error(s).`);
  process.exit(1);
}

console.log(
  `Registry OK: ${tcIds.size} managed toolchains, ${langIds.size} languages, Qwen2.5-Coder-1.5B verified.`
);

if (process.argv.includes('--live')) {
  const urls = new Set([reg.qwen.model.url]);
  for (const p of Object.values(reg.qwen.runtime.platforms)) urls.add(p.url);
  for (const tc of Object.values(reg.toolchains)) {
    for (const asset of Object.values(tc.platforms || {})) urls.add(asset.url);
  }
  let liveErrors = 0;
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      if (!res.ok) {
        console.error(`HTTP ${res.status} -> ${url}`);
        liveErrors++;
      }
    } catch (err) {
      console.error(`ERR -> ${url}: ${err.message}`);
      liveErrors++;
    }
  }
  if (liveErrors > 0) {
    console.error(`Live check failed for ${liveErrors} URL(s).`);
    process.exit(1);
  }
  console.log(`Live URL check OK: all ${urls.size} URLs returned 2xx.`);
}
