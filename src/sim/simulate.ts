/**
 * Headless simulation: a scripted learner plays a series of league matches.
 * Used by scripts/simulate.ts and by the unit tests to check that opponent
 * difficulty tracks learner accuracy. No DOM code.
 */
import { FactEngine, createFactState } from '../core/facts';
import { LeagueManager, createLeagueState, type FixtureReason } from '../core/league';
import { MatchEngine, type ActionId } from '../core/match';
import { Rng } from '../core/rng';
import { strengthIndex } from '../core/teams';

export interface LearnerPhase {
  /** Number of matches in this phase. */
  matches: number;
  /** Probability of answering a fact correctly. */
  accuracy: number;
  /** Play style tweaks. */
  style?: 'balanced' | 'short-passer' | 'avoids-hard';
  label: string;
}

export interface SimMatch {
  index: number;
  phase: string;
  targetAccuracy: number;
  accuracy: number;
  division: number;
  opponent: string;
  style: string;
  reason: FixtureReason;
  strength: number;
  rubberBand: number;
  /** strength + rubber band: the effective opponent difficulty. */
  difficulty: number;
  score: string;
  hardShare: number;
  mastered: number;
}

export interface SimResult {
  matches: SimMatch[];
  correlation: { accuracyVsDifficulty: number; accuracyVsRubberBand: number };
  byPhase: { label: string; accuracy: number; difficulty: number; rubberBand: number }[];
  reasons: Record<string, number>;
  checks: { name: string; pass: boolean; detail: string }[];
}

export const DEFAULT_PHASES: LearnerPhase[] = [
  { matches: 10, accuracy: 0.55, label: 'struggling (55%)' },
  { matches: 10, accuracy: 0.75, style: 'short-passer', label: 'improving, short passer (75%)' },
  { matches: 10, accuracy: 0.95, label: 'fluent (95%)' },
  { matches: 10, accuracy: 0.85, style: 'avoids-hard', label: 'good, avoids hard facts (85%)' },
  { matches: 10, accuracy: 0.6, label: 'off form (60%)' },
];

export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

