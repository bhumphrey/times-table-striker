/**
 * MatchEngine: pitch zones, actions, possession, turnovers and the match clock.
 *
 * Pure state machine with no DOM code. The UI drives it by calling
 * chooseAction(), answer()/timeout() and tick(dtMs); each call returns the
 * MatchEvents that happened so the UI can animate, play sounds and narrate.
 *
 * Zones are always expressed from the perspective of the team in possession:
 * 0 Defence, 1 Midfield, 2 Attacking Third, 3 Penalty Area. When possession
 * changes, the zone is mirrored (3 - zone).
 */
import { MATCH_RULES, type MatchRules } from '../data/rules';
import type { Difficulty, FactEngine, Selection } from './facts';
import type { Rng } from './rng';
import type { TeamProfile } from './teams';

export type Zone = 0 | 1 | 2 | 3;
export const ZONE_NAMES = ['Defence', 'Midfield', 'Attacking Third', 'Penalty Area'] as const;

export type AttackAction = 'short' | 'long' | 'dribble' | 'shot';
export type DefendAction = 'tackle' | 'intercept' | 'save';
export type ActionId = AttackAction | DefendAction;
export type Side = 'player' | 'opponent';
export type Phase = 'attack' | 'defend' | 'question' | 'halftime' | 'fulltime';

export const ACTION_LABELS: Record<ActionId, string> = {
  short: 'Short pass',
  long: 'Long ball',
  dribble: 'Dribble',
  shot: 'Shoot',
  tackle: 'Tackle',
  intercept: 'Intercept',
  save: 'Save',
};

export interface ActionOption {
  id: ActionId;
  enabled: boolean;
  /** Why it is disabled, or a note such as "Pressed!". */
  note?: string;
  pressed?: boolean;
  /** Number of facts to answer. */
  facts: number;
  difficulty: Difficulty;
}

export interface Question {
  action: ActionId;
  side: Side;
  facts: Selection[];
  index: number;
  /** Time allowed for the current fact (ms), or null when timers are off. */
  perFactLimitMs: number | null;
  /** Dribble chain: total time for the whole chain (ms), or null. */
  chainLimitMs: number | null;
  chainElapsedMs: number;
  pressed: boolean;
  longRange: boolean;
  difficulty: Difficulty;
}

export type MatchEvent =
  | { type: 'kickoff'; side: Side }
  | { type: 'new-fact'; fact: Selection }
  | { type: 'correct'; fact: Selection; ms: number }
  | { type: 'incorrect'; fact: Selection; given: number | null; timedOut: boolean }
  | { type: 'advance'; action: ActionId; from: Zone; to: Zone }
  | { type: 'beat-defender' }
  | { type: 'pressed' }
  | { type: 'turnover'; zone: Zone; breakaway: boolean; reason: 'error' | 'possession-clock' | 'shot-saved' }
  | { type: 'shot'; longRange: boolean; probability: number; goal: boolean }
  | { type: 'goal'; side: Side }
  | { type: 'tackle-progress'; made: number; needed: number }
  | { type: 'won-ball'; action: DefendAction; zone: Zone }
  | { type: 'opponent-advance'; zone: Zone }
  | { type: 'save' }
  | { type: 'halftime' }
  | { type: 'fulltime' };

export interface AnswerLog {
  factId: string;
  a: number;
  b: number;
  correct: boolean;
  ms: number;
  action: ActionId;
  difficulty: Difficulty;
  turnover: boolean;
  isNew: boolean;
}

export interface MatchSetup {
  team: TeamProfile;
  facts: FactEngine;
  rng: Rng;
  /** Division being played (limits fact groups). */
  division?: number;
  /** Table bias override for this fixture (adaptive Specialist Club). */
  tableBias?: number[];
  /** Multiplier on response timers; null switches timers off. */
  timerScale?: number | null;
  lengthMode?: 'time' | 'possessions';
  halfLengthSec?: number;
  possessionsPerHalf?: number;
  rubberBand?: boolean;
  rules?: MatchRules;
}

export interface MatchReport {
  teamId: string;
  score: { player: number; opponent: number };
  result: 'win' | 'draw' | 'loss';
  possessionShare: number;
  answered: number;
  correct: number;
  accuracy: number;
  averageMs: number;
  fastestFacts: { factId: string; a: number; b: number; ms: number }[];
  turnoverFacts: { factId: string; a: number; b: number }[];
  newFacts: { factId: string; a: number; b: number }[];
  actionCounts: Record<ActionId, number>;
  shots: number;
  /** Share of answered facts that were drawn as "hard". */
  hardShare: number;
  /** Final rubber-band offset (-limit..+limit, positive = stronger opponent). */
  rubberBand: number;
  answers: AnswerLog[];
}

