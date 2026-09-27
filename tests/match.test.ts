import { describe, expect, it } from 'vitest';
import { FactEngine, createFactState } from '../src/core/facts';
import { MatchEngine, type MatchEvent, type MatchSetup } from '../src/core/match';
import { Rng } from '../src/core/rng';
import { TEAMS, getTeam, teamsInDivision, type TeamProfile } from '../src/core/teams';

const neutral: TeamProfile = {
  id: 'neutral',
  name: 'Neutral FC',
  style: 'Specialist Club',
  division: 1,
  shortPassAllowance: null,
  dribbleChainLength: 2,
  longBall: { enabled: true, difficulty: 'hard' },
  responseTimeLimitSec: 8,
  keeperStrength: 0.4,
  tableBias: [],
  turnoverPenalty: 'normal',
  scoutingReport: '',
  tacklesToWin: 1,
  colors: { primary: '#000', secondary: '#fff' },
};

function makeMatch(team: TeamProfile = neutral, extra: Partial<MatchSetup> = {}, seed = 1) {
  const facts = new FactEngine(createFactState(), new Rng(seed));
  const m = new MatchEngine({ team, facts, rng: new Rng(seed + 1000), ...extra });
  return { m, facts };
}

const right = (m: MatchEngine, ms = 1500) => m.answer(m.currentFact!.answer, ms);
const wrong = (m: MatchEngine, ms = 1500) => m.answer(m.currentFact!.answer + 1, ms);
const has = (events: MatchEvent[], type: MatchEvent['type']) => events.some((e) => e.type === type);

