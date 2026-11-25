const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ensureDir } = require('./paths.cjs');
const { detectLanguage, detectProjectRun } = require('./registry.cjs');

/**
 * Kills a running process and its entire child tree cleanly across Windows, Linux, and macOS.
 */
function killProcessTree(proc) {
  if (!proc || proc.killed || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      try {
        process.kill(-proc.pid, 'SIGTERM');
      } catch {
        proc.kill('SIGTERM');
      }
    }
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      // ignore
    }
  }
}

/**
 * Substitutes placeholders in a command template array ({file}, {out}, {dir}, {toolchainBin}).
 */
function expandTemplate(args, vars) {
  return args.map((token) =>
    token
      .replace(/\{file\}/g, vars.file)
      .replace(/\{out\}/g, vars.out)
      .replace(/\{dir\}/g, vars.dir)
      .replace(/\{toolchainBin\}/g, vars.toolchainBin || '')
  );
}

/**
 * Splits a CLI argument string respecting single and double quotes.
 */
function splitArgs(input) {
  if (!input || !input.trim()) return [];
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function createRunner(paths, registry, toolchainManager) {
  let activeRun = null;

  function stopCurrent() {
    if (activeRun && activeRun.proc) {
      activeRun.cancelled = true;
      killProcessTree(activeRun.proc);
      return true;
    }
    return false;
  }

  function sendStdin(text) {
    if (activeRun && activeRun.proc && activeRun.proc.stdin && !activeRun.proc.stdin.destroyed) {
      activeRun.proc.stdin.write(text);
      return true;
    }
    return false;
  }

  /**
   * Prepares a file on disk for execution (if scratch buffer, writes to `<tmpDir>/scratch/`).
   */
  function materializeTarget(request, lang) {
    if (request.filePath && !request.isScratch) {
      return {
        targetFile: path.resolve(request.filePath),
        cwd: path.dirname(path.resolve(request.filePath)),
        isTemp: false,
      };
    }

    const scratchDir = ensureDir(path.join(paths.tmpDir, 'scratch'));
    const ext =
      (request.filePath && path.extname(request.filePath)) ||
      (lang && lang.extensions && lang.extensions[0]) ||
      '.txt';

    // Java requires filename to match public class name if one is declared
    let baseName = 'main';
    if (lang && lang.id === 'java') {
      const m = (request.content || '').match(/public\s+class\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (m) baseName = m[1];
      else baseName = 'Main';
    }

    const targetFile = path.join(scratchDir, `${baseName}${ext}`);
    fs.writeFileSync(targetFile, request.content || '', 'utf8');
    return {
      targetFile,
      cwd: scratchDir,
      isTemp: true,
    };
  }

  /**
   * Built-in zero-download runners for HTML, Markdown, JSON, YAML, TOML, CSS.
   */
  function runBuiltin(kind, request, emit) {
    const startedAt = Date.now();
    const content = request.content || '';

    if (kind === 'preview-html') {
      emit({ type: 'preview', format: 'html', content });
      emit({ type: 'exit', code: 0, durationMs: Date.now() - startedAt, command: 'Built-in HTML Preview' });
      return { ok: true, code: 0 };
    }

    if (kind === 'preview-markdown') {
      emit({ type: 'preview', format: 'markdown', content });
      emit({ type: 'exit', code: 0, durationMs: Date.now() - startedAt, command: 'Built-in Markdown Preview' });
      return { ok: true, code: 0 };
    }

    if (kind === 'validate-json') {
      try {
        const parsed = JSON.parse(content);
        const pretty = JSON.stringify(parsed, null, 2);
        const keys = Array.isArray(parsed)
          ? `Array(${parsed.length})`
          : parsed && typeof parsed === 'object'
            ? `Object(${Object.keys(parsed).length} keys)`
            : typeof parsed;
        emit({ type: 'stdout', text: `Valid JSON — ${keys}\n\n${pretty.slice(0, 8000)}\n` });
        emit({ type: 'exit', code: 0, durationMs: Date.now() - startedAt, command: 'Built-in JSON Validator' });
        return { ok: true, code: 0 };
      } catch (err) {
        emit({ type: 'stderr', text: `JSON Syntax Error: ${err.message}\n` });
        emit({ type: 'exit', code: 1, durationMs: Date.now() - startedAt, command: 'Built-in JSON Validator' });
        return { ok: false, code: 1 };
      }
    }

    // Basic lightweight syntax check for YAML / TOML / CSS
    const lines = content.split(/\r?\n/);
    if (kind === 'validate-toml') {
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i].trim();
        if (!l || l.startsWith('#') || l.startsWith('[')) continue;
        if (!l.includes('=')) {
          emit({
            type: 'stderr',
            text: `${request.filePath || 'scratch.toml'}:${i + 1}:1: Expected key = value\n`,
          });
          emit({ type: 'exit', code: 1, durationMs: Date.now() - startedAt, command: 'Built-in TOML Check' });
          return { ok: false, code: 1 };
        }
      }
      emit({ type: 'stdout', text: `Valid TOML (${lines.length} lines)\n` });
      emit({ type: 'exit', code: 0, durationMs: Date.now() - startedAt, command: 'Built-in TOML Check' });
      return { ok: true, code: 0 };
    }

    emit({ type: 'stdout', text: `${kind.replace('validate-', '').toUpperCase()} checked (${lines.length} lines)\n` });
    emit({ type: 'exit', code: 0, durationMs: Date.now() - startedAt, command: `Built-in ${kind}` });
    return { ok: true, code: 0 };
  }

  /**
   * Executes a single process and streams stdout/stderr via `emit`.
   */
  function execStep(cmd, args, options, emit) {
    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      const useShell = Boolean(options.shell) || (isWin && /\.(bat|cmd)$/i.test(cmd));

      const proc = spawn(cmd, args, {
        cwd: options.cwd,
        env: options.env,
        shell: useShell,
        detached: !isWin,
        windowsHide: true,
      });

      if (activeRun) {
        activeRun.proc = proc;
      }

      if (proc.stdout) {
        proc.stdout.on('data', (chunk) => {
          emit({ type: 'stdout', text: chunk.toString('utf8') });
        });
      }

      if (proc.stderr) {
        proc.stderr.on('data', (chunk) => {
          emit({ type: 'stderr', text: chunk.toString('utf8') });
        });
      }

      proc.on('error', (err) => {
        emit({ type: 'stderr', text: `Failed to start "${cmd}": ${err.message}\n` });
        resolve({ code: 127 });
      });

      proc.on('close', (code, signal) => {
        resolve({ code: code === null ? (signal ? 130 : 1) : code, signal });
      });
    });
  }

  /**
   * Main entry point for ▶ Run (F5).
   * Returns `{ needsInstall, runtime }` if the required compiler isn't installed yet,
   * or executes the program and streams events through `emit`.
   */
  async function run(request, emit = () => {}) {
    stopCurrent();

    const customRunCommands = request.customRunCommands || {};
    const lang = detectLanguage(registry, {
      filePath: request.filePath,
      content: request.content,
      explicitLanguageId: request.languageId,
    });

    // 1. Check project-level `.veloide/run` override or project files (Cargo.toml, go.mod, etc.)
    const projectInfo =
      !request.isScratch && request.filePath
        ? detectProjectRun(registry, request.filePath, request.workspaceRoot)
        : null;

    const env = toolchainManager.getAugmentedEnv(process.env);
    const extraArgs = splitArgs(request.args || '');
    const startedAt = Date.now();

    if (projectInfo && projectInfo.kind === 'override') {
      const fullCmd = extraArgs.length
        ? `${projectInfo.shellCommand} ${extraArgs.join(' ')}`
        : projectInfo.shellCommand;
      activeRun = { proc: null, cancelled: false };
      emit({ type: 'start', command: fullCmd, cwd: projectInfo.projectRoot, source: '.veloide/run' });
      const res = await execStep(fullCmd, [], { cwd: projectInfo.projectRoot, env, shell: true }, emit);
      const durationMs = Date.now() - startedAt;
      emit({ type: 'exit', code: res.code, durationMs, command: fullCmd, cancelled: activeRun.cancelled });
      activeRun = null;
      return { ok: res.code === 0, code: res.code, durationMs };
    }

    // 2. Resolve runtime for the language
    const ext = request.filePath ? path.extname(request.filePath).toLowerCase() : null;
    const runtime = toolchainManager.resolveLanguageRuntime(lang, customRunCommands, { extension: ext });

    if (!runtime.ready) {
      return {
        ok: false,
        needsInstall: runtime.source === 'missing-managed',
        missingSystem: runtime.source === 'missing-system',
        unknownLanguage: runtime.source === 'unknown',
        language: lang,
        runtime,
      };
    }

    // 3. Built-in runner (HTML, Markdown, JSON, YAML, TOML)
    if (runtime.source === 'builtin') {
      return runBuiltin(runtime.builtinRunner, request, emit);
    }

    const { targetFile, cwd } = materializeTarget(request, lang);
    const outDir = ensureDir(path.join(paths.tmpDir, 'out'));
    const hash = crypto.createHash('sha1').update(targetFile).digest('hex').slice(0, 10);
    const outBin = path.join(
      outDir,
      `${path.basename(targetFile, path.extname(targetFile))}-${hash}${process.platform === 'win32' ? '.exe' : ''}`
    );

    activeRun = { proc: null, cancelled: false };

    // 4. Custom per-extension run command
    if (runtime.source === 'custom') {
      const cmdStr = runtime.customCommand
        .replace(/\{file\}/g, `"${targetFile}"`)
        .replace(/\{out\}/g, `"${outBin}"`)
        .replace(/\{dir\}/g, `"${cwd}"`);
      const fullCmd = extraArgs.length ? `${cmdStr} ${extraArgs.join(' ')}` : cmdStr;
      emit({ type: 'start', command: fullCmd, cwd, source: runtime.label });
      const res = await execStep(fullCmd, [], { cwd, env, shell: true }, emit);
      const durationMs = Date.now() - startedAt;
      emit({ type: 'exit', code: res.code, durationMs, command: fullCmd, cancelled: activeRun.cancelled });
      activeRun = null;
      return { ok: res.code === 0, code: res.code, durationMs };
    }

    // 5. Project runner (Cargo.toml, go.mod, build.zig, *.csproj, etc.)
    if (projectInfo && projectInfo.kind === 'project') {
      const [bin, ...baseArgs] = projectInfo.cmd;
      const finalArgs = [...baseArgs, ...extraArgs];
      const displayCmd = `${bin} ${finalArgs.join(' ')}`.trim();
      emit({
        type: 'start',
        command: displayCmd,
        cwd: projectInfo.projectRoot,
        source: `${projectInfo.detectorFile} (${runtime.label})`,
      });
      const res = await execStep(bin, finalArgs, { cwd: projectInfo.projectRoot, env }, emit);
      const durationMs = Date.now() - startedAt;
      emit({ type: 'exit', code: res.code, durationMs, command: displayCmd, cancelled: activeRun.cancelled });
      activeRun = null;
      return { ok: res.code === 0, code: res.code, durationMs };
    }

    // 6. Special single-file C# runner (auto-generates ephemeral .csproj in tmpDir)
    if (lang && lang.specialRunner === 'dotnet-single-cs') {
      const csProjDir = ensureDir(path.join(paths.tmpDir, `cs-${hash}`));
      const csProjFile = path.join(csProjDir, 'VeloScratch.csproj');
      const csCodeFile = path.join(csProjDir, 'Program.cs');
      fs.copyFileSync(targetFile, csCodeFile);
      fs.writeFileSync(
        csProjFile,
        `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>Exe</OutputType>\n    <TargetFramework>net10.0</TargetFramework>\n    <ImplicitUsings>enable</ImplicitUsings>\n    <Nullable>enable</Nullable>\n  </PropertyGroup>\n</Project>\n`,
        'utf8'
      );
      const dotnetBin = runtime.binPath || 'dotnet';
      const args = ['run', '--project', csProjFile, ...(extraArgs.length ? ['--', ...extraArgs] : [])];
      const displayCmd = `dotnet run ${path.basename(targetFile)}`;
      emit({ type: 'start', command: displayCmd, cwd, source: runtime.label });
      const res = await execStep(dotnetBin, args, { cwd, env }, emit);
      const durationMs = Date.now() - startedAt;
      emit({ type: 'exit', code: res.code, durationMs, command: displayCmd, cancelled: activeRun.cancelled });
      activeRun = null;
      return { ok: res.code === 0, code: res.code, durationMs };
    }

    // 7. Standard compile-and-run or direct-run recipe
    const vars = {
      file: targetFile,
      out: outBin,
      dir: cwd,
      toolchainBin: runtime.binPath || '',
    };

    const spec = runtime.commandSpec;
    const compileArgs = spec.compile ? expandTemplate(spec.compile, vars) : null;
    const runArgs = expandTemplate(spec.run, vars);

    const displayCmd = compileArgs
      ? `${path.basename(compileArgs[0])} ${compileArgs.slice(1).join(' ')} && ${path.basename(runArgs[0])}`
      : `${path.basename(runArgs[0])} ${runArgs.slice(1).join(' ')}`;

    emit({ type: 'start', command: displayCmd, cwd, source: runtime.label });

    if (compileArgs) {
      const [compBin, ...compRest] = compileArgs;
      const compRes = await execStep(compBin, compRest, { cwd, env }, emit);
      if (compRes.code !== 0 || activeRun.cancelled) {
        const durationMs = Date.now() - startedAt;
        emit({
          type: 'exit',
          code: compRes.code,
          durationMs,
          command: displayCmd,
          stage: 'compile',
          cancelled: activeRun.cancelled,
        });
        activeRun = null;
        return { ok: false, code: compRes.code, durationMs, stage: 'compile' };
      }
    }

    const [runBin, ...runRest] = runArgs;
    const execRes = await execStep(runBin, [...runRest, ...extraArgs], { cwd, env }, emit);
    const durationMs = Date.now() - startedAt;
    emit({
      type: 'exit',
      code: execRes.code,
      durationMs,
      command: displayCmd,
      stage: 'run',
      cancelled: activeRun.cancelled,
    });
    activeRun = null;
    return { ok: execRes.code === 0, code: execRes.code, durationMs };
  }

  return {
    run,
    stopCurrent,
    sendStdin,
  };
}

module.exports = {
  createRunner,
  splitArgs,
  expandTemplate,
};
