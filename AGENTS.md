# AGENTS.md: full context for AI coding agents

This file lets any AI agent continue developing **Octomilka** without asking the owner for background.
Read it fully before changing code. Keep it up to date: when you change architecture, a decision, the release
flow or a known issue, update the matching section in the same commit.

> Language: code comments, UI strings, README, commit bodies for users and release notes are **Czech**.
> This file is in English so that any model can read it. Talk to the owner in Czech.

---

## 1. What this is

Octomilka is a **VS Code extension that works like GitHub Copilot, but everything runs locally**: free, offline after
the first download, no account, no cloud AI. It is open source (MIT) and meant to be shared with the owner's classmates
(a Czech secondary school whose AI budget ran out). Users install a small `.vsix`. On first run it downloads the
inference engine and models that fit the PC's RAM.

**Owner:** Lukáš Vítek (GitHub `LukasVitek67`), a student and web designer. He wants it **"dumb-user friendly"**: anyone
must be able to use it. He dislikes generic "AI-slop" UI.

**Name:** "octomilka" is Czech for fruit fly. The project began as an idea to build an LLM from the fruit-fly
connectome with a router of "sorting flies" (mixture of experts). That was explained as infeasible (~50M synapses, a
sensorimotor circuit, not a general learner). The practical result is this: a router-free pair of small local code
models. The name stayed.

**Repo:** https://github.com/LukasVitek67/octomilka. Releases (with `.vsix`) are at `/releases`.

## 2. Hard rules (do not violate)

1. **Everything stays local.** No cloud AI calls, no telemetry. The only allowed network traffic: downloading the
   llama.cpp engine (GitHub releases), models (Hugging Face) and the extension update check/download (GitHub API +
   release asset). Never send user code anywhere.
2. **Ask the owner before outward-facing actions:** git push, GitHub releases, publishing. He approves each release
   explicitly ("Ano, vydat"). Local builds, tests and installing the `.vsix` into his own VS Code are fine without asking.
3. **Licence hygiene:** the code is MIT. Model licences: Qwen2.5-Coder 0.5B/1.5B/7B and Qwen3-Coder are Apache-2.0.
   **Qwen2.5-Coder 3B is under the Qwen Research licence (non-commercial)**, which is acceptable for school use and is
   noted in the README. Keep this note if you change models.
4. **UI text is Czech, simple and friendly.** Buttons say exactly what they do ("Použít tohle řešení", "Doplň teď!").
   Explain jargon or avoid it.

## 3. Architecture

```
VS Code ─ extension (dist/extension.js, bundled with esbuild)
   │
   ├─ Completer (InlineCompletionItemProvider) ──► "tab" llama-server  (FIM, small base model)      /infill
   ├─ generate / alternative / suggestNow     ──► "funkce" llama-server (instruct model, chat)      /v1/chat/completions
   ├─ SpotStore (workspaceState)  ← memory of all solutions per spot (function / comment instruction)
   ├─ OctoView (WebviewView in bottom panel) ← live status, shortcuts, ranked solutions, finder
   ├─ Activity  ← what the AI is doing right now (jobs, seconds, tokens, stop)
   └─ Updater   ← GitHub Releases auto-update (SHA256 verified)

llama-server processes listen ONLY on 127.0.0.1 (random free port), spawned with windowsHide.
Engine + models live in context.globalStorageUri (Windows: %APPDATA%\Code\User\globalStorage\lukas-vitek.octomilka).
```

### Files