describe('MatchEngine actions', () => {
  it('kicks off with the player in possession in midfield', () => {
    const { m } = makeMatch();
    expect(m.possession).toBe('player');
    expect(m.zone).toBe(1);
    expect(m.phase).toBe('attack');
  });

  it('short pass: one easy fact, advances one zone', () => {
    const { m } = makeMatch();
    const q = m.chooseAction('short');
    expect(q.facts).toHaveLength(1);
    expect(q.difficulty).toBe('easy');
    const ev = right(m);
    expect(has(ev, 'advance')).toBe(true);
    expect(m.zone).toBe(2);
  });

  it('an error turns the ball over at the mirrored zone', () => {
    const { m } = makeMatch();
    m.chooseAction('short');
    const ev = wrong(m);
    expect(ev.find((e) => e.type === 'incorrect')).toBeTruthy();
    expect(m.possession).toBe('opponent');
    expect(m.zone).toBe(2); // Lost in our midfield (1) -> their attacking third (2).
    expect(m.phase).toBe('defend');
  });

  it('long ball: hard fact, advances two zones', () => {
    const { m } = makeMatch();
    const q = m.chooseAction('long');
    expect(q.difficulty).toBe('hard');
    right(m);
    expect(m.zone).toBe(3);
  });

  it('long ball error concedes possession in a dangerous area', () => {
    const { m } = makeMatch();
    m.chooseAction('short');
    right(m); // zone 2
    expect(m.availableActions().find((a) => a.id === 'long')!.enabled).toBe(false);
    const { m: m2 } = makeMatch();
    m2.chooseAction('long');
    const ev = wrong(m2);
    const t = ev.find((e) => e.type === 'turnover');
    expect(t && t.type === 'turnover' && t.zone).toBeGreaterThanOrEqual(2);
  });

  it('dribble: chain of N medium facts, beats a defender', () => {
    const { m } = makeMatch();
    const q = m.chooseAction('dribble');
    expect(q.facts).toHaveLength(2);
    expect(q.difficulty).toBe('medium');
    right(m);
    expect(m.phase).toBe('question');
    const ev = right(m);
    expect(has(ev, 'beat-defender')).toBe(true);
    expect(m.zone).toBe(2);
  });

  it('dribble fails if the chain runs over its total timer', () => {
    const { m } = makeMatch();
    const q = m.chooseAction('dribble');
    const total = q.chainLimitMs!;
    right(m, total * 0.7);
    const ev = right(m, total * 0.4); // Correct, but over the chain limit.
    expect(ev.find((e) => e.type === 'incorrect' && e.timedOut)).toBeTruthy();
    expect(m.possession).toBe('opponent');
  });

  it('shots are only available in the Attacking Third or Penalty Area', () => {
    const { m } = makeMatch();
    expect(m.availableActions().find((a) => a.id === 'shot')!.enabled).toBe(false);
    m.chooseAction('short');
    right(m);
    const shot = m.availableActions().find((a) => a.id === 'shot')!;
    expect(shot.enabled).toBe(true);
    const q = m.chooseAction('shot');
    expect(q.longRange).toBe(true);
  });

  it('shot probability depends on range, speed and keeper strength', () => {
    const prob = (team: TeamProfile, zoneSteps: number, ms: number) => {
      const { m } = makeMatch(team);
      for (let i = 0; i < zoneSteps; i++) {
        m.chooseAction('short');
        right(m);
      }
      m.chooseAction('shot');
      const ev = right(m, ms);
      const shot = ev.find((e) => e.type === 'shot');
      return shot && shot.type === 'shot' ? shot.probability : NaN;
    };
    const weakKeeper = { ...neutral, keeperStrength: 0.1 };
    const strongKeeper = { ...neutral, keeperStrength: 0.9 };
    expect(prob(neutral, 2, 1500)).toBeGreaterThan(prob(neutral, 1, 1500)); // In box beats long range.
    expect(prob(weakKeeper, 2, 1500)).toBeGreaterThan(prob(strongKeeper, 2, 1500));
    expect(prob(neutral, 2, 1000)).toBeGreaterThan(prob(neutral, 2, 7000)); // Fast beats slow.
  });

  it('a goal is scored and the opponent kicks off', () => {
    // Run many shots from the box with a feeble keeper until one goes in.
    for (let seed = 1; seed < 20; seed++) {
      const { m } = makeMatch({ ...neutral, keeperStrength: 0 }, {}, seed);
      m.chooseAction('long');
      right(m);
      m.chooseAction('shot');
      const ev = right(m, 500);
      if (has(ev, 'goal')) {
        expect(m.score.player).toBe(1);
        expect(m.possession).toBe('opponent');
        expect(m.zone).toBe(1);
        return;
      }
    }
    throw new Error('No goal in 20 attempts');
  });

  it('answers slower than the limit count as wrong', () => {
    const { m } = makeMatch();
    const q = m.chooseAction('short');
    const ev = right(m, q.perFactLimitMs! + 1);
    expect(ev.find((e) => e.type === 'incorrect' && e.timedOut)).toBeTruthy();
  });

  it('timeout() counts as an error', () => {
    const { m } = makeMatch();
    m.chooseAction('short');
    const ev = m.timeout();
    expect(has(ev, 'turnover')).toBe(true);
  });

  it('timers can be switched off', () => {
    const { m } = makeMatch(neutral, { timerScale: null });
    const q = m.chooseAction('short');
    expect(q.perFactLimitMs).toBeNull();
    right(m, 60_000);
    expect(m.zone).toBe(2);
  });
});

describe('Defensive phase', () => {
  function losePossession(m: MatchEngine) {
    m.chooseAction('short');
    wrong(m);
    expect(m.phase).toBe('defend');
  }

  it('offers tackle and intercept, and the opponent advances one zone per error', () => {
    const { m } = makeMatch();
    losePossession(m); // Opponent at zone 2.
    expect(m.availableActions().map((a) => a.id)).toEqual(['tackle', 'intercept']);
    m.chooseAction('tackle');
    const ev = wrong(m);
    expect(has(ev, 'opponent-advance')).toBe(true);
    expect(m.zone).toBe(3);
    expect(m.availableActions().map((a) => a.id)).toEqual(['save']);
  });

  it('a correct tackle wins the ball', () => {
    const { m } = makeMatch();
    losePossession(m);
    m.chooseAction('tackle');
    const ev = right(m);
    expect(has(ev, 'won-ball')).toBe(true);
    expect(m.possession).toBe('player');
    expect(m.zone).toBe(1);
  });

  it('an interception wins the ball one zone higher', () => {
    const { m } = makeMatch();
    losePossession(m);
    m.chooseAction('intercept');
    right(m);
    expect(m.zone).toBe(2);
  });

  it('a missed save concedes a goal and the player kicks off', () => {
    const { m } = makeMatch();
    losePossession(m);
    m.chooseAction('tackle');
    wrong(m);
    m.chooseAction('save');
    const ev = wrong(m);
    expect(ev.find((e) => e.type === 'goal' && e.side === 'opponent')).toBeTruthy();
    expect(m.score.opponent).toBe(1);
    expect(m.possession).toBe('player');
    expect(m.zone).toBe(1);
  });

  it('a successful save restarts from defence', () => {
    const { m } = makeMatch();
    losePossession(m);
    m.chooseAction('tackle');
    wrong(m);
    m.chooseAction('save');
    right(m);
    expect(m.possession).toBe('player');
    expect(m.zone).toBe(0);
  });
});