export class MatchEngine {
  readonly team: TeamProfile;
  readonly rules: MatchRules;
  readonly lengthMode: 'time' | 'possessions';
  readonly halfLengthMs: number;
  readonly possessionsPerHalf: number;

  phase: Phase = 'attack';
  possession: Side = 'player';
  zone: Zone = 1;
  half: 1 | 2 = 1;
  score = { player: 0, opponent: 0 };
  /** Elapsed time in the current half (ms). */
  clockMs = 0;
  /** Player possessions started this half (possessions mode). */
  playerPossessions = 1;
  /** Time spent in the current player possession (ms), for anti-stalling. */
  possessionClockMs = 0;
  shortPassStreak = 0;
  tacklesMade = 0;
  question: Question | null = null;
  private halfEnding = false;
  private possessionMs = { player: 0, opponent: 0 };
  private answers: AnswerLog[] = [];
  private actionCounts: Record<ActionId, number> = {
    short: 0, long: 0, dribble: 0, shot: 0, tackle: 0, intercept: 0, save: 0,
  };
  private shots = 0;
  private rb = 0;

  private readonly facts: FactEngine;
  private readonly rng: Rng;
  private readonly maxGroup: number | undefined;
  private readonly tableBias: number[];
  private readonly timerScale: number | null;
  private readonly useRubberBand: boolean;

  constructor(setup: MatchSetup) {
    this.team = setup.team;
    this.facts = setup.facts;
    this.rng = setup.rng;
    this.rules = setup.rules ?? MATCH_RULES;
    this.maxGroup = setup.division ? setup.division - 1 : undefined;
    this.tableBias = setup.tableBias ?? setup.team.tableBias;
    this.timerScale = setup.timerScale === undefined ? 1 : setup.timerScale;
    this.lengthMode = setup.lengthMode ?? this.rules.defaultLengthMode;
    this.halfLengthMs = (setup.halfLengthSec ?? this.rules.halfLengthSec) * 1000;
    this.possessionsPerHalf = setup.possessionsPerHalf ?? this.rules.possessionsPerHalf;
    this.useRubberBand = setup.rubberBand ?? true;
    this.facts.beginMatch();
  }

  /** Events to show at kick-off. */
  start(): MatchEvent[] {
    return [{ type: 'kickoff', side: 'player' }];
  }

  // ---- Derived parameters (with rubber-banding) -----------------------------

  get rubberBand(): number {
    return this.rb;
  }

  get keeperStrength(): number {
    return clamp(this.team.keeperStrength + this.rb, 0, 1);
  }

  /** Base per-fact time limit (ms) or null when timers are off. */
  get responseLimitMs(): number | null {
    if (this.timerScale === null) return null;
    return this.team.responseTimeLimitSec * 1000 * this.timerScale * (1 - this.rb);
  }

  get pressed(): boolean {
    const n = this.team.shortPassAllowance;
    return n !== null && this.shortPassStreak >= n;
  }

  get possessionClockLimitMs(): number {
    return this.rules.possessionClockSec * 1000;
  }

  // ---- Actions --------------------------------------------------------------

  availableActions(): ActionOption[] {
    const z = this.zone;
    if (this.phase === 'attack') {
      const longEnabled = this.team.longBall.enabled && z <= 1;
      return [
        {
          id: 'short',
          enabled: z < 3,
          facts: 1,
          difficulty: this.pressed ? 'hard' : 'easy',
          pressed: z < 3 && this.pressed,
          note: z >= 3 ? 'Already in the box' : this.pressed ? 'Pressed! Harder fact, less time' : undefined,
        },
        {
          id: 'long',
          enabled: longEnabled,
          facts: 1,
          difficulty: this.team.longBall.difficulty,
          note: !this.team.longBall.enabled
            ? `${this.team.style}: long ball disabled`
            : z > 1
              ? 'Too close to goal'
              : undefined,
        },
        {
          id: 'dribble',
          enabled: z < 3,
          facts: this.team.dribbleChainLength,
          difficulty: 'medium',
          note: z >= 3 ? 'Already in the box' : `${this.team.dribbleChainLength} facts in a row`,
        },
        {
          id: 'shot',
          enabled: z >= 2,
          facts: 1,
          difficulty: 'hard',
          note: z < 2 ? 'Get closer to goal first' : z === 2 ? 'Long range: tougher fact' : undefined,
        },
      ];
    }
    if (this.phase === 'defend') {
      if (z === 3) return [{ id: 'save', enabled: true, facts: 1, difficulty: 'medium' }];
      return [
        {
          id: 'tackle',
          enabled: true,
          facts: 1,
          difficulty: 'medium',
          note:
            this.team.tacklesToWin > 1
              ? `Tackles: ${this.tacklesMade}/${this.team.tacklesToWin}`
              : undefined,
        },
        { id: 'intercept', enabled: true, facts: 1, difficulty: 'hard', note: 'Win it higher up' },
      ];
    }
    return [];
  }

