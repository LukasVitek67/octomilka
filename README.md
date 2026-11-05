# Octomilka – lokální AI doplňování kódu

Doplňování kódu ve stylu Copilota pro VS Code, které **běží celé na tvém počítači**.
Zdarma, bez účtu, bez cloudu. Po prvním stažení funguje i úplně offline.

- **Tab návrhy:** při psaní se objeví šedý text, Tab ho přijme.
- **Celá funkce z názvu:** napiš hlavičku, třeba `function isPrime(n) {`, a AI navrhne celé tělo.
- **Ctrl+Alt+Enter:** dopíše funkci (nebo kód podle komentáře nad kurzorem) rovnou do souboru a uvidíš, jak píše.
- **Zadání komentářem:** napiš třeba `// make a function that uses .map()` (klidně česky), dej Enter a AI navrhne kód podle zadání.
- **Jiné řešení (Alt+Shift+Enter):** AI vymyslí jiný přístup ke stejné funkci nebo zadání a vloží ho do kódu.
  AI si řešení pamatuje (lokálně, pro každý projekt zvlášť), takže je neopakuje. Šedé návrhy jde přepínat i přes Alt+] / Alt+[.
- **Správný jazyk:** model dostane název souboru a jazyk, takže v `.ts` píše TypeScript, v `.py` Python a tak dál.

### Panel Octomilka (dole vedle Terminálu)

Otevře se kliknutím na Octomilku ve stavové liště, nebo sám při prvním spuštění.

- **Živý stav:** pořád vidíš, co AI dělá. Třeba „Přemýšlí: Píše celou funkci · isPrime · 12 s · 85 tokenů“ s tlačítkem Zastavit.
  Nebo „Připraveno“, „Stahuju AI… 42 %“. Je tam i jestli rychlá a chytrá AI běží na grafice nebo procesoru.
- **Řešení seřazená od nejlepšího:** klikneš do funkce a panel ukáže všechna řešení, která pro ni AI vymyslela.
  Řadí se podle **jistoty AI** (průměrná pravděpodobnost každého kousku kódu podle modelu). ⭐ = nejvyšší jistota.
  Jistota není záruka správnosti, je to jen to, jak moc si byl model jistý.
- **Filtr:** napiš slovo a dej „Musí obsahovat“ (Enter) nebo „Nesmí obsahovat“. Filtr schová řešení, která neodpovídají.
  A když klikneš na „Vymyslet řešení podle filtru“, AI ho dodrží (třeba musí `map`, nesmí `for`).
- **Náhled a přepínání:** klik na řešení = ukázat kód, „Použít tohle řešení“ (nebo dvojklik) = vložit do kódu.
- **Zkratky** jsou vypsané přímo v panelu. Kdo neví, co dělat, uvidí krok za krokem „Jak na to“.

## Instalace (pro spolužáky)

1. Stáhni `octomilka-x.y.z.vsix` z [Releases](https://github.com/LukasVitek67/octomilka/releases/latest).
2. Ve VS Code otevři Extensions (Ctrl+Shift+X), klikni na `…` vpravo nahoře a vyber **Install from VSIX…**.
   Nebo v terminálu: `code --install-extension octomilka-0.4.0.vsix`
3. Vpravo dole vyskočí „Stáhnout“. Jednorázově se stáhne engine a modely podle toho, kolik máš RAM.
4. Hotovo. Ve stavové liště vpravo dole uvidíš ✨ Octomilka.

## Aktualizace

Od verze 0.3.0 se Octomilka aktualizuje sama z [GitHub Releases](https://github.com/LukasVitek67/octomilka/releases).
Max. 2× denně se podívá, jestli je nová verze. Když ano, stáhne `.vsix`, ověří jeho otisk SHA256 a nainstaluje ho.
Pak nabídne znovu načíst okno. Modely zůstávají, nic dalšího se nestahuje.

- Nastavení `octomilka.autoUpdate`: `auto` (výchozí), `notify` (jen upozorní) nebo `off`.
- Ručně: menu Octomilka → **Zkontrolovat aktualizace**.
- Fork se aktualizuje ze svého repa podle pole `repository` v `package.json`.
- Kdo má 0.1 nebo 0.2, musí 0.3.0 nainstalovat jednou ručně. Pak už se aktualizuje sám.

Nové vydání: zvýšit `version` v `package.json`, `npm run package` a vytvořit release s tagem `vX.Y.Z` a přiloženým `.vsix`.

## Jaké modely se stáhnou

| RAM | Tab (rychlý) | Celá funkce (chytrý) | Stažení |
|---|---|---|---|
| 8 GB | Qwen2.5-Coder 0.5B | Qwen2.5-Coder 3B | ~2,5 GB |
| 16 GB | Qwen2.5-Coder 1.5B | Qwen2.5-Coder 7B | ~6,3 GB |
| 32 GB+ | Qwen2.5-Coder 1.5B | Qwen3-Coder 30B-A3B | ~20 GB |

Profil se dá změnit kliknutím na Octomilka ve stavové liště, položka **Velikost modelů**.
Grafiku (AMD/Intel/NVIDIA přes Vulkan, Apple přes Metal) použije automaticky. Když nejde, přepne se na CPU.

Velký model se po 15 minutách nečinnosti sám uvolní z RAM (nastavení `octomilka.idleMinutes`).

## Jak to funguje

```
VS Code ── Octomilka (tahle extension) ──> llama-server na 127.0.0.1 ──> model .gguf na disku
```

- Engine: [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server`), stažený z oficiálních GitHub releases.
- Modely: GGUF z Hugging Face. Ukládají se do složky extension (`globalStorage/lukas-vitek.octomilka`).
- Server poslouchá jen na `127.0.0.1` (nikdo zvenku se k němu nepřipojí). Kód nikam neodchází.
  Síť se použije jen jednou při stažení enginu a modelů.

## Úpravy a vývoj

Je to open source (MIT). Každý to může upravovat, šířit a používat, i komerčně.

```bash
npm install
npm test          # testy detekce funkcí a úpravy výstupu
npm run watch     # průběžný build
npm run package   # vytvoří .vsix
```

Test se skutečnými modely (po prvním stažení, Windows): `npx tsc -p tsconfig.test.json && node out-test/test/e2e.js`

Na tomhle PC (Ryzen 5 8640HS, 16 GB, iGPU Radeon 760M) trvá Tab návrh ~0,9 s (GPU) a celá krátká funkce ~5–12 s (7B na CPU).
Každý server zkusí GPU, a když se model do video paměti nevejde, sám spadne na CPU.

Ve VS Code otevři složku a stiskni F5. Spustí se nové okno s extension.

| Soubor | Co dělá |
|---|---|
| `src/extension.ts` | VS Code: Tab návrhy, příkaz Ctrl+Alt+Enter, stavová lišta, menu, instalace |
| `src/engine.ts` | stahování, spouštění `llama-server`, volání AI, prompty, seznam modelů a profilů |
| `src/stub.ts` | pozná prázdnou funkci / komentář se zadáním u kurzoru a vyčistí výstup modelu (bez vscode, testovatelné) |
| `src/spots.ts` | místa v kódu (funkce, zadání) a lokální paměť všech navržených řešení |
| `src/view.ts`, `src/viewHtml.ts` | spodní panel: živý stav, zkratky, řešení podle jistoty, filtr |
| `src/activity.ts` | co AI právě dělá (pro živý stav a tlačítko Zastavit) |
| `src/updater.ts` | automatické aktualizace z GitHub Releases (ověření SHA256) |

Další model přidáš do `M` a `PROFILES` v `src/engine.ts`.

## Licence

Kód je pod MIT. Licence modelů: Qwen2.5-Coder 0.5B, 1.5B a 7B a Qwen3-Coder jsou pod Apache 2.0.
Qwen2.5-Coder 3B je pod Qwen Research License, tedy jen pro nekomerční použití (škola je v pohodě).
llama.cpp je pod MIT.