describe('Team archetype enforcement', () => {
  it('there are six archetypes in each of three divisions', () => {
    for (const d of [1, 2, 3]) {
      const styles = teamsInDivision(d).map((t) => t.style).sort();
      expect(styles).toEqual(
        ['High Press', 'Low Block', 'Offside Trap', 'Physical Defence', 'Possession Side', 'Specialist Club'],
      );
    }
    expect(TEAMS).toHaveLength(18);
  });

  it('Low Block: long ball disabled, unlimited short passes', () => {
    const { m } = makeMatch(getTeam('low-block-fc'));
    const long = m.availableActions().find((a) => a.id === 'long')!;
    expect(long.enabled).toBe(false);
    expect(long.note).toMatch(/disabled/);
    expect(() => m.chooseAction('long')).toThrow();
    for (let i = 0; i < 2; i++) {
      m.chooseAction('short');
      right(m);
      expect(m.availableActions().find((a) => a.id === 'short')!.pressed).toBeFalsy();
    }
  });

  it('High Press: presses after 2 short passes with a harder fact and shorter timer', () => {
    const team = getTeam('pressing-pandas');
    const { m } = makeMatch(team);
    const q1 = m.chooseAction('short');
    // Restart from our own Defence so there is room for a third pass.
    const { m: m2 } = makeMatch(team);
    m2.chooseAction('short');
    wrong(m2); // Opponent at 2
    m2.chooseAction('tackle');
    wrong(m2); // Opponent at 3
    m2.chooseAction('save');
    right(m2); // Player at 0
    m2.chooseAction('short');
    right(m2);
    m2.chooseAction('short');
    right(m2);
    const short = m2.availableActions().find((a) => a.id === 'short')!;
    expect(short.pressed).toBe(true);
    expect(short.difficulty).toBe('hard');
    const q3 = m2.chooseAction('short');
    expect(q3.perFactLimitMs!).toBeLessThan(q1.perFactLimitMs!);
    expect(team.responseTimeLimitSec).toBeLessThan(getTeam('offside-otters').responseTimeLimitSec);
  });

  it('High Press: a dribble beats the press', () => {
    const { m } = makeMatch(getTeam('pressing-pandas'));
    m.chooseAction('short');
    wrong(m);
    m.chooseAction('tackle');
    wrong(m);
    m.chooseAction('save');
    right(m);
    m.chooseAction('short');
    right(m);
    m.chooseAction('short');
    right(m);
    expect(m.pressed).toBe(true);
    m.chooseAction('dribble');
    right(m);
    right(m);
    expect(m.pressed).toBe(false);
  });

  it('Offside Trap: long ball allowed, errors concede a breakaway', () => {
    const { m } = makeMatch(getTeam('offside-otters'));
    expect(m.availableActions().find((a) => a.id === 'long')!.enabled).toBe(true);
    m.chooseAction('short');
    const ev = wrong(m);
    expect(ev.find((e) => e.type === 'turnover' && e.breakaway)).toBeTruthy();
    expect(m.zone).toBe(3);
    expect(m.availableActions().map((a) => a.id)).toEqual(['save']);
  });

  it('Physical Defence: dribbles require 3 or 4 chained facts', () => {
    expect(getTeam('tank-town-rovers').dribbleChainLength).toBe(3);
    expect(getTeam('granite-giants').dribbleChainLength).toBe(4);
    const { m } = makeMatch(getTeam('tank-town-rovers'));
    const q = m.chooseAction('dribble');
    expect(q.facts).toHaveLength(3);
    right(m);
    right(m);
    expect(m.phase).toBe('question');
    right(m);
    expect(m.zone).toBe(2);
  });

  it('Possession Side: keeps the ball well (2 tackles needed), generous passing timer', () => {
    const team = getTeam('tiki-taka-tortoises');
    const { m } = makeMatch(team);
    m.chooseAction('short');
    wrong(m);
    m.chooseAction('tackle');
    const ev = right(m);
    expect(ev.find((e) => e.type === 'tackle-progress')).toBeTruthy();
    expect(m.possession).toBe('opponent');
    m.chooseAction('tackle');
    right(m);
    expect(m.possession).toBe('player');
    expect(team.shortPassAllowance).toBeNull();
    expect(team.responseTimeLimitSec).toBeGreaterThanOrEqual(10);
  });

  it('Specialist Club: fact selection leans toward its table', () => {
    const share = (team: TeamProfile) => {
      const facts = new FactEngine(createFactState(), new Rng(5));
      // Make the whole first group familiar so every fact is available.
      for (const id of facts.groupFactIds(0)) {
        facts.recordAnswer(id, true, 4000);
        facts.recordAnswer(id, true, 4000);
      }
      const m = new MatchEngine({ team, facts, rng: new Rng(6), timerScale: null, division: 1 });
      let twos = 0;
      let total = 0;
      while (total < 150 && !m.isOver) {
        if (m.phase === 'halftime') m.startSecondHalf();
        const opt = m.availableActions().find((a) => a.enabled)!;
        m.chooseAction(opt.id);
        const f = m.currentFact!;
        total++;
        if (f.a === 2 || f.b === 2) twos++;
        right(m, 2000);
      }
      return twos / total;
    };
    expect(share(getTeam('two-town-terriers'))).toBeGreaterThan(share({ ...neutral, tableBias: [] }) + 0.1);
  });
});