  chooseAction(action: ActionId): Question {
    const option = this.availableActions().find((o) => o.id === action);
    if (!option || !option.enabled) throw new Error(`Action ${action} not available in phase ${this.phase}`);
    this.actionCounts[action]++;
    const pressed = action === 'short' && this.pressed;
    const longRange = action === 'shot' && this.zone === 2;
    const base = this.responseLimitMs;
    let perFact = base;
    let chain: number | null = null;
    let hardness = 0;
    if (pressed && base !== null) perFact = base * this.rules.pressedTimerFactor;
    if (action === 'dribble' && base !== null) {
      chain = base * option.facts * this.rules.dribbleTimerFactor;
      perFact = chain;
    }
    if (action === 'shot') hardness = longRange ? this.rules.longRangeShotHardness : this.rules.inBoxShotHardness;
    if (action === 'long') hardness = this.rules.longBallHardness;

    const facts: Selection[] = [];
    for (let i = 0; i < option.facts; i++) {
      facts.push(
        this.facts.selectFact(option.difficulty, {
          tableBias: this.tableBias,
          maxGroup: this.maxGroup,
          hardness,
        }),
      );
    }
    this.question = {
      action,
      side: this.possession,
      facts,
      index: 0,
      perFactLimitMs: perFact,
      chainLimitMs: chain,
      chainElapsedMs: 0,
      pressed,
      longRange,
      difficulty: option.difficulty,
    };
    this.phase = 'question';
    return this.question;
  }

  /** The fact currently being asked. */
  get currentFact(): Selection | null {
    return this.question ? this.question.facts[this.question.index] : null;
  }

  /** Time remaining for the current fact (ms) from its start, or null if untimed. */
  get currentLimitMs(): number | null {
    const q = this.question;
    if (!q) return null;
    if (q.chainLimitMs !== null) return Math.max(0, q.chainLimitMs - q.chainElapsedMs);
    return q.perFactLimitMs;
  }

  timeout(): MatchEvent[] {
    const limit = this.currentLimitMs;
    return this.answer(null, limit ?? 0);
  }

  /**
   * Submit an answer to the current fact. `value` null means no answer (timeout).
   * `responseMs` is measured by the UI from when the fact was shown.
   */
  answer(value: number | null, responseMs: number): MatchEvent[] {
    const q = this.question;
    if (!q || this.phase !== 'question') throw new Error('No question pending');
    const fact = q.facts[q.index];
    const limit = this.currentLimitMs;
    const timedOut = value === null || (limit !== null && responseMs > limit);
    const correct = !timedOut && value === fact.answer;
    const events: MatchEvent[] = [];

    this.facts.recordAnswer(fact.id, correct, responseMs);
    this.answers.push({
      factId: fact.id,
      a: fact.a,
      b: fact.b,
      correct,
      ms: responseMs,
      action: q.action,
      difficulty: q.difficulty,
      turnover: false,
      isNew: fact.isNew,
    });
    this.updateRubberBand();

    if (!correct) {
      events.push({ type: 'incorrect', fact, given: value, timedOut });
      this.question = null;
      events.push(...this.resolveFailure(q));
      this.answers[this.answers.length - 1].turnover = events.some((e) => e.type === 'turnover');
    } else {
      events.push({ type: 'correct', fact, ms: responseMs });
      q.chainElapsedMs += responseMs;
      if (q.index + 1 < q.facts.length) {
        q.index++;
        return events; // Next fact in the dribble chain.
      }
      this.question = null;
      events.push(...this.resolveSuccess(q, responseMs));
    }
    events.push(...this.checkBoundaries());
    return events;
  }