export function simulate(seed = 2024, phases: LearnerPhase[] = DEFAULT_PHASES): SimResult {
  const rng = new Rng(seed);
  const facts = new FactEngine(createFactState(), new Rng(seed + 1), undefined, () => 0);
  const league = new LeagueManager(createLeagueState(seed + 2), facts);
  const matches: SimMatch[] = [];
  let index = 0;

  for (const phase of phases) {
    for (let k = 0; k < phase.matches; k++) {
      if (league.season.complete) league.startNextSeason();
      const fixture = league.nextFixture()!;
      const engine = new MatchEngine({
        team: league.effectiveTeam(fixture),
        facts,
        rng: new Rng(rng.int(0, 2 ** 31)),
        division: league.division,
        tableBias: league.matchTableBias(fixture),
        halfLengthSec: 180,
      });

      let guard = 0;
      while (!engine.isOver && guard++ < 2000) {
        if (engine.phase === 'halftime') {
          engine.startSecondHalf();
          continue;
        }
        if (engine.phase === 'attack' || engine.phase === 'defend') {
          engine.chooseAction(chooseAction(engine, phase, rng));
          engine.tick(1500); // Time to pick a move.
          continue;
        }
        const f = engine.currentFact!;
        const correct = rng.chance(phase.accuracy);
        const ms = correct ? 1000 + rng.next() * 3000 * (1.2 - phase.accuracy) : 2500 + rng.next() * 3000;
        engine.answer(correct ? f.answer : f.answer + 1, ms);
        engine.tick(ms);
      }
      const report = engine.report();
      league.recordResult(fixture, report);
      const strength = strengthIndex(engine.team);
      matches.push({
        index: ++index,
        phase: phase.label,
        targetAccuracy: phase.accuracy,
        accuracy: report.accuracy,
        division: league.division,
        opponent: engine.team.name,
        style: engine.team.style,
        reason: fixture.reason,
        strength,
        rubberBand: report.rubberBand,
        difficulty: strength + report.rubberBand,
        score: `${report.score.player}-${report.score.opponent}`,
        hardShare: report.hardShare,
        mastered: facts.masteryCounts().mastered,
      });
    }
  }

  const acc = matches.map((m) => m.accuracy);
  const correlation = {
    accuracyVsDifficulty: pearson(acc, matches.map((m) => m.difficulty)),
    accuracyVsRubberBand: pearson(acc, matches.map((m) => m.rubberBand)),
  };
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const byPhase = phases.map((p) => {
    const ms = matches.filter((m) => m.phase === p.label);
    return {
      label: p.label,
      accuracy: avg(ms.map((m) => m.accuracy)),
      difficulty: avg(ms.map((m) => m.difficulty)),
      rubberBand: avg(ms.map((m) => m.rubberBand)),
    };
  });
  const reasons: Record<string, number> = {};
  for (const m of matches) reasons[m.reason] = (reasons[m.reason] ?? 0) + 1;

  const phaseOf = (label: string) => matches.filter((m) => m.phase === label);
  const shortPhase = phases.find((p) => p.style === 'short-passer');
  const avoidPhase = phases.find((p) => p.style === 'avoids-hard');
  const sorted = byPhase.slice().sort((a, b) => a.accuracy - b.accuracy);
  const checks = [
    {
      name: 'Rubber-banding tracks accuracy',
      pass: correlation.accuracyVsRubberBand > 0.7,
      detail: `r = ${correlation.accuracyVsRubberBand.toFixed(2)} (want > 0.7)`,
    },
    {
      name: 'Opponent difficulty tracks accuracy',
      pass: correlation.accuracyVsDifficulty > 0.4,
      detail: `r = ${correlation.accuracyVsDifficulty.toFixed(2)} (want > 0.4)`,
    },
    {
      name: 'Most accurate phase faces tougher opponents than least accurate',
      pass: sorted[sorted.length - 1].difficulty > sorted[0].difficulty,
      detail: `${sorted[sorted.length - 1].difficulty.toFixed(2)} vs ${sorted[0].difficulty.toFixed(2)}`,
    },
    {
      name: 'Short-pass reliance triggers High Press',
      pass: !shortPhase || phaseOf(shortPhase.label).some((m) => m.reason === 'short-pass-reliance'),
      detail: shortPhase ? `${phaseOf(shortPhase.label).filter((m) => m.reason === 'short-pass-reliance').length} fixture(s)` : 'n/a',
    },
    {
      name: 'Hard-fact avoidance triggers Low Block / Offside Trap',
      pass: !avoidPhase || phaseOf(avoidPhase.label).some((m) => m.reason === 'hard-fact-avoidance'),
      detail: avoidPhase ? `${phaseOf(avoidPhase.label).filter((m) => m.reason === 'hard-fact-avoidance').length} fixture(s)` : 'n/a',
    },
  ];
  return { matches, correlation, byPhase, reasons, checks };
}

function chooseAction(engine: MatchEngine, phase: LearnerPhase, rng: Rng): ActionId {
  const opts = engine.availableActions().filter((o) => o.enabled);
  const has = (id: ActionId) => opts.some((o) => o.id === id);
  if (engine.phase === 'defend') {
    if (has('save')) return 'save';
    if (phase.style === 'avoids-hard') return 'tackle';
    return rng.chance(0.25) ? 'intercept' : 'tackle';
  }
  if (has('shot') && (engine.zone === 3 || rng.chance(0.4))) return 'shot';
  if (phase.style === 'short-passer' && has('short')) return 'short';
  if (phase.style === 'avoids-hard') return has('short') && rng.chance(0.4) ? 'short' : 'dribble';
  const r = rng.next();
  if (r < 0.35 && has('short') && !engine.pressed) return 'short';
  if (r < 0.6 && has('long')) return 'long';
  if (has('dribble')) return 'dribble';
  return opts[0].id;
}