| File | Role |
|---|---|
| `src/extension.ts` | Wiring. `Controller` (setup/download/start servers, status bar, GPU→CPU fallback, idle unload), `generateFor()` (shared big-model generation incl. confidence), `Completer` (inline suggestions, `force()` for "Doplň teď!", `bigFree()` fallback, `smart()` for stub/instruction), `workspaceContext()` (async file index with 30 s TTL — workspace files of same extension for FIM context), `syntaxPlausible()` (CSS/JS cross-language guard), `generateCommand` (Ctrl+Alt+Enter streams into the document), `Solutions` (alternatives, two-step ideas→code, apply), `Updater`, `activate()` (commands, menu, first-run panel reveal). |
| `src/engine.ts` | No vscode import. `LLAMA_TAG` (pinned llama.cpp build), model list `M` + `PROFILES` (small/medium/large by RAM), `engineAsset()` per OS/arch, `download()` (resume, `.part`), `extract()` (Windows uses **System32\tar.exe**, not Git's tar), `LlamaServer` (spawn, health wait, `-ngl auto`→CPU retry, `phase`, `device`), `infill()`, `chatStream()` (SSE + optional logprobs callback), prompts: `buildMessages()`, `buildIdeasMessages()`, `parseIdeas()`, `langName()`. |
| `src/stub.ts` | No vscode import, unit-tested. Detects an **empty function at the cursor** (`detectStub`: `{|}`, `{|\n}`, empty line in body, Python `def …:`), **comment instructions** (`detectInstruction`, comment syntax per language via `commentText`/`lineComment`), function ranges (`matchBrace`, `functionAt`, `enclosingFunction`), and `BodyStreamer`, which cleans streamed model output: strips ``` fences, the `APPROACH:` title line, an echoed signature/comment, a repeated line prefix and the closing brace (by brace balance), stops on dedent and re-bases indentation. |
| `src/spots.ts` | A "spot" = a place in code with solutions: `fn` (key = uri + normalized signature) or `instr` (key = uri + last comment line). `SpotStore` persists in `workspaceState` key `octomilka.spots.v1` (max 300 spots × 12 variants). `rankVariants()` sorts by confidence (user code last), `markBest()` sets ⭐ = highest confidence, `matchesFilter()` is the must/must-not finder. `resolveAt()` finds the spot at the cursor, `locate()` finds it again later by anchor text. `Located.replacement()` produces text for the replaced range. |
| `src/view.ts` | Bottom panel `OctoView` (`octomilka.view` in container `octomilka`, contributed under `viewsContainers.panel`). Follows the cursor (debounced) to show the spot's solutions. Holds per-spot filters/ideas/selection in memory. Posts `state` on changes and `status` once a second while visible. |
| `src/viewHtml.ts` | No vscode import. The panel's HTML/CSS/JS. Uses VS Code theme CSS variables only and a strict CSP (nonce, no external resources). Three columns (solutions+finder / preview / shortcuts) that collapse at ≤980px and ≤600px. |
| `src/activity.ts` | `Activity` job tracker (`start/tick/end/stopAll`). Tab jobs are not stoppable from the UI. |
| `src/updater.ts` | No vscode import. `latestRelease()` (only `https://github.com/<repo>/releases/download/` URLs), `downloadRelease()` (size + SHA256 from the GitHub `asset.digest`), `compareVersions()`, `repoFrom()` (forks update from their own `package.json.repository`). |
| `test/stub.test.ts` | Unit tests (`npm test`). |
| `test/updater.test.ts` | Unit tests. `node out-test/test/updater.test.js live` also hits the real GitHub API. |
| `test/e2e.ts` | **Manual** end-to-end test with real models (see §6). |
| `tools/preview/` | Browser preview of the panel with mock data (see §6). Not shipped in the `.vsix`. |
| `media/octomilka.svg` | Panel container icon (monochrome, `currentColor`). |

### Commands, keys, settings

- Commands: `octomilka.suggestNow` ("Doplň teď!"), `generate`, `alternative`, `solutions`, `showPanel`, `stop`,
  `profile`, `toggle`, `setup`, `menu`, `log`, `checkUpdates`.
- Keys: **Alt+Enter** = suggestNow (when not in Find widget, suggest widget or a notebook), **Ctrl+Alt+Enter** =
  generate (mac Cmd+Alt+Enter), **Alt+Shift+Enter** = alternative. VS Code built-ins it relies on: Tab, Esc,
  Ctrl+→ (accept word), Alt+] / Alt+[ (cycle inline items).
  ⚠ **Avoid Ctrl+Alt+<letter> bindings**: on Czech keyboards Ctrl+Alt = AltGr, which types characters (`[ ] { } \ | @ # & € $ < >`).
- Settings: `octomilka.enabled` (true), `profile` (auto|small|medium|large), `gpu` (true), `autoFunction` (true),
  `debounceMs` (200), `idleMinutes` (15, big model unload), `autoUpdate` (auto|notify|off), `offline` (false).
  `offline=true` blocks all network traffic (missing engine/model → error). Set env `OCTOMILKA_OFFLINE` before launch
  to enforce it at process level (useful in air-gapped CIs).

## 4. How the AI features work (and why)

**Profiles** (`engine.ts` `PROFILES`, auto by `os.totalmem()`: ≥30 GB large, ≥12 GB medium, else small):

| profile | tab (FIM, base) | big (instruct) | download |
|---|---|---|---|
| small | Qwen2.5-Coder-0.5B Q8_0 | Qwen2.5-Coder-3B-Instruct Q4_K_M | ~2.5 GB |
| medium | Qwen2.5-Coder-1.5B Q8_0 | Qwen2.5-Coder-7B-Instruct Q4_K_M | ~6.3 GB |
| large | Qwen2.5-Coder-1.5B Q8_0 | Qwen3-Coder-30B-A3B-Instruct Q4_K_M | ~20 GB |

URLs are pinned Hugging Face `resolve/main` links with byte sizes. Engine = llama.cpp release `LLAMA_TAG` (`b12125`).
Windows x64 uses the **Vulkan** build. Its CPU backends are loaded dynamically, so it also runs without a GPU.

- **Tab suggestions:** `/infill` on the tab server with `input_prefix/suffix`, `input_extra` (snippets of other visible
  editors **plus workspace files of the same extension** via `workspaceContext()`), `n_indent`, `t_max_predict_ms`.
  The prefix starts with a **file header comment** (`// prime.ts (TypeScript)`). Without it, the tiny model guessed the
  wrong language (it suggested C# in a `.ts` file).
  `workspaceContext()`: caches `findFiles(**/*<ext>)` per workspace root + extension with a 30 s TTL and 500 ms race
  timeout. Prioritises files in the same directory. Max 6 chunks × 5 kB, skips files > 50 kB, skips already-open editors.
- **CSS accuracy guard:** `detectStub` mistook empty CSS selector bodies `selector {}` for empty function stubs and
  triggered the instruct (JS-focused) model, which returned JavaScript. Fix: `CSS_LANGS` set (`css/scss/less/stylus/sass`)
  — `smart()` is never called for these languages. Additionally `syntaxPlausible()` rejects tab suggestions whose text
  contains JS keywords (`function(`, `const `, `=>`, `import {`, etc.) when the file is CSS.
- **Whole function from a signature / code from a comment** (`Completer.smart`): when `detectStub` or
  `detectInstruction` matches, the big model writes the body via chat with a `<FILL_HERE>` marker. The result is stored
  as a variant and shown as multi-line ghost text. Stored variants are returned instantly next time (all of them, best
  first, cycle with Alt+]).
- **Prompt contract** (`buildMessages`): the model must write ONLY the target language and the code only, handle edge
  cases, prefer readable code over one-liners, and start with `APPROACH: <name>`. That line becomes the variant title
  and `BodyStreamer` strips it. The "edge cases / readable" rule was added because the 7B model wrote buggy clever
  one-liners (e.g. `isPrime(2)` wrong).
- **Alternatives** (Alt+Shift+Enter, `Solutions.more`): **two steps**: (1) `buildIdeasMessages` asks for 3 different
  correct approaches (names only), (2) the code is written for the first unused idea with `avoid` = all known variants.
  Single-step "be different" made the 7B model produce broken gimmicks (BigInt with `number` input, nested duplicate
  functions). Unused ideas show as buttons in the panel. Temperature: 0.1 for the first/best, 0.3 for alternatives.
- **Confidence ("jistota AI")** = `exp(mean token logprob)` of the code tokens (header excluded), taken from
  llama-server streaming `logprobs`. These come from the raw model distribution, because `post_sampling_probs`
  defaults to false. Ranking and ⭐ use it. Caveat: variants were generated under different prompts (an approach
  constraint), so it is a confidence signal, not proof of correctness. The UI says so in a tooltip.
- **Finder** (must / must-not contain): filters the panel list case-insensitively. It is also sent to the model as
  strict requirements for the next generated solution (`PromptOpts.must/mustNot`).
- **"Doplň teď!"** (Alt+Enter): `Completer.force()`, then `editor.action.inlineSuggest.trigger`. A forced request skips
  the debounce, the mid-line guard, the cache and the "enabled" setting. If the tab model returns nothing,
  `bigFree()` asks the big model in `free` mode with `linePrefix` so a repeated line start is cut
  (`const total = const total = …` bug).
- **Ctrl+Alt+Enter** streams the big model's output line by line directly into the document (works for stub,
  instruction or free mode).
