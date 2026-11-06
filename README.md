# Octomilka

Lokální AI doplňování kódu pro VS Code. Zdarma, offline, bez účtu.

## Instalace

1. Stáhni `octomilka-x.y.z.vsix` z [Releases](https://github.com/LukasVitek67/octomilka/releases/latest).
2. Ve VS Code otevři Extensions (Ctrl+Shift+X), klikni na `…` vpravo nahoře → **Install from VSIX…**
   nebo v terminálu: `code --install-extension octomilka-0.6.0.vsix`
3. Vpravo dole vyskočí nabídka stažení. Engine a modely se stáhnou jednorázově podle RAM.

## Aktualizace

Automaticky z GitHub Releases (max. 2× denně, SHA256 ověřeno).

- `octomilka.autoUpdate`: `auto` (výchozí) · `notify` · `off`
- Ručně: menu Octomilka → **Zkontrolovat aktualizace**

Nové vydání: zvýšit `version` v `package.json`, `npm run package`, release s tagem `vX.Y.Z` + `.vsix`.

## Modely

| RAM | Tab | Funkce | Stažení |
|---|---|---|---|
| 8 GB | Qwen2.5-Coder 0.5B | Qwen2.5-Coder 3B | ~2,5 GB |
| 16 GB | Qwen2.5-Coder 1.5B | Qwen2.5-Coder 7B | ~6,3 GB |
| 32 GB+ | Qwen2.5-Coder 1.5B | Qwen3-Coder 30B-A3B | ~20 GB |

Profil: klik na stavovou lištu → **Velikost modelů**. GPU se použije automaticky, jinak CPU.

## Vývoj

Open source (MIT).

```bash
npm install
npm test          # jednotkové testy
npm run watch     # průběžný build
npm run package   # vytvoří .vsix
```

F5 ve VS Code spustí nové okno s extension.

**Pro AI agenty:** kontext projektu je v [AGENTS.md](AGENTS.md).

## Licence

Kód: MIT. Qwen2.5-Coder 0.5B/1.5B/7B a Qwen3-Coder: Apache 2.0.
Qwen2.5-Coder 3B: Qwen Research License (nekomerční — škola ok). llama.cpp: MIT.
