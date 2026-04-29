import type { QueryIntent } from './intent.ts';

/**
 * Resolve entity-walk depth based on requested depth, intent, and rollout gate.
 *
 * Activation matrix lives in the tests; this function is the single source of truth.
 */
export function resolveEntityWalkDepth(
  requestedDepth: number | undefined,
  intent: QueryIntent,
  gateEnabled: boolean,
): 0 | 1 | 2 {
  if (!gateEnabled) return 0;

  if (requestedDepth === 0) return 0;
  if (requestedDepth === 1) return 1;
  if (requestedDepth === 2) return 2;
  if (requestedDepth !== undefined) return 0;

  if (intent === 'entity') return 1;
  return 0;
}

