/**
 * Pure embedding provider resolution from environment.
 * Used by embedding.ts and tests; keep side-effect free aside from reading `env`.
 */

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-large';

export interface ResolvedEmbeddingSettings {
  baseURL: string;
  apiKey: string;
  model: string;
  omitDimensionsParam: boolean;
  defaultHeaders: Record<string, string>;
}

const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';

function trimOrEmpty(v: string | undefined): string {
  return typeof v === 'string' ? v.trim() : '';
}

function isOpenRouterHost(baseURL: string): boolean {
  try {
    const h = new URL(baseURL).hostname;
    return h === 'openrouter.ai' || h.endsWith('.openrouter.ai');
  } catch {
    return false;
  }
}

function openRouterHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const referer =
    trimOrEmpty(env.GBRAIN_OPENROUTER_HTTP_REFERER)
    || trimOrEmpty(env.OPENROUTER_HTTP_REFERER)
    || 'https://github.com/garrytan/gbrain';
  const title =
    trimOrEmpty(env.GBRAIN_OPENROUTER_APP_NAME)
    || trimOrEmpty(env.OPENROUTER_APP_NAME)
    || 'gbrain';
  return {
    'HTTP-Referer': referer,
    'X-Title': title,
  };
}

export function resolveEmbeddingSettings(env: NodeJS.ProcessEnv): ResolvedEmbeddingSettings {
  const baseRaw = trimOrEmpty(env.GBRAIN_EMBEDDING_BASE_URL) || trimOrEmpty(env.OPENAI_BASE_URL);
  const baseURL = baseRaw || DEFAULT_OPENAI_BASE;

  const gKey = trimOrEmpty(env.GBRAIN_EMBEDDING_API_KEY);
  let apiKey = gKey;
  if (!apiKey && isOpenRouterHost(baseURL)) {
    apiKey = trimOrEmpty(env.OPENROUTER_API_KEY);
  }
  if (!apiKey) {
    apiKey = trimOrEmpty(env.OPENAI_API_KEY);
  }

  const model = trimOrEmpty(env.GBRAIN_EMBEDDING_MODEL) || DEFAULT_EMBEDDING_MODEL;
  const omitDimensionsParam = env.GBRAIN_EMBEDDING_NO_DIMENSIONS === '1';

  const defaultHeaders: Record<string, string> = {};
  if (isOpenRouterHost(baseURL)) {
    Object.assign(defaultHeaders, openRouterHeaders(env));
  }

  return {
    baseURL,
    apiKey,
    model,
    omitDimensionsParam,
    defaultHeaders,
  };
}

export function isEmbeddingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveEmbeddingSettings(env).apiKey.length > 0;
}

/** True when OpenAI-hosted default model — USD token estimate is meaningful. */
export function shouldShowOpenAiUsdCostEstimate(env: NodeJS.ProcessEnv = process.env): boolean {
  const s = resolveEmbeddingSettings(env);
  let host: string;
  try {
    host = new URL(s.baseURL).hostname;
  } catch {
    return false;
  }
  if (host !== 'api.openai.com') return false;
  if (s.model !== DEFAULT_EMBEDDING_MODEL) return false;
  return true;
}

export function getActiveEmbeddingModel(env: NodeJS.ProcessEnv = process.env): string {
  return resolveEmbeddingSettings(env).model;
}
