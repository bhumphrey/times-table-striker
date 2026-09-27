import { describe, expect, it } from 'vitest';
import { FactEngine, createFactState } from '../src/core/facts';
import {
  LeagueManager,
  PLAYER_ID,
  createLeagueState,
  roundRobin,
} from '../src/core/league';
import type { ActionId, MatchReport } from '../src/core/match';
import { Rng } from '../src/core/rng';
import { getTeam, strengthIndex } from '../src/core/teams';

function setup(seed = 1, division = 1) {
  const facts = new FactEngine(createFactState(), new Rng(seed));
  const league = new LeagueManager(createLeagueState(seed, division), facts);
  return { facts, league };
}

function report(
  player: number,
  opponent: number,
  opts: { accuracy?: number; counts?: Partial<Record<ActionId, number>> } = {},
): MatchReport {
  const actionCounts = { short: 4, long: 2, dribble: 2, shot: 2, tackle: 3, intercept: 1, save: 1, ...opts.counts };
  return {
    teamId: 'x',
    score: { player, opponent },
    result: player > opponent ? 'win' : player < opponent ? 'loss' : 'draw',
    possessionShare: 0.5,
    answered: 20,
    correct: Math.round(20 * (opts.accuracy ?? 0.8)),
    accuracy: opts.accuracy ?? 0.8,
    averageMs: 2000,
    fastestFacts: [],
    turnoverFacts: [],
    newFacts: [],
    actionCounts,
    shots: actionCounts.shot,
    hardShare: 0.3,
    rubberBand: 0,
    answers: [],
  };
}

/** Make every fact in a group Mastered. */
function masterGroup(facts: FactEngine, group: number, share = 1) {
  const ids = facts.groupFactIds(group);
  ids.slice(0, Math.ceil(ids.length * share)).forEach((id) => {
    for (let i = 0; i < 4; i++) facts.recordAnswer(id, true, 1500);
  });
}

function playSeason(league: LeagueManager, score: (i: number) => [number, number]) {
  let i = 0;
  while (!league.season.complete) {
    const f = league.nextFixture()!;
    const [p, o] = score(i++);
    league.recordResult(f, report(p, o));
  }
}

describe('round robin', () => {
  it('every pair meets exactly once, one match per slot per round', () => {
    const slots = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const rounds = roundRobin(slots);
    expect(rounds).toHaveLength(7);
    const seen = new Set<string>();
    for (const r of rounds) {
      const inRound = r.flat();
      expect(new Set(inRound).size).toBe(8);
      for (const [a, b] of r) seen.add([a, b].sort().join('-'));
    }
    expect(seen.size).toBe(28);
  });
});

describe('LeagueManager season', () => {
  it('starts in division 1 with the learner and six clubs', () => {
    const { league } = setup();
    expect(league.division).toBe(1);
    expect(league.table()).toHaveLength(7);
    expect(league.remainingOpponents()).toHaveLength(6);
  });

  it('tracks standings: played, W/D/L, goals and points', () => {
    const { league } = setup();
    const f = league.nextFixture()!;
    league.recordResult(f, report(3, 1));
    const me = league.season.standings[PLAYER_ID];
    expect(me).toMatchObject({ played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 3, goalsAgainst: 1, points: 3 });
    const opp = league.season.standings[f.opponentId];
    expect(opp).toMatchObject({ played: 1, lost: 1, goalsFor: 1, goalsAgainst: 3, points: 0 });
    // The other clubs' round was simulated: 2 AI matches, one club rests.
    const played = league.table().filter((r) => r.played === 1).length;
    expect(played).toBe(6);
  });

  it('a season is six matches; afterwards every club has played six', () => {
    const { league } = setup();
    playSeason(league, () => [1, 1]);
    expect(league.season.complete).toBe(true);
    for (const row of league.table()) expect(row.played).toBe(6);
    const pts = league.table().reduce((s, r) => s + r.points, 0);
    const wins = league.table().reduce((s, r) => s + r.won, 0);
    const draws = league.table().reduce((s, r) => s + r.drawn, 0);
    expect(pts).toBe(wins * 3 + draws);
    expect(league.nextFixture()).toBeNull();
  });

  it('the pending fixture is stable until played', () => {
    const { league } = setup();
    expect(league.nextFixture()).toEqual(league.nextFixture());
  });
});

