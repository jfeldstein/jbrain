/**
 * Entity graph two-pass: pure helpers + PGLite integration (traverse + scoped FTS).
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import type { SearchResult } from '../src/core/types.ts';
import {
  TYPED_NON_MENTION_EDGE_TYPES,
  decayForHop,
  edgeWeight,
  extractAnchorEntitySlugs,
  hydrateEntitySlugsToChunks,
  runEntityGraphExpansion,
  selectEdgeTypes,
  shouldFallbackToMentions,
} from '../src/core/search/entity-two-pass.ts';

describe('entity-two-pass — pure helpers', () => {
  test('selectEdgeTypes: all → undefined', () => {
    expect(selectEdgeTypes('general', 'all')).toBeUndefined();
  });

  test('selectEdgeTypes: typed_only returns non-mention allowlist', () => {
    const t = selectEdgeTypes('entity', 'typed_only');
    expect(t?.includes('mentions')).toBe(false);
    expect(t?.length).toBe(TYPED_NON_MENTION_EDGE_TYPES.length);
  });

  test('edgeWeight penalizes mentions', () => {
    expect(edgeWeight('mentions')).toBe(0.5);
    expect(edgeWeight('works_at')).toBe(1.0);
  });

  test('decayForHop matches two-pass decay', () => {
    expect(decayForHop(1)).toBeCloseTo(1 / 2, 5);
    expect(decayForHop(2)).toBeCloseTo(1 / 3, 5);
  });

  test('shouldFallbackToMentions', () => {
    expect(shouldFallbackToMentions('intent_based', true, 0)).toBe(true);
    expect(shouldFallbackToMentions('intent_based', true, 3)).toBe(false);
    expect(shouldFallbackToMentions('all', true, 0)).toBe(false);
  });

  test('extractAnchorEntitySlugs: slug prefix + inline refs', () => {
    const anchor: SearchResult = {
      slug: 'people/alice-example',
      page_id: 1,
      title: 'Alice',
      type: 'person',
      chunk_text: 'See also [Beta Co](companies/beta-example) for details.',
      chunk_source: 'compiled_truth',
      chunk_id: 10,
      chunk_index: 0,
      score: 1.0,
      stale: false,
    };
    const slugs = extractAnchorEntitySlugs(anchor);
    expect(slugs).toContain('people/alice-example');
    expect(slugs).toContain('companies/beta-example');
  });
});

describe('entity-two-pass — PGLite integration', () => {
  let engine: PGLiteEngine;

  beforeAll(async () => {
    engine = new PGLiteEngine();
    await engine.connect({});
    await engine.initSchema();

    await engine.putPage('people/alice-example', {
      type: 'person',
      title: 'Alice Example',
      compiled_truth: 'Founder at [Beta Example](companies/beta-example).',
      timeline: '',
    });
    await engine.upsertChunks('people/alice-example', [
      {
        chunk_index: 0,
        chunk_text: 'Founder at [Beta Example](companies/beta-example).',
        chunk_source: 'compiled_truth',
        token_count: 12,
      },
    ]);

    await engine.putPage('companies/beta-example', {
      type: 'company',
      title: 'Beta Example Inc',
      compiled_truth: 'beta-example secret phrase xyzzy-neighbor-content',
      timeline: '',
    });
    await engine.upsertChunks('companies/beta-example', [
      {
        chunk_index: 0,
        chunk_text: 'beta-example secret phrase xyzzy-neighbor-content',
        chunk_source: 'compiled_truth',
        token_count: 10,
      },
    ]);

    await engine.addLink('people/alice-example', 'companies/beta-example', '', 'works_at', 'markdown');
  });

  afterAll(async () => {
    await engine.disconnect();
  });

  test('hydrateEntitySlugsToChunks ranks within slug', async () => {
    const slugScores = new Map<string, number>([['companies/beta-example', 1.0]]);
    const rows = await hydrateEntitySlugsToChunks(
      engine,
      'xyzzy-neighbor-content',
      slugScores,
      { limit: 20, detail: 'medium' },
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.slug).toBe('companies/beta-example');
    expect(rows[0]!.score).toBeCloseTo(1.0, 5);
  });

  test('runEntityGraphExpansion returns neighbor chunks', async () => {
    const page = await engine.getPage('people/alice-example');
    const chunks = await engine.getChunks('people/alice-example');
    const anchor: SearchResult = {
      slug: 'people/alice-example',
      page_id: page!.id,
      title: 'Alice Example',
      type: 'person',
      chunk_text: chunks[0]!.chunk_text,
      chunk_source: 'compiled_truth',
      chunk_id: chunks[0]!.id,
      chunk_index: 0,
      score: 2.0,
      stale: false,
    };

    const expanded = await runEntityGraphExpansion(
      engine,
      'xyzzy-neighbor-content',
      [anchor],
      'entity',
      1,
      {
        edgePolicy: 'all',
        searchBaseOpts: { limit: 40, detail: 'medium' },
        limit: 10,
      },
    );

    expect(expanded.some(r => r.slug === 'companies/beta-example')).toBe(true);
  });
});
