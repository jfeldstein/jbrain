# Page / entity / relationship taxonomy checklist

Use this when adding or renaming a **page kind** (`PageType`), **entity directory row** (`ENTITY_TYPES`), or **inferred graph edge label** (`RELATIONSHIP`). Goal: one mechanical pass so nothing drifts.

## Automated gate

After edits, run:

```bash
bun test test/entity-taxonomy.test.ts
```

The suite calls `validateEntityTaxonomy()` from `src/core/entity-taxonomy.ts`. It must return **no messages** (empty array). That covers:

- `ENTITY_TYPES` keys unique; `referenceDirs` non-empty; no directory claimed by two rows
- `enrichment: true` rows have `pageType` and stub dirs
- Every `pageType` on taxonomy + frontmatter rows exists in `PAGE_TYPE_VALUES` (`src/core/types.ts`)
- Every `PAGE_TYPE_INFERENCE_RULES[].type` is a known `PageType`
- Every frontmatter / FS rule `type` is a `RELATIONSHIP` value
- `FRONTMATTER_RELATIONSHIP_MAP` `dirHint` segments (non-empty) are in `ENTITY_REFERENCE_DIRS`
- `FS_LINK_TYPE_RULES` `fromDir` / `toDir` are in `ENTITY_REFERENCE_DIRS`

## Manual checklist (per change)

### A. New or renamed `PageType` (`pages.type`)

1. **`src/core/types.ts`** — Append the literal to `PAGE_TYPE_VALUES` (single source; `PageType` is derived from it).
2. **Path inference** — If paths should infer this type without frontmatter `type:`:
   - Prefer `pathInferencePatterns` on the matching `ENTITY_TYPES` row when it is directory-backed.
   - Otherwise extend `SPECIAL_PAGE_TYPE_INFERENCE_RULES` in `src/core/entity-taxonomy.ts` and keep order consistent with `PAGE_TYPE_INFERENCE_RULES` (see file comment: special rules vs entity-derived splice).
3. **`parseMarkdown` / default type** — `inferType()` delegates to `inferPageTypeFromPath()`; no second table in `markdown.ts` for paths.
4. **Tests** — Add a row to `inferPageTypeFromPath` cases in `test/entity-taxonomy.test.ts` (and any product-specific tests).
5. **Engines / SQL** — If the kind needs storage, filters, or health slices, update `src/core/` engine paths and any typed filters that mention `PageType`.

### B. New or changed `ENTITY_TYPES` row (slug dirs, enrich, backlink / health flags)

1. **`src/core/entity-taxonomy.ts`** — Add or edit the row: `key`, `singular`, `plural`, `referenceDirs`, `pathInferencePatterns`, `customBehavior`, optional `enrichment`, optional `pageType`.
2. **Directory regex** — `DIR_PATTERN` / `ENTITY_REFERENCE_DIRS` are derived; do not duplicate a parallel dir list in `link-extraction.ts`.
3. **Wiki / graph behavior** — If links should infer new edge types, see section C.
4. **Contract tests** — Update the snapshot-style expectations in `test/entity-taxonomy.test.ts` (`ENTITY_TYPES`, `ENTITY_REFERENCE_DIRS`, `DIR_PATTERN`, helpers).

### C. New or changed inferred **relationship** label

1. **`RELATIONSHIP` object** in `src/core/entity-taxonomy.ts` — Add the string constant (drives `InferredLinkType` and manual `add_link` allow-list).
2. **Where it is inferred** — Wire at least one of:
   - `FRONTMATTER_RELATIONSHIP_MAP` (YAML field → type + `dirHint`)
   - `FS_LINK_TYPE_RULES` (top-level dir pair + optional frontmatter gate)
   - Heuristics in `src/core/link-extraction.ts` (or other callers) if not expressible as map data
3. **`parseManualLinkTypeOrThrow` / MCP** — Allowed values follow `RELATIONSHIP`; no extra file if the value is in the object.
4. **Tests** — Extend `test/entity-taxonomy.test.ts` maps / behavior tests.

### D. Optional: operations and parity

- **`src/core/operations.ts`** — If a new `link_type` or page kind appears in user-facing contracts, update schemas and parity tests (`test/parity.test.ts` if present).
- **Resolver / skills** — User-facing docs in `skills/` when behavior is user-visible.

## Related files (quick reference)

| Area | Primary file |
|------|----------------|
| Page type union + runtime list | `src/core/types.ts` (`PAGE_TYPE_VALUES`, `PageType`) |
| Entity rows, dirs, inference, relationships | `src/core/entity-taxonomy.ts` |
| Markdown parse default type | `src/core/markdown.ts` (`inferType` → `inferPageTypeFromPath`) |
| Link + wikilink extraction | `src/core/link-extraction.ts` |
| Taxonomy contract + validators | `test/entity-taxonomy.test.ts` |
