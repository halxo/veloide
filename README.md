# VeloIde

> **Open it. Fix it. Run it. Close it.**

An ultra-fast, completely free, local-first **"ziptie" IDE** built directly from [VeloWrite](https://github.com/halxo/velowrite). It opens straight to code, stays calm and out of your way, and gives you access to **45+ languages** with every compiler installed automatically on first use — plus optional local **Qwen2.5-Coder-1.5B** autocomplete and a dedicated **Portable** download for USB sticks.

---

## Download Either Mode

Grab the latest build from **[GitHub Releases](https://github.com/halxo/veloide/releases/latest)**:

| Mode | Platform | Download Asset | Notes |
| --- | --- | --- | --- |
| **Installer Mode** | Windows (x64) | `VeloIde-Setup-1.0.0.exe` | Start Menu & Desktop shortcuts, uninstaller, automatic background updates from GitHub |
| **Portable Mode** | Windows (x64) | `VeloIde-Portable-1.0.0-win-x64.zip` | Unzip to any folder or USB stick — stores all data, compilers & Qwen inside `./data/` |
| **Installer Mode** | Linux (x64) | `VeloIde-1.0.0-linux-x64.AppImage` / `.deb` | Native desktop install |
| **Portable Mode** | Linux (x64) | `VeloIde-Portable-1.0.0-linux-x64.tar.gz` | Self-contained folder/USB stick |
| **Installer Mode** | macOS (Apple Silicon) | `VeloIde-1.0.0-mac-arm64.dmg` | Drag to Applications |
| **Portable Mode** | macOS (Apple Silicon) | `VeloIde-Portable-1.0.0-mac-arm64.zip` | Self-contained folder/USB stick |

### Installer vs. Portable

- **Installer Mode**: stores settings, 3-snapshot recovery history, compilers, and optional Qwen weights in `~/.veloide/` and auto-updates quietly from `halxo/veloide` Releases.
- **Portable Mode**: ships with a `portable` marker next to the executable. Nothing is written to AppData, `~/.veloide`, the Windows Registry, or system `PATH`. Paths inside the folder are stored relatively (`$PORTABLE/...`), so it keeps working when your USB drive letter changes. Use `Ctrl+K` → **Portable: Prepare for Offline (Prefill Compilers)** to preload languages onto your USB stick before going offline.

---

## Core Design

### 1. Any Compiler, Installed Only When You Need It
- **Zero compilers bundled in the installer.**
- **System-first:** if `gcc`, `python3`, `go`, `rustc`, `node`, etc. are already on your `PATH`, VeloIde uses them immediately with zero download.
- **On-demand isolated installs:** press `F5` on a language whose compiler isn't installed and VeloIde shows a single calm line with the source, license, and size. Press `Enter` and it downloads, verifies SHA-256, extracts into VeloIde's isolated `toolchains/` folder (no admin rights, never touches system `PATH`), and runs your code.
- **Out-of-the-box managed compilers (~30 languages):** C, C++, Zig, Assembly (all via standalone `zig cc`/`zig c++` — zero MSVC/Xcode needed!), Python, JavaScript/TypeScript (Bun & Node), Deno, Go, Rust (isolated `RUSTUP_HOME`/`CARGO_HOME`), Java (Temurin JDK 21), Kotlin, Scala, Groovy, Clojure (Babashka), C# & F# (.NET 10 SDK, including single-file `.cs` execution!), Dart, PHP, Ruby, Lua/Luau, Perl, Shell/Bash/AWK (BusyBox on Windows), PowerShell 7, SQL (SQLite 3), WebAssembly/WAT (Wasmtime), Julia, Nim, V, Odin, D (LDC2), Crystal, Gleam, Elixir.
- **Built-in zero-download runners:** HTML/SVG live preview, Markdown preview, JSON/YAML/TOML/CSS validation.
- **Universal fallback:** Swift, Haskell, R, OCaml, Fortran, Pascal, COBOL, Ada, Prolog, Erlang, Racket, or any custom compiler via system detection, OS package manager hint, or a one-line custom command saved per extension (plus `.veloide/run` project overrides).

### 2. Local Qwen2.5-Coder-1.5B Autocomplete (Optional & Toggleable)
- Powered by **Qwen2.5-Coder-1.5B** (`Q4_K_M`, Apache-2.0, ~1.04 GB) running 100% locally via `llama.cpp` (`llama-server` on `127.0.0.1`).
- **Not bundled in the installer** — downloads on demand only if you choose to enable it, and can be disabled permanently or toggled anytime from the footer pill or `Ctrl+K`.
- Fill-in-the-Middle (FIM) ghost text: `Tab` accepts full suggestion, `Ctrl/Cmd+→` accepts one word, `Esc` dismisses.
- Loads lazily on first completion and **automatically unloads after 10 minutes idle** to keep memory flat.

### 3. Reused from VeloWrite — Only What You Need
- Exact VeloWrite Light, Dark, and Sepia themes, warm typography (`Inter` + `JetBrains Mono`), quiet auto-dimming topbar, `Ctrl+K` Command Palette, `Input < 1ms` live latency footer, guarded atomic saves, and **3-snapshot local recovery per file**.
- **Scratch buffers (`Ctrl+N`)**: pick any language, type, press `F5`, no file required.
- **Built-in Terminal (`Ctrl+\``)**: every installed VeloIde compiler is already on `PATH`.
- **Intentionally NOT included**: Debugger, Git UI, extensions marketplace, AI chat sidebar, minimap, welcome pages, project wizards, accounts, or telemetry.

---

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `F5` / `Ctrl+Enter` | Run current file, project, or scratch buffer |
| `Shift+F5` | Stop running process |
| `Ctrl+K` / `Ctrl+Shift+P` | Command Palette |
| `Ctrl+P` | Go to File in Folder |
| `Ctrl+N` | New Scratch Buffer |
| `Ctrl+O` / `Ctrl+Shift+O` | Open File / Open Folder |
| `Ctrl+S` | Guarded atomic save (rotates 3 local snapshots) |
| `Ctrl+\` | Toggle Sidebar (Files, Search, History) |
| `Ctrl+Shift+F` | Search across folder (ripgrep) |
| ``Ctrl+` `` | Toggle Output & Terminal drawer |
| `Tab` / `Ctrl+→` | Accept Qwen ghost text (full / word) |

---

## Development

```bash
npm install
npm run dev                 # Web preview
npm run build               # Typecheck + Vite production build
npm run verify:registry     # Validate registry/toolchains.json
npm test                    # Run end-to-end tests (portable mode, fs, runner, on-demand install)
npm run dist:win            # Build Windows NSIS installer
npm run dist:win:portable   # Build Windows Portable .zip
```

Push a version tag (`git tag v1.0.0 && git push origin v1.0.0`) to automatically build and publish both **Installer** and **Portable** assets for Windows, Linux, and macOS via GitHub Actions.
