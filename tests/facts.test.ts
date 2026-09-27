import { describe, expect, it } from 'vitest';
import {
  FactEngine,
  computeMastery,
  createFactState,
  factId,
  parseFactId,
  type FactRecord,
} from '../src/core/facts';
import { Rng } from '../src/core/rng';
import { FACT_RULES } from '../src/data/rules';

const engine = (seed = 1) => new FactEngine(createFactState(), new Rng(seed), FACT_RULES, () => 1000);

/** Answer a fact n times with the given correctness and time. */
function drill(e: FactEngine, id: string, n: number, correct = true, ms = 1500) {
  for (let i = 0; i < n; i++) e.recordAnswer(id, correct, ms);
}

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const xs = Array.from({ length: 10 }, () => a.next());
    expect(Array.from({ length: 10 }, () => b.next())).toEqual(xs);
    expect(new Rng(43).next()).not.toEqual(xs[0]);
  });

  it('can resume from its state', () => {
    const a = new Rng(7);
    a.next();
    const b = new Rng(a.state);
    expect(b.next()).toEqual(a.next());
  });
});

describe('FactEngine structure', () => {
  it('tracks 144 facts, a x b and b x a separately', () => {
    const s = createFactState();
    expect(Object.keys(s.records)).toHaveLength(144);
    expect(s.records['3x7']).not.toBe(s.records['7x3']);
  });

  it('assigns a fact to the group of its later-introduced factor', () => {
    const e = engine();
    expect(e.groupOf(2, 5)).toBe(0);
    expect(e.groupOf(2, 3)).toBe(1);
    expect(e.groupOf(7, 2)).toBe(2);
    expect(e.groupFactIds(0)).toHaveLength(16);
    expect(e.groupFactIds(1)).toHaveLength(48);
    expect(e.groupFactIds(2)).toHaveLength(80);
  });
});

describe('Mastery transitions', () => {
  const rec = (attempts: [boolean, number][]): FactRecord => ({
    attempts: attempts.length,
    correct: attempts.filter((a) => a[0]).length,
    recent: attempts.slice(-5).map(([c, ms]) => ({ c, ms })),
    lastSeen: 0,
    state: 'unseen',
    due: 0,
    interval: 0,
    relearn: false,
    boost: 0,
  });

  it('Unseen with no attempts', () => {
    expect(computeMastery(rec([]))).toBe('unseen');
  });

  it('Learning after a single attempt or a recent error', () => {
    expect(computeMastery(rec([[true, 1000]]))).toBe('learning');
    expect(computeMastery(rec([[true, 1000], [true, 1000], [false, 1000]]))).toBe('learning');
  });

  it('Familiar after two correct with the last one correct', () => {
    expect(computeMastery(rec([[true, 5000], [true, 5000]]))).toBe('familiar');
  });

  it('Mastered needs 4 of the last 5 correct AND a fast median', () => {
    const fast: [boolean, number][] = [[true, 2000], [false, 9000], [true, 2500], [true, 1500], [true, 2900]];
    expect(computeMastery(rec(fast))).toBe('mastered');
    const slow: [boolean, number][] = [[true, 4000], [true, 4000], [true, 3500], [true, 3100], [true, 2000]];
    expect(computeMastery(rec(slow))).toBe('familiar');
    const inaccurate: [boolean, number][] = [[true, 1000], [false, 1000], [true, 1000], [false, 1000], [true, 1000]];
    expect(computeMastery(rec(inaccurate))).toBe('familiar');
  });

  it('only the last 5 attempts count', () => {
    const e = engine();
    drill(e, '2x2', 10, false);
    drill(e, '2x2', 5, true, 1000);
    expect(e.record('2x2').state).toBe('mastered');
    expect(e.record('2x2').recent).toHaveLength(5);
  });

  it('threshold is configurable', () => {
    const rules = { ...FACT_RULES, masteryMedianMs: 5000 };
    const r = rec([[true, 4000], [true, 4000], [true, 4000], [true, 4000]]);
    expect(computeMastery(r, rules)).toBe('mastered');
    expect(computeMastery(r)).toBe('familiar');
  });

  it('mastering a fact boosts its partner', () => {
    const e = engine();
    drill(e, '2x5', 4, true, 1000);
    expect(e.record('2x5').state).toBe('mastered');
    expect(e.record('5x2').boost).toBeGreaterThan(0);
    expect(e.record('2x2').boost).toBe(0);
  });
});