- **Memory:** variants per spot live in `workspaceState`, so they survive restarts and are separate per project.
  Ideas and filters are in-memory only (per session).

### Hardware findings (from real tests on the owner's PC: Ryzen 5 8640HS, 16 GB RAM, Radeon 760M iGPU, Windows 11)

- The iGPU's Vulkan memory budget cannot hold the 7B model even alone (`ErrorOutOfDeviceMemory`, even with
  `-ngl auto`/fit). The 1.5B tab model fits.
- Therefore every `LlamaServer` tries `-ngl auto` first, then **`-ngl 0 --device none`**. **`--device none` is
  required**: with only `-ngl 0`, llama.cpp still allocates Vulkan compute buffers and fails when VRAM is taken.
- Typical timings there: tab suggestion ~0.9–2 s (GPU), whole function ~10–25 s, alternative ~20–50 s (7B on CPU).
- If the vulkan build cannot start at all, `Controller` falls back to downloading the CPU build (`forceCpu` in globalState).

## 5. Known issues and limits (be honest about these to the owner)

- **Alternatives from 7B are sometimes wrong** (roughly 1 in 3 e2e runs failed the alternative-correctness check). The
  best/first solution has been correct in every run. The panel warns users to review alternatives.
- **The bottom panel was never seen rendered inside real VS Code by an agent.** It was verified via the browser preview
  with mock data plus a clean extension activation in an isolated VS Code (no errors in logs). The owner declined screen
  access. If you can, verify visually.
