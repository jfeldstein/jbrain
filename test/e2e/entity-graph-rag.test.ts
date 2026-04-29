/**
 * Entity graph RAG — PGLite E2E (no DATABASE_URL required).
 *
 * Validates `GBRAIN_ENTITY_GRAPH_RAG` gate + explicit `entityWalkDepth` merges
 * a linked neighbor chunk into hybrid keyword-only retrieval.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { PGLiteEngine } from '../../src/core/pglite-engine.ts';
import { hybridSearch } from '../../src/core/search/hybrid.ts';

const PGLITE_PARALLEL_TIMEOUT_MS = 30_000;

describe('entity graph RAG — PGLite hybrid', () => {
  let engine: PGLiteEngine;
  let prevGate: string | undefined;

  beforeAll(async () => {
    prevGate = process.env.GBRAIN_ENTITY_GRAPH_RAG;

    engine = new PGLiteEngine();
    await engine.connect({});
    await engine.initSchema();

    await engine.putPage('people/alice-example', {
      type: 'person',
      title: 'Alice Example',
      compiled_truth: 'Founder at [Beta Example](companies/beta-example). alice-anchor-token.',
      timeline: '',
    });
    await engine.upsertChunks('people/alice-example', [
      {
        chunk_index: 0,
        chunk_text: 'Founder at [Beta Example](companies/beta-example). alice-anchor-token.',
        chunk_source: 'compiled_truth',
        token_count: 14,
      },
    ]);

    await engine.putPage('companies/beta-example', {
      type: 'company',
      title: 'Beta Example Inc',
      compiled_truth: 'neighbor-entity-e2e-token unrelated to anchor query vocabulary.',
      timeline: '',
    });
    await engine.upsertChunks('companies/beta-example', [
      {
        chunk_index: 0,
        chunk_text: 'neighbor-entity-e2e-token unrelated to anchor query vocabulary.',
        chunk_source: 'compiled_truth',
        token_count: 12,
      },
    ]);

    await engine.addLink('people/alice-example', 'companies/beta-example', '', 'works_at', 'markdown');

    delete process.env.OPENAI_API_KEY;
    process.env.GBRAIN_ENTITY_GRAPH_RAG = '1';
  }, PGLITE_PARALLEL_TIMEOUT_MS);

  afterAll(async () => {
    if (prevGate === undefined) delete process.env.GBRAIN_ENTITY_GRAPH_RAG;
    else process.env.GBRAIN_ENTITY_GRAPH_RAG = prevGate;
    await engine.disconnect();
  }, PGLITE_PARALLEL_TIMEOUT_MS);

  test('neighbor chunk hydrates via graph expansion + fallback when FTS misses neighbor text', async () => {
    const results = await hybridSearch(engine, 'alice-anchor-token', {
      limit: 15,
      expansion: false,
      entityWalkDepth: 2,
      entityWalkEdgePolicy: 'all',
    });

    expect(results.some(r => r.slug.includes('beta-example'))).toBe(true);
  }, PGLITE_PARALLEL_TIMEOUT_MS);
});
