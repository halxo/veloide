import type { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { sql } from '@codemirror/lang-sql';
import { php } from '@codemirror/lang-php';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';

import { shell } from '@codemirror/legacy-modes/mode/shell';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { haskell } from '@codemirror/legacy-modes/mode/haskell';
import { r } from '@codemirror/legacy-modes/mode/r';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { julia } from '@codemirror/legacy-modes/mode/julia';
import { clojure } from '@codemirror/legacy-modes/mode/clojure';
import { erlang } from '@codemirror/legacy-modes/mode/erlang';
import { groovy } from '@codemirror/legacy-modes/mode/groovy';
import { pascal } from '@codemirror/legacy-modes/mode/pascal';
import { fortran } from '@codemirror/legacy-modes/mode/fortran';
import { cobol } from '@codemirror/legacy-modes/mode/cobol';
import { scheme } from '@codemirror/legacy-modes/mode/scheme';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { d } from '@codemirror/legacy-modes/mode/d';
import { crystal } from '@codemirror/legacy-modes/mode/crystal';
import { csharp, kotlin, scala, dart, objectiveC } from '@codemirror/legacy-modes/mode/clike';
import { oCaml, fSharp } from '@codemirror/legacy-modes/mode/mllike';

export interface LanguageDef {
  id: string;
  name: string;
  defaultExt: string;
  extensions: string[];
  starter: string;
  cm: () => Extension;
}

export const LANGUAGES: LanguageDef[] = [
  {
    id: 'typescript',
    name: 'TypeScript',
    defaultExt: '.ts',
    extensions: ['.ts', '.mts', '.cts', '.tsx'],
    starter: `// VeloIde scratch — press F5 to run\nconst greet = (name: string): string => \`Hello from \${name}!\`;\nconsole.log(greet("VeloIde"));\n`,
    cm: () => javascript({ typescript: true, jsx: true }),
  },
  {
    id: 'javascript',
    name: 'JavaScript',
    defaultExt: '.js',
    extensions: ['.js', '.mjs', '.cjs', '.jsx'],
    starter: `// VeloIde scratch — press F5 to run\nconsole.log("Hello from JavaScript in VeloIde!");\n`,
    cm: () => javascript({ jsx: true }),
  },
  {
    id: 'python',
    name: 'Python',
    defaultExt: '.py',
    extensions: ['.py', '.pyw'],
    starter: `# VeloIde scratch — press F5 to run\ndef main() -> None:\n    print("Hello from Python in VeloIde!")\n\nif __name__ == "__main__":\n    main()\n`,
    cm: () => python(),
  },
  {
    id: 'c',
    name: 'C',
    defaultExt: '.c',
    extensions: ['.c', '.h'],
    starter: `#include <stdio.h>\n\nint main(void) {\n    printf("Hello from C in VeloIde!\\n");\n    return 0;\n}\n`,
    cm: () => cpp(),
  },
  {
    id: 'cpp',
    name: 'C++',
    defaultExt: '.cpp',
    extensions: ['.cpp', '.cc', '.cxx', '.hpp'],
    starter: `#include <iostream>\n\nint main() {\n    std::cout << "Hello from C++ in VeloIde!" << std::endl;\n    return 0;\n}\n`,
    cm: () => cpp(),
  },
  {
    id: 'rust',
    name: 'Rust',
    defaultExt: '.rs',
    extensions: ['.rs'],
    starter: `fn main() {\n    println!("Hello from Rust in VeloIde!");\n}\n`,
    cm: () => rust(),
  },
  {
    id: 'go',
    name: 'Go',
    defaultExt: '.go',
    extensions: ['.go'],
    starter: `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello from Go in VeloIde!")\n}\n`,
    cm: () => go(),
  },
  {
    id: 'zig',
    name: 'Zig',
    defaultExt: '.zig',
    extensions: ['.zig'],
    starter: `const std = @import("std");\n\npub fn main() void {\n    std.debug.print("Hello from Zig in VeloIde!\\n", .{});\n}\n`,
    cm: () => rust(),
  },
  {
    id: 'java',
    name: 'Java',
    defaultExt: '.java',
    extensions: ['.java'],
    starter: `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello from Java in VeloIde!");\n    }\n}\n`,
    cm: () => java(),
  },
  {
    id: 'kotlin',
    name: 'Kotlin',
    defaultExt: '.kt',
    extensions: ['.kt', '.kts'],
    starter: `fun main() {\n    println("Hello from Kotlin in VeloIde!")\n}\n`,
    cm: () => StreamLanguage.define(kotlin),
  },
  {
    id: 'csharp',
    name: 'C#',
    defaultExt: '.cs',
    extensions: ['.cs'],
    starter: `Console.WriteLine("Hello from C# in VeloIde!");\n`,
    cm: () => StreamLanguage.define(csharp),
  },
  {
    id: 'fsharp',
    name: 'F#',
    defaultExt: '.fsx',
    extensions: ['.fs', '.fsx'],
    starter: `printfn "Hello from F# in VeloIde!"\n`,
    cm: () => StreamLanguage.define(fSharp),
  },
  {
    id: 'scala',
    name: 'Scala',
    defaultExt: '.scala',
    extensions: ['.scala', '.sc'],
    starter: `@main def hello(): Unit =\n  println("Hello from Scala in VeloIde!")\n`,
    cm: () => StreamLanguage.define(scala),
  },
  {
    id: 'groovy',
    name: 'Groovy',
    defaultExt: '.groovy',
    extensions: ['.groovy'],
    starter: `println "Hello from Groovy in VeloIde!"\n`,
    cm: () => StreamLanguage.define(groovy),
  },
  {
    id: 'clojure',
    name: 'Clojure',
    defaultExt: '.clj',
    extensions: ['.clj', '.cljs', '.bb'],
    starter: `(println "Hello from Clojure in VeloIde!")\n`,
    cm: () => StreamLanguage.define(clojure),
  },
  {
    id: 'dart',
    name: 'Dart',
    defaultExt: '.dart',
    extensions: ['.dart'],
    starter: `void main() {\n  print('Hello from Dart in VeloIde!');\n}\n`,
    cm: () => StreamLanguage.define(dart),
  },
  {
    id: 'php',
    name: 'PHP',
    defaultExt: '.php',
    extensions: ['.php'],
    starter: `<?php\necho "Hello from PHP in VeloIde!\\n";\n`,
    cm: () => php(),
  },
  {
    id: 'ruby',
    name: 'Ruby',
    defaultExt: '.rb',
    extensions: ['.rb'],
    starter: `puts "Hello from Ruby in VeloIde!"\n`,
    cm: () => StreamLanguage.define(ruby),
  },
  {
    id: 'lua',
    name: 'Lua / Luau',
    defaultExt: '.lua',
    extensions: ['.lua', '.luau'],
    starter: `print("Hello from Lua in VeloIde!")\n`,
    cm: () => StreamLanguage.define(lua),
  },
  {
    id: 'perl',
    name: 'Perl',
    defaultExt: '.pl',
    extensions: ['.pl', '.pm'],
    starter: `use strict;\nuse warnings;\nprint "Hello from Perl in VeloIde!\\n";\n`,
    cm: () => StreamLanguage.define(perl),
  },
  {
    id: 'shell',
    name: 'Shell / Bash',
    defaultExt: '.sh',
    extensions: ['.sh', '.bash', '.zsh'],
    starter: `#!/usr/bin/env bash\necho "Hello from Shell in VeloIde!"\n`,
    cm: () => StreamLanguage.define(shell),
  },
  {
    id: 'powershell',
    name: 'PowerShell',
    defaultExt: '.ps1',
    extensions: ['.ps1'],
    starter: `Write-Output "Hello from PowerShell in VeloIde!"\n`,
    cm: () => StreamLanguage.define(powerShell),
  },
  {
    id: 'sql',
    name: 'SQL (SQLite)',
    defaultExt: '.sql',
    extensions: ['.sql'],
    starter: `CREATE TABLE tools (name TEXT, speed TEXT);\nINSERT INTO tools VALUES ('VeloIde', 'fast'), ('VeloWrite', 'calm');\nSELECT * FROM tools;\n`,
    cm: () => sql(),
  },
  {
    id: 'wasm',
    name: 'WebAssembly / WAT',
    defaultExt: '.wat',
    extensions: ['.wat', '.wasm'],
    starter: `(module\n  (func (export "_start")\n  )\n)\n`,
    cm: () => StreamLanguage.define(scheme),
  },
  {
    id: 'julia',
    name: 'Julia',
    defaultExt: '.jl',
    extensions: ['.jl'],
    starter: `println("Hello from Julia in VeloIde!")\n`,
    cm: () => StreamLanguage.define(julia),
  },
  {
    id: 'nim',
    name: 'Nim',
    defaultExt: '.nim',
    extensions: ['.nim'],
    starter: `echo "Hello from Nim in VeloIde!"\n`,
    cm: () => python(),
  },
  {
    id: 'v',
    name: 'V',
    defaultExt: '.v',
    extensions: ['.v'],
    starter: `fn main() {\n\tprintln('Hello from V in VeloIde!')\n}\n`,
    cm: () => go(),
  },
  {
    id: 'odin',
    name: 'Odin',
    defaultExt: '.odin',
    extensions: ['.odin'],
    starter: `package main\n\nimport "core:fmt"\n\nmain :: proc() {\n\tfmt.println("Hello from Odin in VeloIde!")\n}\n`,
    cm: () => go(),
  },
  {
    id: 'd',
    name: 'D',
    defaultExt: '.d',
    extensions: ['.d'],
    starter: `import std.stdio;\n\nvoid main() {\n    writeln("Hello from D in VeloIde!");\n}\n`,
    cm: () => StreamLanguage.define(d),
  },
  {
    id: 'crystal',
    name: 'Crystal',
    defaultExt: '.cr',
    extensions: ['.cr'],
    starter: `puts "Hello from Crystal in VeloIde!"\n`,
    cm: () => StreamLanguage.define(crystal),
  },
  {
    id: 'gleam',
    name: 'Gleam',
    defaultExt: '.gleam',
    extensions: ['.gleam'],
    starter: `import gleam/io\n\npub fn main() {\n  io.println("Hello from Gleam in VeloIde!")\n}\n`,
    cm: () => rust(),
  },
  {
    id: 'elixir',
    name: 'Elixir',
    defaultExt: '.exs',
    extensions: ['.ex', '.exs'],
    starter: `IO.puts("Hello from Elixir in VeloIde!")\n`,
    cm: () => StreamLanguage.define(ruby),
  },
  {
    id: 'swift',
    name: 'Swift',
    defaultExt: '.swift',
    extensions: ['.swift'],
    starter: `print("Hello from Swift in VeloIde!")\n`,
    cm: () => StreamLanguage.define(swift),
  },
  {
    id: 'haskell',
    name: 'Haskell',
    defaultExt: '.hs',
    extensions: ['.hs'],
    starter: `main :: IO ()\nmain = putStrLn "Hello from Haskell in VeloIde!"\n`,
    cm: () => StreamLanguage.define(haskell),
  },
  {
    id: 'r',
    name: 'R',
    defaultExt: '.R',
    extensions: ['.r', '.R'],
    starter: `cat("Hello from R in VeloIde!\\n")\n`,
    cm: () => StreamLanguage.define(r),
  },
  {
    id: 'ocaml',
    name: 'OCaml',
    defaultExt: '.ml',
    extensions: ['.ml'],
    starter: `print_endline "Hello from OCaml in VeloIde!";;\n`,
    cm: () => StreamLanguage.define(oCaml),
  },
  {
    id: 'fortran',
    name: 'Fortran',
    defaultExt: '.f90',
    extensions: ['.f90', '.f95', '.f03', '.f'],
    starter: `program hello\n  print *, "Hello from Fortran in VeloIde!"\nend program hello\n`,
    cm: () => StreamLanguage.define(fortran),
  },
  {
    id: 'pascal',
    name: 'Pascal',
    defaultExt: '.pas',
    extensions: ['.pas', '.pp'],
    starter: `program Hello;\nbegin\n  WriteLn('Hello from Pascal in VeloIde!');\nend.\n`,
    cm: () => StreamLanguage.define(pascal),
  },
  {
    id: 'cobol',
    name: 'COBOL',
    defaultExt: '.cob',
    extensions: ['.cob', '.cbl'],
    starter: `       IDENTIFICATION DIVISION.\n       PROGRAM-ID. HELLO.\n       PROCEDURE DIVISION.\n           DISPLAY "Hello from COBOL in VeloIde!".\n           STOP RUN.\n`,
    cm: () => StreamLanguage.define(cobol),
  },
  {
    id: 'erlang',
    name: 'Erlang',
    defaultExt: '.escript',
    extensions: ['.erl', '.escript'],
    starter: `#!/usr/bin/env escript\nmain(_) -> io:format("Hello from Erlang in VeloIde!~n").\n`,
    cm: () => StreamLanguage.define(erlang),
  },
  {
    id: 'racket',
    name: 'Racket / Scheme',
    defaultExt: '.rkt',
    extensions: ['.rkt', '.scm'],
    starter: `#lang racket\n(displayln "Hello from Racket in VeloIde!")\n`,
    cm: () => StreamLanguage.define(scheme),
  },
  {
    id: 'asm',
    name: 'Assembly',
    defaultExt: '.s',
    extensions: ['.s', '.S'],
    starter: `.global main\nmain:\n  mov $0, %eax\n  ret\n`,
    cm: () => StreamLanguage.define(objectiveC),
  },
  {
    id: 'awk',
    name: 'AWK',
    defaultExt: '.awk',
    extensions: ['.awk'],
    starter: `BEGIN { print "Hello from AWK in VeloIde!" }\n`,
    cm: () => StreamLanguage.define(shell),
  },
  {
    id: 'html',
    name: 'HTML',
    defaultExt: '.html',
    extensions: ['.html', '.htm', '.svg'],
    starter: `<!doctype html>\n<html>\n  <body style="font-family: system-ui; padding: 24px;">\n    <h1>Hello from VeloIde</h1>\n    <p>Press F5 to preview HTML directly.</p>\n  </body>\n</html>\n`,
    cm: () => html(),
  },
  {
    id: 'css',
    name: 'CSS',
    defaultExt: '.css',
    extensions: ['.css', '.scss'],
    starter: `:root {\n  --accent: #e89a2c;\n}\n`,
    cm: () => css(),
  },
  {
    id: 'markdown',
    name: 'Markdown',
    defaultExt: '.md',
    extensions: ['.md', '.markdown'],
    starter: `# Scratch Note\n\nPress **F5** to render Markdown preview.\n`,
    cm: () => markdown(),
  },
  {
    id: 'json',
    name: 'JSON',
    defaultExt: '.json',
    extensions: ['.json'],
    starter: `{\n  "tool": "VeloIde",\n  "mode": "ziptie"\n}\n`,
    cm: () => json(),
  },
  {
    id: 'yaml',
    name: 'YAML',
    defaultExt: '.yaml',
    extensions: ['.yml', '.yaml'],
    starter: `name: VeloIde\nfree: true\n`,
    cm: () => yaml(),
  },
  {
    id: 'toml',
    name: 'TOML',
    defaultExt: '.toml',
    extensions: ['.toml'],
    starter: `[veloide]\nmode = "ziptie"\n`,
    cm: () => StreamLanguage.define(toml),
  },
  {
    id: 'xml',
    name: 'XML',
    defaultExt: '.xml',
    extensions: ['.xml'],
    starter: `<veloide mode="ziptie" />\n`,
    cm: () => xml(),
  },
  {
    id: 'plaintext',
    name: 'Plain Text',
    defaultExt: '.txt',
    extensions: ['.txt', '.log', '.env'],
    starter: '',
    cm: () => [],
  },
];

const BY_ID = new Map<string, LanguageDef>(LANGUAGES.map((l) => [l.id, l]));
const BY_EXT = new Map<string, LanguageDef>();
for (const lang of LANGUAGES) {
  for (const ext of lang.extensions) {
    BY_EXT.set(ext.toLowerCase(), lang);
  }
}

export function getLanguageById(id: string): LanguageDef {
  return BY_ID.get(id) ?? BY_ID.get('plaintext')!;
}

export function detectLanguageFromFilename(filename: string, content = ''): LanguageDef {
  const dot = filename.lastIndexOf('.');
  if (dot !== -1) {
    const ext = filename.slice(dot).toLowerCase();
    const match = BY_EXT.get(ext);
    if (match) return match;
  }

  if (content.startsWith('#!')) {
    const first = content.split(/\r?\n/, 1)[0].toLowerCase();
    if (first.includes('python')) return getLanguageById('python');
    if (first.includes('node') || first.includes('bun')) return getLanguageById('javascript');
    if (first.includes('ruby')) return getLanguageById('ruby');
    if (first.includes('perl')) return getLanguageById('perl');
    if (first.includes('bash') || first.includes('/sh')) return getLanguageById('shell');
  }

  return getLanguageById('plaintext');
}
