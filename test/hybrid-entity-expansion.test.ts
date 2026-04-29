/**
 * Hybrid search — entity-graph expansion behind GBRAIN_ENTITY_GRAPH_RAG + explicit depth.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { hybridSearch } from '../src/core/search/hybrid.ts';

const PGLITE_PARALLEL_TIMEOUT_MS = 30_000;

describe('hybridSearch — entity graph expansion', () => {
  let engine: PGLiteEngine;
  let prevGate: string | undefined;
  let prevOpenAI: string | undefined;

  beforeAll(async () => {
    engine = new PGLiteEngine();
    await engine.connect({});
    await engine.initSchema();

    await engine.putPage('people/alice-example', {
      type: 'person',
      title: 'Alice Example',
      compiled_truth: 'Founder at [Beta Example](companies/beta-example). Unique anchor token alice-anchor-token.',
      timeline: '',
    });
    await engine.upsertChunks('people/alice-example', [
      {
        chunk_index: 0,
        chunk_text:
          'Founder at [Beta Example](companies/beta-example). Unique anchor token alice-anchor-token.',
        chunk_source: 'compiled_truth',
        token_count: 22,
      },
    ]);

    await engine.putPage('companies/beta-example', {
      type: 'company',
      title: 'Beta Example Inc',
      compiled_truth: 'neighbor-xyzzy-token content about the company operations.',
      timeline: '',
    });
    await engine.upsertChunks('companies/beta-example', [
      {
        chunk_index: 0,
        chunk_text: 'neighbor-xyzzy-token content about the company operations.',
        chunk_source: 'compiled_truth',
        token_count: 14,
      },
    ]);

    await engine.addLink('people/alice-example', 'companies/beta-example', '', 'works_at', 'markdown');
  }, PGLITE_PARALLEL_TIMEOUT_MS);

  afterAll(async () => {
    await engine.disconnect();
  }, PGLITE_PARALLEL_TIMEOUT_MS);

  beforeEach(() => {
    prevGate = process.env.GBRAIN_ENTITY_GRAPH_RAG;
    prevOpenAI = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (prevGate === undefined) delete process.env.GBRAIN_ENTITY_GRAPH_RAG;
    else process.env.GBRAIN_ENTITY_GRAPH_RAG = prevGate;
    if (prevOpenAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAI;
  });

  test('gate off: neighbor slug not pulled in', async () => {
    delete process.env.GBRAIN_ENTITY_GRAPH_RAG;
    const results = await hybridSearch(engine, 'alice-anchor-token', {
      limit: 10,
      expansion: false,
      entityWalkDepth: 2,
      entityWalkEdgePolicy: 'all',
    });
    const slugs = results.map(r => r.slug);
    expect(slugs.some(s => s.includes('beta-example'))).toBe(false);
  }, PGLITE_PARALLEL_TIMEOUT_MS);

  test('gate on + depth: neighbor chunk can surface', async () => {
    process.env.GBRAIN_ENTITY_GRAPH_RAG = '1';
    const results = await hybridSearch(engine, 'alice-anchor-token', {
      limit: 15,
      expansion: false,
      entityWalkDepth: 2,
      entityWalkEdgePolicy: 'all',
    });
    const slugs = results.map(r => r.slug);
    expect(slugs.some(s => s.includes('beta-example'))).toBe(true);
  }, PGLITE_PARALLEL_TIMEOUT_MS);
});