  // ---- Resolution -----------------------------------------------------------

  private resolveSuccess(q: Question, lastMs: number): MatchEvent[] {
    const from = this.zone;
    switch (q.action) {
      case 'short':
      case 'long':
      case 'dribble': {
        const to = Math.min(3, from + (q.action === 'long' ? 2 : 1)) as Zone;
        this.zone = to;
        this.phase = 'attack';
        const events: MatchEvent[] = [{ type: 'advance', action: q.action, from, to }];
        if (q.action === 'short') {
          this.shortPassStreak++;
          if (this.pressed && this.zone < 3) events.push({ type: 'pressed' });
        } else {
          this.shortPassStreak = 0;
          if (q.action === 'dribble') events.push({ type: 'beat-defender' });
        }
        return events;
      }
      case 'shot': {
        this.shots++;
        const limit = q.perFactLimitMs ?? this.rules.untimedReferenceMs;
        const share = lastMs / limit;
        let p = q.longRange ? this.rules.shotBaseLongRange : this.rules.shotBaseInBox;
        p -= this.keeperStrength * this.rules.keeperEffect;
        if (share <= this.rules.fastShotShare) p += this.rules.fastShotBonus;
        if (share >= this.rules.slowShotShare) p -= this.rules.slowShotPenalty;
        p = clamp(p, this.rules.shotMin, this.rules.shotMax);
        const goal = this.rng.chance(p);
        const events: MatchEvent[] = [{ type: 'shot', longRange: q.longRange, probability: p, goal }];
        if (goal) {
          this.score.player++;
          events.push({ type: 'goal', side: 'player' });
          events.push(...this.kickoff('opponent'));
        } else {
          events.push({ type: 'turnover', zone: 0, breakaway: false, reason: 'shot-saved' });
          events.push(...this.giveBall('opponent', 0));
        }
        return events;
      }
      case 'tackle':
      case 'intercept': {
        this.tacklesMade++;
        if (q.action === 'tackle' && this.tacklesMade < this.team.tacklesToWin) {
          this.phase = 'defend';
          return [{ type: 'tackle-progress', made: this.tacklesMade, needed: this.team.tacklesToWin }];
        }
        // Tackles win the ball where it is (never straight into the box);
        // interceptions win it one zone further up the pitch.
        const mirror = 3 - this.zone;
        const zone = (q.action === 'intercept' ? Math.min(3, mirror + 1) : Math.min(2, mirror)) as Zone;
        return [{ type: 'won-ball', action: q.action, zone }, ...this.giveBall('player', zone)];
      }
      case 'save': {
        return [{ type: 'save' }, ...this.giveBall('player', 0)];
      }
    }
  }

  private resolveFailure(q: Question): MatchEvent[] {
    if (q.side === 'player') {
      const breakaway = this.team.turnoverPenalty === 'breakaway';
      const mirror = 3 - this.zone;
      let zone = mirror;
      if (q.action === 'long') zone = Math.max(mirror, 2); // Long-ball errors concede in a dangerous area.
      if (breakaway) zone = 3;
      return [
        { type: 'turnover', zone: zone as Zone, breakaway, reason: 'error' },
        ...this.giveBall('opponent', zone as Zone),
      ];
    }
    // Defending: the opponent advances one zone per error; an error on a save is a goal.
    if (q.action === 'save') {
      this.score.opponent++;
      return [{ type: 'goal', side: 'opponent' }, ...this.kickoff('player')];
    }
    this.zone = Math.min(3, this.zone + 1) as Zone;
    this.phase = 'defend';
    return [{ type: 'opponent-advance', zone: this.zone }];
  }

  private kickoff(side: Side): MatchEvent[] {
    return [{ type: 'kickoff', side }, ...this.giveBall(side, 1)];
  }

  private giveBall(side: Side, zone: Zone): MatchEvent[] {
    const changed = side !== this.possession;
    this.possession = side;
    this.zone = zone;
    this.phase = side === 'player' ? 'attack' : 'defend';
    this.shortPassStreak = 0;
    this.tacklesMade = 0;
    if (side === 'player') {
      this.possessionClockMs = 0;
      if (changed) this.playerPossessions++;
    }
    return [];
  }

  // ---- Clock ------------------------------------------------------------------

