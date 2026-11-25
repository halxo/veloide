import type { Diagnostic } from '../model/types';

/**
 * Parses compiler and runtime error locations from GCC/Clang/Zig, rustc, Go,
 * Python tracebacks, Node/Bun/TS, Java/Kotlin, C#/.NET, Ruby, PHP, and generic file:line:col.
 */
export function parseDiagnostics(outputText: string): Diagnostic[] {
  if (!outputText) return [];
  const results: Diagnostic[] = [];
  const seen = new Set<string>();
  const lines = outputText.split(/\r?\n/);

  const push = (diag: Diagnostic) => {
    const key = `${diag.file ?? ''}:${diag.line}:${diag.column}:${diag.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(diag);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // 1. Rust: "  --> src/main.rs:12:5"
    const rustMatch = line.match(/^\s*-->\s+(.+?):(\d+):(\d+)\s*$/);
    if (rustMatch) {
      const prevLine = i > 0 ? lines[i - 1].trim() : '';
      const isWarn = /^warning/i.test(prevLine);
      push({
        file: rustMatch[1],
        line: Number(rustMatch[2]),
        column: Number(rustMatch[3]),
        severity: isWarn ? 'warning' : 'error',
        message: prevLine || 'Rust compiler diagnostic',
        raw: line,
      });
      continue;
    }

    // 2. Python: '  File "/path/to/app.py", line 14, in main'
    const pyMatch = line.match(/^\s*File\s+"(.+?)",\s+line\s+(\d+)/);
    if (pyMatch) {
      // Find the exception message a couple lines below if available
      let msg = 'Python traceback';
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        if (/^[A-Za-z_]+(?:Error|Exception):/.test(lines[j].trim())) {
          msg = lines[j].trim();
          break;
        }
      }
      push({
        file: pyMatch[1],
        line: Number(pyMatch[2]),
        column: 1,
        severity: 'error',
        message: msg,
        raw: line,
      });
      continue;
    }

    // 3. C# / MSBuild: "Program.cs(12,9): error CS1002: ; expected"
    const csMatch = line.match(/^\s*(.+?\.[A-Za-z0-9_]+)\((\d+),(\d+)\):\s*(error|warning)\s*(.*)$/i);
    if (csMatch) {
      push({
        file: csMatch[1],
        line: Number(csMatch[2]),
        column: Number(csMatch[3]),
        severity: csMatch[4].toLowerCase() === 'warning' ? 'warning' : 'error',
        message: csMatch[5].trim(),
        raw: line,
      });
      continue;
    }

    // 4. Node / Bun stack frames: "    at fn (/path/file.ts:10:15)" or "    at /path/file.js:10:15"
    const jsStackMatch = line.match(
      /\bat\s+(?:.+?\s+\()?((?:[A-Za-z]:)?[^():\r\n]+\.[cm]?[jt]sx?):(\d+):(\d+)\)?/
    );
    if (jsStackMatch) {
      push({
        file: jsStackMatch[1],
        line: Number(jsStackMatch[2]),
        column: Number(jsStackMatch[3]),
        severity: 'error',
        message: line.trim(),
        raw: line,
      });
      continue;
    }

    // 5. GCC / Clang / Zig / Go / Java / Kotlin / TypeScript / Generic:
    //    "main.c:14:5: error: expected ';'" or "C:\dir\main.go:8:2: undefined: x"
    const genericMatch = line.match(
      /^\s*((?:[A-Za-z]:)?[^:\r\n]+\.[A-Za-z0-9_]+):(\d+)(?::(\d+))?:\s*(.+)$/
    );
    if (genericMatch) {
      const msg = genericMatch[4].trim();
      const isWarn = /^warning\b/i.test(msg);
      push({
        file: genericMatch[1].trim(),
        line: Number(genericMatch[2]),
        column: genericMatch[3] ? Number(genericMatch[3]) : 1,
        severity: isWarn ? 'warning' : 'error',
        message: msg,
        raw: line,
      });
    }
  }

  return results;
}
