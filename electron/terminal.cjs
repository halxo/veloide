const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Lightweight interactive terminal manager with zero native addons.
 * Every VeloIde-installed compiler is automatically prepended to PATH.
 */
function createTerminalManager(toolchainManager) {
  let cwd = os.homedir();
  let activeProc = null;

  function setCwd(nextCwd) {
    if (nextCwd) {
      cwd = path.resolve(nextCwd);
    }
    return cwd;
  }

  function getCwd() {
    return cwd;
  }

  function killRunning() {
    if (!activeProc || activeProc.killed) return false;
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(activeProc.pid), '/T', '/F'], { windowsHide: true });
      } else {
        try {
          process.kill(-activeProc.pid, 'SIGINT');
        } catch {
          activeProc.kill('SIGINT');
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  function sendInput(text) {
    if (activeProc && activeProc.stdin && !activeProc.stdin.destroyed) {
      activeProc.stdin.write(text);
      return true;
    }
    return false;
  }

  function execCommand(rawCommand, emit = () => {}) {
    const command = String(rawCommand || '').trim();
    if (!command) return Promise.resolve({ code: 0, cwd });

    // Handle `cd <dir>` directly so cwd persists across commands
    const cdMatch = command.match(/^cd(?:\s+(.*))?$/i);
    if (cdMatch) {
      const target = (cdMatch[1] || '').trim().replace(/^["']|["']$/g, '');
      const next = !target || target === '~' ? os.homedir() : path.resolve(cwd, target);
      try {
        const fs = require('fs');
        if (fs.statSync(next).isDirectory()) {
          cwd = next;
          emit({ type: 'cwd', cwd });
          return Promise.resolve({ code: 0, cwd });
        }
      } catch {
        // fall through
      }
      emit({ type: 'stderr', text: `cd: no such directory: ${target}\n` });
      return Promise.resolve({ code: 1, cwd });
    }

    killRunning();

    const env = toolchainManager.getAugmentedEnv(process.env);
    const isWin = process.platform === 'win32';
    const shellBin = isWin ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL || '/bin/bash';
    const shellArgs = isWin ? ['/d', '/s', '/c', command] : ['-c', command];

    return new Promise((resolve) => {
      const proc = spawn(shellBin, shellArgs, {
        cwd,
        env,
        detached: !isWin,
        windowsHide: true,
      });

      activeProc = proc;
      emit({ type: 'start', command, cwd });

      if (proc.stdout) {
        proc.stdout.on('data', (chunk) => emit({ type: 'stdout', text: chunk.toString('utf8') }));
      }
      if (proc.stderr) {
        proc.stderr.on('data', (chunk) => emit({ type: 'stderr', text: chunk.toString('utf8') }));
      }

      proc.on('error', (err) => {
        emit({ type: 'stderr', text: `${err.message}\n` });
        activeProc = null;
        resolve({ code: 127, cwd });
      });

      proc.on('close', (code) => {
        activeProc = null;
        emit({ type: 'exit', code: code ?? 0, cwd });
        resolve({ code: code ?? 0, cwd });
      });
    });
  }

  return {
    getCwd,
    setCwd,
    execCommand,
    sendInput,
    killRunning,
  };
}

module.exports = {
  createTerminalManager,
};
