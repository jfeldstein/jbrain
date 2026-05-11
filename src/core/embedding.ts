/**
 * Embedding Service
 * Ported from production Ruby implementation (embedding_service.rb, 190 LOC)
 *
 * Default: OpenAI text-embedding-3-large at 1536 dimensions.
 * Alternate providers: OpenRouter, Ollama (OpenAI-compatible /v1), via env — see embedding-config.ts.
 * Retry with exponential backoff (4s base, 120s cap, 5 retries).
 * 8000 character input truncation.
 */

import OpenAI from 'openai';
import {
  DEFAULT_EMBEDDING_MODEL,
  getActiveEmbeddingModel,
  isEmbeddingConfigured,
  resolveEmbeddingSettings,
  shouldShowOpenAiUsdCostEstimate,
} from './embedding-config.ts';

const DIMENSIONS = 1536;
const MAX_CHARS = 8000;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 4000;
const MAX_DELAY_MS = 120000;
const BATCH_SIZE = 100;

/** Exported for unit tests: ensures provider vectors match pgvector column width. */
export function assertEmbeddingVectorsMatchBrain(vectors: Float32Array[], expectedDim = DIMENSIONS): void {
  for (const v of vectors) {
    if (v.length !== expectedDim) {
      throw new Error(
        `Embedding provider returned length ${v.length} but this brain expects ${expectedDim} dimensions (pgvector column width).`,
      );
    }
  }
}

let client: OpenAI | null = null;
let clientFingerprint: string | null = null;

function fingerprintClient(s: ReturnType<typeof resolveEmbeddingSettings>): string {
  return JSON.stringify({
    baseURL: s.baseURL,
    apiKey: s.apiKey,
    omitDimensionsParam: s.omitDimensionsParam,
    defaultHeaders: s.defaultHeaders,
  });
}

function getClient(): OpenAI {
  const s = resolveEmbeddingSettings(process.env);
  const fp = fingerprintClient(s);
  if (!client || fp !== clientFingerprint) {
    clientFingerprint = fp;
    client = new OpenAI({
      apiKey: s.apiKey.length > 0 ? s.apiKey : 'missing-api-key',
      baseURL: s.baseURL,
      defaultHeaders: s.defaultHeaders,
    });
  }
  return client;
}

/** Clears cached OpenAI client (tests or env reload). */
export function resetEmbeddingClientForTests(): void {
  client = null;
  clientFingerprint = null;
}

export { getActiveEmbeddingModel, isEmbeddingConfigured, shouldShowOpenAiUsdCostEstimate };
export { resolveEmbeddingSettings } from './embedding-config.ts';
export type { ResolvedEmbeddingSettings } from './embedding-config.ts';

export async function embed(text: string): Promise<Float32Array> {
  const truncated = text.slice(0, MAX_CHARS);
  const result = await embedBatch([truncated]);
  return result[0];
}

export interface EmbedBatchOptions {
  /**
   * Optional callback fired after each 100-item sub-batch completes.
   * CLI wrappers tick a reporter; Minion handlers can call
   * job.updateProgress here instead of hooking the per-page callback.
   */
  onBatchComplete?: (done: number, total: number) => void;
}

export async function embedBatch(
  texts: string[],
  options: EmbedBatchOptions = {},
): Promise<Float32Array[]> {
  const truncated = texts.map(t => t.slice(0, MAX_CHARS));
  const results: Float32Array[] = [];

  // Process in batches of BATCH_SIZE
  for (let i = 0; i < truncated.length; i += BATCH_SIZE) {
    const batch = truncated.slice(i, i + BATCH_SIZE);
    const batchResults = await embedBatchWithRetry(batch);
    results.push(...batchResults);
    options.onBatchComplete?.(results.length, truncated.length);
  }

  return results;
}

async function embedBatchWithRetry(texts: string[]): Promise<Float32Array[]> {
  const s = resolveEmbeddingSettings(process.env);
  if (!s.apiKey) {
    throw new Error('No embedding API key configured. Set OPENAI_API_KEY, OPENROUTER_API_KEY (OpenRouter), or GBRAIN_EMBEDDING_API_KEY.');
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const body: OpenAI.EmbeddingCreateParams = {
        model: s.model,
        input: texts,
      };
      if (!s.omitDimensionsParam) {
        body.dimensions = DIMENSIONS;
      }

      const response = await getClient().embeddings.create(body);

      // Sort by index to maintain order
      const sorted = response.data.sort((a, b) => a.index - b.index);
      const vectors = sorted.map(d => new Float32Array(d.embedding));
      assertEmbeddingVectorsMatchBrain(vectors);
      return vectors;
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('this brain expects')) {
        throw e;
      }
      if (attempt === MAX_RETRIES - 1) throw e;

      // Check for rate limit with Retry-After header
      let delay = exponentialDelay(attempt);

      if (e instanceof OpenAI.APIError && e.status === 429) {
        const retryAfter = e.headers?.['retry-after'];
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          if (!isNaN(parsed)) {
            delay = parsed * 1000;
          }
        }
      }

      await sleep(delay);
    }
  }

  // Should not reach here
  throw new Error('Embedding failed after all retries');
}

function exponentialDelay(attempt: number): number {
  const delay = BASE_DELAY_MS * Math.pow(2, attempt);
  return Math.min(delay, MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Default embedding model id (OpenAI). Use getActiveEmbeddingModel() for env-resolved id. */
export const EMBEDDING_MODEL = DEFAULT_EMBEDDING_MODEL;
export const EMBEDDING_DIMENSIONS = DIMENSIONS;

/**
 * v0.20.0 Cathedral II Layer 8 (D1): USD cost per 1k tokens for
 * text-embedding-3-large. Used by `gbrain sync --all` cost preview and
 * the reindex-code backfill command to surface expected spend before
 * the agent/user accepts an expensive operation.
 *
 * Value: $0.00013 / 1k tokens as of 2026. Update when OpenAI changes
 * pricing. Single source of truth — every cost-preview surface reads
 * this constant, so a pricing change is a one-line edit.
 */
export const EMBEDDING_COST_PER_1K_TOKENS = 0.00013;

/** Compute USD cost estimate for embedding `tokens` at current model rate. */
export function estimateEmbeddingCostUsd(tokens: number): number {
  return (tokens / 1000) * EMBEDDING_COST_PER_1K_TOKENS;
}
