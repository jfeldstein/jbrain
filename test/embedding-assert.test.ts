import { describe, test, expect } from 'bun:test';
import { assertEmbeddingVectorsMatchBrain } from '../src/core/embedding.ts';

describe('assertEmbeddingVectorsMatchBrain', () => {
  test('throws when length mismatches brain width', () => {
    expect(() => assertEmbeddingVectorsMatchBrain([new Float32Array(768)])).toThrow(/768/);
    expect(() => assertEmbeddingVectorsMatchBrain([new Float32Array(768)])).toThrow(/1536/);
  });

  test('accepts 1536-wide vectors', () => {
    expect(() => assertEmbeddingVectorsMatchBrain([new Float32Array(1536)])).not.toThrow();
  });
});
