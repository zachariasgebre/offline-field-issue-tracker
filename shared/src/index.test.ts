import { describe, expect, it } from 'vitest';
import { canTransition, statuses, TRANSITIONS } from './index.js';

describe('status workflow', () => {
  it('allows only declared transitions', () => {
    for (const from of statuses) for (const to of statuses) expect(canTransition(from, to)).toBe(TRANSITIONS[from].includes(to));
  });
  it('keeps terminal states closed', () => { expect(TRANSITIONS.Resolved).toEqual([]); expect(TRANSITIONS.Rejected).toEqual([]); });
});
