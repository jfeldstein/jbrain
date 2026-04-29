import { describe, test, expect } from 'bun:test';
import type { QueryIntent } from '../src/core/search/intent.ts';
import { resolveEntityWalkDepth } from '../src/core/search/entity-walk.ts';

describe('resolveEntityWalkDepth activation matrix', () => {
  const intents: QueryIntent[] = ['entity', 'temporal', 'event', 'general'];

  test('gate off: always 0', () => {
    for (const intent of intents) {
      expect(resolveEntityWalkDepth(undefined, intent, false)).toBe(0);
      expect(resolveEntityWalkDepth(0, intent, false)).toBe(0);
      expect(resolveEntityWalkDepth(1, intent, false)).toBe(0);
      expect(resolveEntityWalkDepth(2, intent, false)).toBe(0);
      // out-of-range requests should still disable when gate is off
      expect(resolveEntityWalkDepth(99 as any, intent, false)).toBe(0);
      expect(resolveEntityWalkDepth(-1 as any, intent, false)).toBe(0);
    }
  });

  test('gate on + explicit depth in {1,2}: uses explicit depth', () => {
    for (const intent of intents) {
      expect(resolveEntityWalkDepth(1, intent, true)).toBe(1);
      expect(resolveEntityWalkDepth(2, intent, true)).toBe(2);
    }
  });

  test('gate on + explicit depth=0: disabled', () => {
    for (const intent of intents) {
      expect(resolveEntityWalkDepth(0, intent, true)).toBe(0);
    }
  });

  test('gate on + requestedDepth unset + intent entity: auto-depth 1', () => {
    expect(resolveEntityWalkDepth(undefined, 'entity', true)).toBe(1);
  });

  test('gate on + requestedDepth unset + intent not entity: disabled', () => {
    expect(resolveEntityWalkDepth(undefined, 'general', true)).toBe(0);
    expect(resolveEntityWalkDepth(undefined, 'temporal', true)).toBe(0);
    expect(resolveEntityWalkDepth(undefined, 'event', true)).toBe(0);
  });

  test('gate on + invalid requestedDepth: clamps to 0', () => {
    expect(resolveEntityWalkDepth(3 as any, 'entity', true)).toBe(0);
    expect(resolveEntityWalkDepth(-1 as any, 'entity', true)).toBe(0);
    expect(resolveEntityWalkDepth(NaN as any, 'entity', true)).toBe(0);
  });
});