  /** Advance the match clock. Call while play is live (not during feedback overlays). */
  tick(dtMs: number): MatchEvent[] {
    if (this.phase === 'halftime' || this.phase === 'fulltime') return [];
    this.possessionMs[this.possession] += dtMs;
    if (this.lengthMode === 'time') {
      this.clockMs = Math.min(this.halfLengthMs, this.clockMs + dtMs);
      if (this.clockMs >= this.halfLengthMs) this.halfEnding = true;
    } else {
      this.clockMs += dtMs;
    }
    if (this.possession === 'player') this.possessionClockMs += dtMs;
    // Boundaries are applied between questions, never mid-answer.
    if (this.phase === 'question') return [];
    return this.checkBoundaries();
  }

  private checkBoundaries(): MatchEvent[] {
    if (this.phase === 'question' || this.phase === 'halftime' || this.phase === 'fulltime') return [];
    if (
      this.lengthMode === 'possessions' &&
      this.playerPossessions > this.possessionsPerHalf &&
      this.possession === 'player'
    ) {
      this.halfEnding = true;
    }
    if (this.halfEnding) return this.endHalf();
    if (
      this.phase === 'attack' &&
      this.possession === 'player' &&
      this.possessionClockMs >= this.possessionClockLimitMs
    ) {
      const zone = (3 - this.zone) as Zone;
      return [
        { type: 'turnover', zone, breakaway: false, reason: 'possession-clock' },
        ...this.giveBall('opponent', zone),
      ];
    }
    return [];
  }

  private endHalf(): MatchEvent[] {
    this.halfEnding = false;
    this.question = null;
    if (this.half === 1) {
      this.phase = 'halftime';
      return [{ type: 'halftime' }];
    }
    this.phase = 'fulltime';
    return [{ type: 'fulltime' }];
  }

  /** Start the second half after the half-time break. The opponent kicks off. */
  startSecondHalf(): MatchEvent[] {
    if (this.phase !== 'halftime') throw new Error('Not half-time');
    this.half = 2;
    this.clockMs = 0;
    this.playerPossessions = 0;
    const events = this.kickoff('opponent');
    return events;
  }

  get isOver(): boolean {
    return this.phase === 'fulltime';
  }

  // ---- Rubber-banding ---------------------------------------------------------

  private updateRubberBand(): void {
    if (!this.useRubberBand || this.answers.length < this.rules.rubberBandMinAnswers) return;
    const recent = this.answers.slice(-12);
    const acc = recent.filter((a) => a.correct).length / recent.length;
    this.rb = clamp(
      (acc - this.rules.rubberBandTarget) * this.rules.rubberBandGain,
      -this.rules.rubberBandLimit,
      this.rules.rubberBandLimit,
    );
  }

  // ---- Report -----------------------------------------------------------------

  report(): MatchReport {
    const correct = this.answers.filter((a) => a.correct);
    const totalPossession = this.possessionMs.player + this.possessionMs.opponent;
    const uniq = <T extends { factId: string }>(xs: T[]) =>
      xs.filter((x, i) => xs.findIndex((y) => y.factId === x.factId) === i);
    const { player, opponent } = this.score;
    return {
      teamId: this.team.id,
      score: { ...this.score },
      result: player > opponent ? 'win' : player < opponent ? 'loss' : 'draw',
      possessionShare: totalPossession ? this.possessionMs.player / totalPossession : 0.5,
      answered: this.answers.length,
      correct: correct.length,
      accuracy: this.answers.length ? correct.length / this.answers.length : 0,
      averageMs: correct.length ? correct.reduce((s, a) => s + a.ms, 0) / correct.length : 0,
      fastestFacts: uniq(correct.slice().sort((x, y) => x.ms - y.ms))
        .slice(0, 3)
        .map(({ factId, a, b, ms }) => ({ factId, a, b, ms })),
      turnoverFacts: uniq(this.answers.filter((a) => a.turnover)).map(({ factId, a, b }) => ({ factId, a, b })),
      newFacts: uniq(this.answers.filter((a) => a.isNew)).map(({ factId, a, b }) => ({ factId, a, b })),
      actionCounts: { ...this.actionCounts },
      shots: this.shots,
      hardShare: this.answers.length
        ? this.answers.filter((a) => a.difficulty === 'hard').length / this.answers.length
        : 0,
      rubberBand: this.rb,
      answers: this.answers.slice(),
    };
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
