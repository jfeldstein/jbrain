/**
 * Entity-graph two-pass retrieval: walk typed links from anchor entity slugs,
 * score neighbors with hop decay + edge-type weight, hydrate matching chunks via
 * scoped keyword search. Best-effort; callers wrap in try/catch.
 */

import type { BrainEngine } from '../engine.ts';
import { MAX_SEARCH_LIMIT } from '../engine.ts';
import { extractEntityRefs } from '../link-extraction.ts';
import type {
  EntityWalkEdgePolicy,
  GraphPath,
  SearchKeywordScopedOpts,
  SearchOpts,
  SearchResult,
} from '../types.ts';
import type { QueryIntent } from './intent.ts';

/** Non-mention relationship edges stored in `links.link_type`. */
export const TYPED_NON_MENTION_EDGE_TYPES: readonly string[] = [
  'works_at',
  'invested_in',
  'advises',
  'attended',
  'founded',
  'source',
] as const;

const GLOBAL_NEIGHBOR_CAP = 50;

const ENTITY_SLUG_PREFIX =
  /^(?:people|companies|meetings|concepts|deal|deals|civic|project|projects|source|media|yc|tech|finance|personal|openclaw|entities)\//;

export function selectEdgeTypes(
  _intent: QueryIntent,
  policy: EntityWalkEdgePolicy,
): string[] | undefined {
  if (policy === 'all') return undefined;
  return [...TYPED_NON_MENTION_EDGE_TYPES];
}

export function edgeWeight(linkType: string): number {
  return linkType === 'mentions' ? 0.5 : 1.0;
}

/** Same decay as structural two-pass: 1/(1+depth) where depth is GraphPath.depth. */
export function decayForHop(depth: number): number {
  return 1 / (1 + Math.max(0, depth));
}

export function shouldFallbackToMentions(
  policy: EntityWalkEdgePolicy,
  usedTypedFilter: boolean,
  edgeCount: number,
): boolean {
  return policy === 'intent_based' && usedTypedFilter && edgeCount === 0;
}

export function extractAnchorEntitySlugs(anchor: SearchResult): string[] {
  const out = new Set<string>();
  if (ENTITY_SLUG_PREFIX.test(anchor.slug)) {
    out.add(anchor.slug);
  }
  for (const ref of extractEntityRefs(anchor.chunk_text)) {
    out.add(ref.slug);
  }
  return Array.from(out);
}

async function collectNeighborScores(
  engine: BrainEngine,
  anchors: SearchResult[],
  walkDepth: 1 | 2,
  intent: QueryIntent,
  policy: EntityWalkEdgePolicy,
  sourceId: string | undefined,
): Promise<Map<string, number>> {
  let linkTypes = selectEdgeTypes(intent, policy);
  const usedTypedFilter = policy !== 'all' && linkTypes !== undefined;

  async function walkOnce(filter: string[] | undefined): Promise<{ map: Map<string, number>; edgeCount: number }> {
    const map = new Map<string, number>();
    let edgeCount = 0;

    for (const anchor of anchors) {
      const anchorScore = anchor.score;
      const entitySlugs = extractAnchorEntitySlugs(anchor);
      if (entitySlugs.length === 0) continue;

      for (const entitySlug of entitySlugs) {
        let paths: GraphPath[] = [];
        try {
          paths = await engine.traversePathsScoped(entitySlug, {
            depth: walkDepth,
            direction: 'out',
            linkTypes: filter,
            sourceId: sourceId ?? '__all__',
          });
        } catch {
          continue;
        }

        for (const p of paths) {
          edgeCount++;
          const scored = anchorScore * decayForHop(p.depth) * edgeWeight(p.link_type);
          const prev = map.get(p.to_slug) ?? 0;
          if (scored > prev) map.set(p.to_slug, scored);
        }
      }
    }

    return { map, edgeCount };
  }

  let { map, edgeCount } = await walkOnce(linkTypes);

  if (shouldFallbackToMentions(policy, usedTypedFilter, edgeCount)) {
    const second = await walkOnce(undefined);
    map = second.map;
  }

  const anchorSlugs = new Set(anchors.map(a => a.slug));
  for (const s of anchorSlugs) {
    map.delete(s);
  }

  const sorted = Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, GLOBAL_NEIGHBOR_CAP);
  return new Map(sorted);
}

