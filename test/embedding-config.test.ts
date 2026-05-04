/**
 * Embedding provider resolution (OpenRouter, Ollama-compatible base URL, OpenAI defaults).
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  resolveEmbeddingSettings,
  isEmbeddingConfigured,
  shouldShowOpenAiUsdCostEstimate,
} from '../src/core/embedding-config.ts';

const cleanEmbeddingEnv = () => {
  const keys = [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENROUTER_API_KEY',
    'GBRAIN_EMBEDDING_BASE_URL',
    'GBRAIN_EMBEDDING_API_KEY',
    'GBRAIN_EMBEDDING_MODEL',
    'GBRAIN_EMBEDDING_NO_DIMENSIONS',
    'GBRAIN_OPENROUTER_HTTP_REFERER',
    'OPENROUTER_HTTP_REFERER',
    'GBRAIN_OPENROUTER_APP_NAME',
    'OPENROUTER_APP_NAME',
  ];
  for (const k of keys) delete process.env[k];
};

describe('resolveEmbeddingSettings', () => {
  beforeEach(() => {
    cleanEmbeddingEnv();
  });

  afterEach(() => {
    cleanEmbeddingEnv();
  });

  test('defaults: OPENAI_API_KEY only → api.openai.com, default model, dimensions on', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const s = resolveEmbeddingSettings(process.env);
    expect(s.baseURL).toBe('https://api.openai.com/v1');
    expect(s.apiKey).toBe('sk-test');
    expect(s.model).toBe('text-embedding-3-large');
    expect(s.omitDimensionsParam).toBe(false);
    expect(isEmbeddingConfigured(process.env)).toBe(true);
    expect(shouldShowOpenAiUsdCostEstimate(process.env)).toBe(true);
  });

  test('GBRAIN_EMBEDDING_BASE_URL + GBRAIN_EMBEDDING_API_KEY override OpenRouter without OPENAI_API_KEY', () => {
    process.env.GBRAIN_EMBEDDING_BASE_URL = 'https://openrouter.ai/api/v1';
    process.env.GBRAIN_EMBEDDING_API_KEY = 'sk-or-custom';
    const s = resolveEmbeddingSettings(process.env);
    expect(s.baseURL).toBe('https://openrouter.ai/api/v1');
    expect(s.apiKey).toBe('sk-or-custom');
    expect(isEmbeddingConfigured(process.env)).toBe(true);
    expect(shouldShowOpenAiUsdCostEstimate(process.env)).toBe(false);
    expect(s.defaultHeaders['HTTP-Referer']).toBe('https://github.com/garrytan/gbrain');
    expect(s.defaultHeaders['X-Title']).toBe('gbrain');
  });

  test('OPENAI_BASE_URL localhost + OPENAI_API_KEY=ollama → non-OpenAI cost estimate', () => {
    process.env.OPENAI_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.OPENAI_API_KEY = 'ollama';
    const s = resolveEmbeddingSettings(process.env);
    expect(s.baseURL).toBe('http://127.0.0.1:11434/v1');
    expect(s.apiKey).toBe('ollama');
    expect(shouldShowOpenAiUsdCostEstimate(process.env)).toBe(false);
  });

  test('OpenRouter headers honor env overrides', () => {
    process.env.GBRAIN_EMBEDDING_BASE_URL = 'https://openrouter.ai/api/v1';
    process.env.GBRAIN_EMBEDDING_API_KEY = 'k';
    process.env.OPENROUTER_HTTP_REFERER = 'https://example.com/app';
    process.env.OPENROUTER_APP_NAME = 'MyApp';
    const s = resolveEmbeddingSettings(process.env);
    expect(s.defaultHeaders['HTTP-Referer']).toBe('https://example.com/app');
    expect(s.defaultHeaders['X-Title']).toBe('MyApp');
  });

  test('OPENROUTER_API_KEY used when host is openrouter and no GBRAIN_EMBEDDING_API_KEY', () => {
    process.env.GBRAIN_EMBEDDING_BASE_URL = 'https://openrouter.ai/api/v1';
    process.env.OPENROUTER_API_KEY = 'sk-or';
    const s = resolveEmbeddingSettings(process.env);
    expect(s.apiKey).toBe('sk-or');
    expect(isEmbeddingConfigured(process.env)).toBe(true);
  });

  test('GBRAIN_EMBEDDING_NO_DIMENSIONS=1 → omitDimensionsParam true', () => {
    process.env.OPENAI_API_KEY = 'sk';
    process.env.GBRAIN_EMBEDDING_NO_DIMENSIONS = '1';
    const s = resolveEmbeddingSettings(process.env);
    expect(s.omitDimensionsParam).toBe(true);
  });

  test('unconfigured: no keys → isEmbeddingConfigured false', () => {
    const s = resolveEmbeddingSettings(process.env);
    expect(s.apiKey).toBe('');
    expect(isEmbeddingConfigured(process.env)).toBe(false);
  });

  test('custom model on api.openai.com disables USD cost gate', () => {
    process.env.OPENAI_API_KEY = 'sk';
    process.env.GBRAIN_EMBEDDING_MODEL = 'text-embedding-3-small';
    expect(shouldShowOpenAiUsdCostEstimate(process.env)).toBe(false);
  });
});
