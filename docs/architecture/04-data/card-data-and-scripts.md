# Card Data, Strings, and Scripts

> Status: accepted

## Build-time sources

- Current standard-format Project Ignis BabelCDB catalog, including release and non-Rush prerelease additions.
- Current compatible official/prerelease Project Ignis CardScripts.
- Required global/procedure scripts such as `constant.lua` and `utility.lua`.
- Project Ignis system strings and card text/options.

Rush Duel, Skill, Goat-only, and unofficial anime/manga catalogs are separate formats and excluded.

## Browser artifacts

Generate deterministic shards for normalized engine card data, localized names/descriptions/options, searchable diagnostics, scripts, globals, and strings. Full snapshot coverage is packaged, while only active-duel shards/scripts are expanded into Worker memory.

## Runtime dependency resolution

Before creating a duel:

1. Strictly parse and validate both bundled decks against the active catalog.
2. Resolve aliases and all active card/script/global dependencies.
3. Load normalized card records and scripts into synchronous maps.
4. Fail with exact card code/script name when anything is absent.

Do not add a browser SQLite runtime unless direct `.cdb` compatibility becomes necessary.