describe('selectFact', () => {
  it('starts a new learner on the foundational tables only', () => {
    const e = engine();
    e.beginMatch();
    for (let i = 0; i < 40; i++) {
      const f = e.selectFact('medium');
      expect(e.groupOf(f.a, f.b)).toBe(0);
      e.recordAnswer(f.id, true, 2000);
    }
  });

  it('introduces at most 2 new facts per match once the starter pool exists', () => {
    const e = engine(3);
    e.beginMatch();
    // Build the starter pool.
    for (let i = 0; i < 60; i++) {
      const f = e.selectFact('hard');
      e.recordAnswer(f.id, true, 2000);
    }
    const seenBefore = e.masteryCounts().unseen;
    e.beginMatch();
    let newCount = 0;
    for (let i = 0; i < 100; i++) {
      const f = e.selectFact('hard');
      if (f.isNew) newCount++;
      e.recordAnswer(f.id, true, 2000);
    }
    expect(newCount).toBeLessThanOrEqual(2);
    expect(seenBefore - e.masteryCounts().unseen).toBe(newCount);
  });

  it('easy draws from Familiar/Mastered and hard from Learning', () => {
    const e = engine(5);
    // Hand-craft states: 2x2 mastered, 5x5 familiar, 10x10/1x1 learning.
    drill(e, '2x2', 4, true, 1000);
    drill(e, '5x5', 2, true, 5000);
    drill(e, '10x10', 1, false);
    drill(e, '1x1', 1, true);
    drill(e, '1x2', 2, true, 5000);
    drill(e, '2x1', 1, true, 5000);
    drill(e, '1x5', 2, true, 5000);
    drill(e, '5x1', 2, true, 5000);
    e.state.tick = 100; // Nothing pending relearn.
    e.record('10x10').relearn = false;
    e.beginMatch();
    const noNew = { ...FACT_RULES, maxNewFactsPerMatch: 0, minActivePool: 0 };
    const e2 = new FactEngine(e.state, new Rng(9), noNew);
    for (let i = 0; i < 30; i++) {
      const easy = e2.selectFact('easy');
      expect(['familiar', 'mastered']).toContain(easy.state);
      const hard = e2.selectFact('hard');
      expect(hard.state).toBe('learning');
    }
  });

  it('brings an incorrectly answered fact back within a few selections', () => {
    const e = engine(11);
    e.beginMatch();
    for (let i = 0; i < 30; i++) e.recordAnswer(e.selectFact('medium').id, true, 1500);
    const missed = e.selectFact('easy');
    e.recordAnswer(missed.id, false, 4000);
    const next = [1, 2, 3, 4].map(() => {
      const f = e.selectFact('easy');
      e.recordAnswer(f.id, true, 1500);
      return f.id;
    });
    expect(next).toContain(missed.id);
  });

  it('never repeats the same fact twice in a row when alternatives exist', () => {
    const e = engine(13);
    e.beginMatch();
    let last = '';
    for (let i = 0; i < 80; i++) {
      const f = e.selectFact('medium');
      expect(f.id).not.toBe(last);
      last = f.id;
      e.recordAnswer(f.id, i % 4 !== 0, 1800);
    }
  });

  it('mastered facts resurface at increasing intervals', () => {
    const e = engine();
    drill(e, '2x2', 4, true, 1000);
    const first = e.record('2x2').interval;
    drill(e, '2x2', 1, true, 1000);
    const second = e.record('2x2').interval;
    drill(e, '2x2', 1, true, 1000);
    const third = e.record('2x2').interval;
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it('unlocks the next group when most of the previous one is Familiar', () => {
    const e = engine();
    expect(e.unlockedGroupCount()).toBe(1);
    const g0 = e.groupFactIds(0);
    g0.slice(0, Math.ceil(g0.length * 0.7)).forEach((id) => drill(e, id, 2, true, 4000));
    expect(e.unlockedGroupCount()).toBe(2);
    expect(e.unlockedTables()).toEqual([1, 2, 5, 10, 3, 4, 9, 11]);
  });

  it('respects maxGroup', () => {
    const e = engine();
    e.groupFactIds(0).forEach((id) => drill(e, id, 2, true, 4000));
    e.beginMatch();
    for (let i = 0; i < 50; i++) {
      const f = e.selectFact('hard', { maxGroup: 0 });
      expect(e.groupOf(f.a, f.b)).toBe(0);
      e.recordAnswer(f.id, false, 4000);
    }
  });

  it('table bias weights selection toward the chosen table', () => {
    const count = (bias: number[]) => {
      const e = engine(21);
      e.groupFactIds(0).forEach((id) => drill(e, id, 2, true, 4000));
      e.beginMatch();
      let fives = 0;
      for (let i = 0; i < 200; i++) {
        const f = e.selectFact('easy', { tableBias: bias });
        if (f.a === 5 || f.b === 5) fives++;
        e.recordAnswer(f.id, true, 4000);
      }
      return fives;
    };
    expect(count([5])).toBeGreaterThan(count([]) * 1.3);
  });

  it('is deterministic for a seed', () => {
    const run = () => {
      const e = engine(99);
      e.beginMatch();
      return Array.from({ length: 30 }, (_, i) => {
        const f = e.selectFact(i % 2 ? 'hard' : 'easy');
        e.recordAnswer(f.id, i % 3 !== 0, 2000);
        return f.id;
      });
    };
    expect(run()).toEqual(run());
  });

  it('parseFactId round-trips', () => {
    expect(parseFactId(factId(7, 8))).toEqual({ id: '7x8', a: 7, b: 8, answer: 56 });
  });
});
