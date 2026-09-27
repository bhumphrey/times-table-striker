import { describe, expect, it } from 'vitest';
import { simulate } from '../src/sim/simulate';

describe('50-match simulation with a scripted learner', () => {
  for (const seed of [2024, 7]) {
    it(`difficulty adapts to the learner (seed ${seed})`, () => {
      const r = simulate(seed);
      expect(r.matches).toHaveLength(50);
      for (const c of r.checks) expect(c.pass, `${c.name}: ${c.detail}`).toBe(true);
    });
  }

  it('is reproducible from its seed', () => {
    expect(simulate(11).matches).toEqual(simulate(11).matches);
  });
});