/**
 * Hydrate neighbor slugs into chunk rows: scoped FTS, then rank decay within
 * each slug (1, 1/2, 1/3, …) applied on top of the graph-derived base score.
 */
async function firstChunkSearchResult(engine: BrainEngine, slug: string): Promise<SearchResult | null> {
  const page = await engine.getPage(slug);
  if (!page) return null;
  const chunks = await engine.getChunks(slug);
  const cc =
    chunks.find(c => c.chunk_source === 'compiled_truth' || c.chunk_source === 'timeline') ?? chunks[0];
  if (!cc) return null;
  return {
    slug: page.slug,
    page_id: page.id,
    title: page.title,
    type: page.type,
    chunk_text: cc.chunk_text,
    chunk_source: cc.chunk_source as 'compiled_truth' | 'timeline',
    chunk_id: cc.id,
    chunk_index: cc.chunk_index,
    score: 0,
    stale: false,
  };
}

export async function hydrateEntitySlugsToChunks(
  engine: BrainEngine,
  query: string,
  slugScores: Map<string, number>,
  searchBase: SearchOpts,
): Promise<SearchResult[]> {
  if (slugScores.size === 0) return [];

  const slugs = Array.from(slugScores.keys());
  const scopedOpts: SearchKeywordScopedOpts = {
    ...searchBase,
    limit: Math.min(MAX_SEARCH_LIMIT, Math.max(slugs.length * 4, 40)),
    perSlugCap: 3,
  };

  let rows = await engine.searchKeywordScoped(query, slugs, scopedOpts);

  const hitSlugs = new Set(rows.map(r => r.slug));
  for (const slug of slugs) {
    if (hitSlugs.has(slug)) continue;
    const fb = await firstChunkSearchResult(engine, slug);
    if (fb) {
      rows.push(fb);
      hitSlugs.add(slug);
    }
  }

  const bySlug = new Map<string, SearchResult[]>();
  for (const r of rows) {
    const list = bySlug.get(r.slug) ?? [];
    list.push(r);
    bySlug.set(r.slug, list);
  }

  const out: SearchResult[] = [];
  for (const [slug, list] of bySlug) {
    const base = slugScores.get(slug) ?? 0;
    list.sort((a, b) => b.score - a.score);
    list.forEach((r, i) => {
      out.push({ ...r, score: base * (1 / (i + 1)) });
    });
  }

  return out;
}

export async function runEntityGraphExpansion(
  engine: BrainEngine,
  query: string,
  anchors: SearchResult[],
  intent: QueryIntent,
  walkDepth: 0 | 1 | 2,
  opts: {
    edgePolicy: EntityWalkEdgePolicy;
    sourceId?: string;
    searchBaseOpts: SearchOpts;
    /** Hybrid result limit — bounds anchor window (same spirit as code A2). */
    limit: number;
  },
): Promise<SearchResult[]> {
  if (walkDepth === 0 || anchors.length === 0) return [];

  const depth: 1 | 2 = walkDepth === 2 ? 2 : 1;

  const maxAnchors = Math.min(anchors.length, Math.max(10, opts.limit));
  const anchorSet = anchors.slice(0, maxAnchors);

  const slugScores = await collectNeighborScores(
    engine,
    anchorSet,
    depth,
    intent,
    opts.edgePolicy,
    opts.sourceId,
  );

  return hydrateEntitySlugsToChunks(engine, query, slugScores, opts.searchBaseOpts);
}