describe('Clock, halves and anti-stalling', () => {
  it('the possession clock ends a stalled possession', () => {
    const { m } = makeMatch();
    const ev = m.tick(m.possessionClockLimitMs + 10);
    expect(ev.find((e) => e.type === 'turnover' && e.reason === 'possession-clock')).toBeTruthy();
    expect(m.possession).toBe('opponent');
  });

  it('time mode: two halves of the configured length', () => {
    const { m } = makeMatch(neutral, { halfLengthSec: 60, lengthMode: 'time' });
    // Keep the possession clock from firing by answering.
    let ev: MatchEvent[] = [];
    for (let t = 0; t < 60 && !has(ev, 'halftime'); t++) {
      if (m.phase === 'attack' || m.phase === 'defend') {
        m.chooseAction(m.availableActions().find((a) => a.enabled)!.id);
        right(m);
      }
      ev = m.tick(1000);
    }
    expect(m.phase).toBe('halftime');
    m.startSecondHalf();
    expect(m.half).toBe(2);
    expect(m.possession).toBe('opponent');
    for (let t = 0; t < 61 && !m.isOver; t++) {
      if (m.phase === 'attack' || m.phase === 'defend') {
        m.chooseAction(m.availableActions().find((a) => a.enabled)!.id);
        right(m);
      }
      m.tick(1000);
    }
    expect(m.isOver).toBe(true);
  });

  it('the clock never interrupts a question mid-answer', () => {
    const { m } = makeMatch(neutral, { halfLengthSec: 10 });
    m.chooseAction('short');
    expect(m.tick(20_000)).toEqual([]);
    expect(m.phase).toBe('question');
    const ev = right(m);
    expect(has(ev, 'halftime')).toBe(true);
  });

  it('possession mode: halves end after N player possessions', () => {
    const { m } = makeMatch(neutral, { lengthMode: 'possessions', possessionsPerHalf: 3 });
    let guard = 0;
    while (m.phase !== 'halftime' && guard++ < 100) {
      const id = m.availableActions().find((a) => a.enabled)!.id;
      m.chooseAction(id);
      // Lose every attacking possession, win every defensive one.
      if (m.possession === 'player') wrong(m);
      else right(m);
    }
    expect(m.phase).toBe('halftime');
    expect(m.playerPossessions).toBe(4);
  });
});