describe('Promotion and relegation', () => {
  it('promotion needs a top-two finish AND the mastery threshold', () => {
    const { league, facts } = setup();
    masterGroup(facts, 0);
    playSeason(league, () => [9, 0]);
    expect(league.position()).toBe(1);
    const outcome = league.startNextSeason();
    expect(outcome.kind).toBe('promoted');
    expect(league.division).toBe(2);
    expect(league.state.history).toHaveLength(1);
  });

  it('winning without mastery keeps the learner in the division', () => {
    const { league } = setup();
    playSeason(league, () => [9, 0]);
    const outcome = league.startNextSeason();
    expect(outcome.kind).toBe('stay-mastery');
    expect(outcome.message).toMatch(/70%/);
    expect(league.division).toBe(1);
  });

  it('mastery without a top-two finish is not enough', () => {
    const { league, facts } = setup();
    masterGroup(facts, 0);
    playSeason(league, () => [0, 9]);
    expect(league.startNextSeason().kind).toBe('stay');
  });

  it('relegation is off by default and configurable', () => {
    const a = setup(3, 2);
    playSeason(a.league, () => [0, 9]);
    expect(a.league.startNextSeason().kind).toBe('stay');
    expect(a.league.division).toBe(2);
    const b = setup(3, 2);
    playSeason(b.league, () => [0, 9]);
    expect(b.league.startNextSeason(true).kind).toBe('relegated');
    expect(b.league.division).toBe(1);
  });

  it('the top division crowns champions instead of promoting', () => {
    const { league, facts } = setup(4, 3);
    masterGroup(facts, 0);
    masterGroup(facts, 1);
    masterGroup(facts, 2);
    playSeason(league, () => [9, 0]);
    expect(league.startNextSeason().kind).toBe('champions');
    expect(league.division).toBe(3);
  });
});

describe('Adaptive scheduling', () => {
  it('the first fixture for a new learner is a gentle, form-matched opponent', () => {
    const { league } = setup();
    const f = league.nextFixture()!;
    expect(f.reason).toBe('form-match');
    const remaining = league.remainingOpponents().map(strengthIndex);
    expect(strengthIndex(getTeam(f.opponentId))).toBeLessThanOrEqual(
      remaining.reduce((a, b) => a + b, 0) / remaining.length,
    );
  });

  it('weak tables trigger a Specialist Club biased toward them', () => {
    const { league, facts } = setup();
    // The learner struggles with the 5 times table.
    for (const id of facts.groupFactIds(0)) {
      const [a, b] = id.split('x').map(Number);
      for (let i = 0; i < 3; i++) facts.recordAnswer(id, !(a === 5 || b === 5), 2000);
    }
    const first = league.nextFixture()!;
    league.recordResult(first, report(1, 0));
    const f = league.nextFixture()!;
    expect(f.reason).toBe('weak-tables');
    expect(getTeam(f.opponentId).style).toBe('Specialist Club');
    expect(f.tableBias).toContain(5);
    const scout = league.scoutingReport(f);
    expect(scout.summary).toMatch(/5 times table/);
    expect(league.matchTableBias(f)).toContain(5);
  });

  it('heavy reliance on short passes triggers a High Press opponent', () => {
    const { league } = setup();
    const first = league.nextFixture()!;
    league.recordResult(first, report(1, 0, { counts: { short: 20, long: 2, dribble: 1, shot: 3 } }));
    const f = league.nextFixture()!;
    expect(f.reason).toBe('short-pass-reliance');
    expect(getTeam(f.opponentId).style).toBe('High Press');
  });

  it('avoiding hard facts triggers a Low Block or Offside Trap opponent', () => {
    const { league } = setup();
    let first = league.nextFixture()!;
    // Make sure the first opponent allows the long ball so avoidance is measurable.
    if (!getTeam(first.opponentId).longBall.enabled) {
      league.recordResult(first, report(1, 1, { counts: { short: 3, dribble: 3, shot: 2, long: 0, intercept: 2 } }));
      first = league.nextFixture()!;
    }
    league.recordResult(first, report(1, 0, { counts: { short: 5, long: 0, dribble: 6, shot: 3, tackle: 6, intercept: 0 } }));
    const f = league.nextFixture()!;
    expect(f.reason).toBe('hard-fact-avoidance');
    expect(['Low Block', 'Offside Trap']).toContain(getTeam(f.opponentId).style);
  });

  it('better form draws a stronger opponent', () => {
    const strengthAfter = (accuracy: number) => {
      const { league } = setup(9);
      const first = league.nextFixture()!;
      league.recordResult(first, report(1, 1, { accuracy }));
      return strengthIndex(getTeam(league.nextFixture()!.opponentId));
    };
    expect(strengthAfter(0.95)).toBeGreaterThan(strengthAfter(0.5));
  });

  it('scouting reports state style and restricted actions', () => {
    const { league } = setup();
    const f = { round: 0, opponentId: 'low-block-fc', reason: 'form-match' as const, note: '' };
    const s = league.scoutingReport(f);
    expect(s.team.style).toBe('Low Block');
    expect(s.summary).toMatch(/long ball will not work/i);
    expect(s.rules).toContain('Long ball is switched off.');
  });
});