- macOS and Linux paths (asset names, `LD_LIBRARY_PATH`, Metal) are implemented but **untested**.
- `rankVariants`/`matchesFilter` live in `spots.ts`, which imports `vscode`, so they have no unit tests. Moving them to a
  pure module would allow testing.
- `test/e2e.ts` hardcodes the Windows globalStorage path and the medium-profile model files.
- No `.gitattributes`: git warns about LF→CRLF on Windows. Harmless.
- The extension is not on the VS Code Marketplace (publisher `lukas-vitek` is only an id). Distribution = GitHub Releases.
- Not implemented / ideas: real repo-wide context (only visible editors are sent), chat panel, Marketplace/Open VSX
  publishing, re-scoring all variants under one neutral prompt for comparable confidence, a GPU offload split for big
  models on iGPUs.

## 6. Develop, test, preview

```bash
npm install
npm test                                  # tsc for tests + stub + updater unit tests
npx tsc --noEmit                          # typecheck the extension
npm run build                             # esbuild → dist/extension.js
npm run package                           # build + vsce → octomilka-<version>.vsix
code --install-extension octomilka-<version>.vsix --force
```

- **F5** in VS Code runs an Extension Development Host. The updater is disabled outside Production mode.
- **E2E with real models** (needs the engine + medium models already downloaded by the extension on Windows):
  `npx tsc -p tsconfig.test.json && node out-test/test/e2e.js`. It checks the language, function correctness, ideas,
  alternative difference/correctness, confidence range, finder requirements, comment instructions (EN + CZ, Python) and
  the "Doplň teď!" fallback. One run takes ~4–6 min on the owner's CPU. The alternative-correctness check can flake (§5).
- **Panel preview in a browser:** `node tools/preview/mkview.cjs` writes `tools/preview/out/view-{main,idle,setup,nospot}-{dark,light}.html`
  (the real `viewHtml()` + mocked theme variables + a mocked `acquireVsCodeApi`). Then run `node tools/preview/serve.cjs` and open
  `http://127.0.0.1:5178/view-main-dark.html`. Clicks log the posted messages to the console. Check a short height
  (~300 px) and narrow widths (≤980, ≤600).
- **Testing the real updater/install path:** install a build with a lower version into an isolated profile
  (`code --user-data-dir <tmp> --extensions-dir <tmp2> --install-extension …`), launch it with the same flags, and
  watch `<tmp2>` for the new version folder (done for 0.1.99 → 0.2.0, which worked). Kill those Code.exe processes afterwards.
- Logs: the "Octomilka" output channel (`octomilka.log`). Server stdout is logged during boot, then only errors.

## 7. Release flow (after the owner says yes)

1. Bump `version` in `package.json` (semver). Update the `octomilka-X.Y.Z.vsix` filename mention in `README.md`.
2. `npx tsc --noEmit && npm test && npm run package` (optionally run the e2e).
3. Commit (Conventional Commits, English subject ≤50 chars), `git push origin main`.
4. `gh release create vX.Y.Z octomilka-X.Y.Z.vsix --title "Octomilka X.Y.Z" --notes "<Czech notes>"`. **Not** a draft or
   prerelease: the updater ignores those and takes the first `*.vsix` asset.
5. `node out-test/test/updater.test.js live` to confirm the updater sees the release and the SHA256 matches.
6. Installs ≥0.3.0 auto-update within ~12 h (check at most every 12 h, setting `octomilka.autoUpdate`). Older installs
   need one manual `.vsix` install.

History: 0.1.0 base (Tab + whole function), 0.2.0 language fix + comment instructions + alternatives + memory,
0.3.0 auto-updater, 0.4.0 bottom panel + live status + confidence ranking + finder, 0.5.0 "Doplň teď!" (Alt+Enter), 0.6.0 offline mode, stealth, neutral file names.

## 8. Conventions

- TypeScript strict, CommonJS, target ES2022, bundled by esbuild (only `vscode` is external, **no runtime deps**).
  Node built-ins + global `fetch` only.
- Keep modules without `vscode` imports pure (`engine`, `stub`, `updater`, `viewHtml`) so they stay testable in Node.
- Webview: theme variables only, strict CSP with a nonce, escape all text (`esc()`), no external resources, respect
  `prefers-reduced-motion`.
- Czech user-facing strings. Short comments in Czech are fine. Explain *why*, not *what*.
- Don't break stored data: `workspaceState` key `octomilka.spots.v1`. If the format changes, bump the key or migrate.