describe('Learning behaviour within a match', () => {
  it('facts answered incorrectly reappear within the same match', () => {
    const { m } = makeMatch(neutral, { timerScale: null });
    const missed = new Map<string, number>();
    const reappeared = new Set<string>();
    let n = 0;
    while (!m.isOver && n < 120) {
      if (m.phase === 'halftime') m.startSecondHalf();
      if (m.phase !== 'question') m.chooseAction(m.availableActions().find((a) => a.enabled)!.id);
      const f = m.currentFact!;
      if (missed.has(f.id)) reappeared.add(f.id);
      if (n % 5 === 0 && !missed.has(f.id)) {
        missed.set(f.id, n);
        wrong(m);
      } else right(m);
      n++;
      m.tick(1500);
    }
    expect(missed.size).toBeGreaterThan(3);
    expect(reappeared.size).toBe(missed.size);
  });

  it('shows the correct answer via the incorrect event', () => {
    const { m } = makeMatch();
    m.chooseAction('short');
    const f = m.currentFact!;
    const ev = m.answer(f.answer + 3, 1000);
    const inc = ev.find((e) => e.type === 'incorrect');
    expect(inc && inc.type === 'incorrect' && inc.fact.answer).toBe(f.a * f.b);
  });

  it('rubber-banding is bounded and follows accuracy', () => {
    const run = (accurate: boolean) => {
      const { m } = makeMatch(neutral, { timerScale: null });
      for (let i = 0; i < 30 && !m.isOver; i++) {
        if (m.phase === 'halftime') m.startSecondHalf();
        m.chooseAction(m.availableActions().find((a) => a.enabled)!.id);
        while (m.phase === 'question') (accurate ? right : wrong)(m);
      }
      return m.rubberBand;
    };
    const hi = run(true);
    const lo = run(false);
    expect(hi).toBeGreaterThan(0);
    expect(lo).toBeLessThan(0);
    expect(Math.abs(hi)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(lo)).toBeLessThanOrEqual(0.15);
  });

  it('matches replay deterministically from a seed', () => {
    const play = () => {
      const { m } = makeMatch(getTeam('offside-otters'), { halfLengthSec: 30 }, 77);
      const log: string[] = [];
      let i = 0;
      while (!m.isOver && i < 300) {
        if (m.phase === 'halftime') m.startSecondHalf();
        if (m.phase !== 'question') {
          const opts = m.availableActions().filter((a) => a.enabled);
          m.chooseAction(opts[i % opts.length].id);
        }
        const ev = i % 3 === 0 ? wrong(m) : right(m);
        log.push(ev.map((e) => e.type).join(','));
        m.tick(1000);
        i++;
      }
      return { log, report: m.report() };
    };
    const a = play();
    const b = play();
    expect(a.log).toEqual(b.log);
    expect(a.report.score).toEqual(b.report.score);
  });

  it('full-time report summarises the match', () => {
    const { m } = makeMatch(neutral, { halfLengthSec: 20 });
    let i = 0;
    while (!m.isOver && i++ < 200) {
      if (m.phase === 'halftime') m.startSecondHalf();
      if (m.phase !== 'question') m.chooseAction(m.availableActions().find((a) => a.enabled)!.id);
      if (i % 4 === 0) wrong(m, 2000);
      else right(m, 1000 + (i % 7) * 100);
      m.tick(1000);
    }
    const r = m.report();
    expect(r.answered).toBeGreaterThan(0);
    expect(r.accuracy).toBeCloseTo(r.correct / r.answered);
    expect(r.fastestFacts.length).toBeGreaterThan(0);
    expect(r.fastestFacts[0].ms).toBeLessThanOrEqual(r.fastestFacts[r.fastestFacts.length - 1].ms);
    expect(r.turnoverFacts.length).toBeGreaterThan(0);
    expect(r.possessionShare).toBeGreaterThan(0);
    expect(r.possessionShare).toBeLessThan(1);
  });
});
