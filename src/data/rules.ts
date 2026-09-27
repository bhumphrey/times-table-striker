/**
 * Tunable game rules. Everything a designer might want to adjust lives here,
 * separate from the engine code. See README "Tuning".
 */

export const FACT_RULES = {
  /** Largest factor. Facts run from 1 x 1 to MAX x MAX. */
  maxFactor: 12,
  /** How many recent attempts are kept per fact. */
  recentWindow: 5,
  /** Mastered: at least this many correct in the recent window... */
  masteryCorrectRequired: 4,
  /** ...and median correct response time below this (ms). */
  masteryMedianMs: 3000,
  /** Familiar: at least this many correct in the recent window, last attempt correct. */
  familiarCorrectRequired: 2,
  /** Familiar: and at least this share of recent attempts correct. */
  familiarAccuracy: 0.6,
  /** Table groups, introduced in order. A fact belongs to the group of its later-introduced factor. */
  tableGroups: [
    [1, 2, 5, 10],
    [3, 4, 9, 11],
    [6, 7, 8, 12],
  ] as number[][],
  /** A later group unlocks when this share of the previous group is Familiar or better. */
  unlockShare: 0.7,
  /** Maximum brand-new facts introduced per match. */
  maxNewFactsPerMatch: 2,
  /**
   * Bootstrapping: while fewer than this many facts have been seen in the
   * allowed pool, new facts can be introduced without using the per-match
   * budget (otherwise a brand-new learner would have nothing to practise).
   */
  minActivePool: 8,
  /** Chance that a medium/hard selection introduces a new fact when budget allows. */
  newFactChance: 0.2,
  /** Selections until an incorrectly answered fact must reappear (min, max). */
  relearnDelay: [2, 3] as [number, number],
  /** Review intervals, in selections, after a correct answer. */
  intervalLearning: 5,
  intervalFamiliar: 12,
  intervalMasteredMin: 24,
  intervalMasteredMax: 400,
  intervalGrowth: 2,
  /** Selection priority bonus given to a partner (b x a) when a x b becomes Mastered. */
  partnerBoost: 2,
  /** Weight multiplier for facts in a team's biased tables. */
  tableBiasWeight: 4,
};

export type FactRules = typeof FACT_RULES;

export const MATCH_RULES = {
  /** 'time' = halves of halfLengthSec; 'possessions' = halves of N possessions each. */
  defaultLengthMode: 'time' as 'time' | 'possessions',
  halfLengthSec: 180,
  possessionsPerHalf: 6,
  /** Anti-stalling: seconds a single attacking possession may last. */
  possessionClockSec: 30,
  /** Pressed short pass: timer multiplier (the fact is also drawn as "hard"). */
  pressedTimerFactor: 0.6,
  /** Dribble: total chain time = N x responseTimeLimit x this factor. */
  dribbleTimerFactor: 0.6,
  /** How long the correct answer is shown after an error (ms). */
  correctionDisplayMs: 1500,
  /** Shot model. Goal probability for a correct answer before modifiers. */
  shotBaseInBox: 0.5,
  shotBaseLongRange: 0.28,
  /** Keeper strength (0..1) subtracts up to this much. */
  keeperEffect: 0.45,
  /** Response-speed modifiers, as a share of the time limit used. */
  fastShotShare: 0.35,
  fastShotBonus: 0.1,
  slowShotShare: 0.75,
  slowShotPenalty: 0.15,
  /** Reference time used for shot speed when timers are switched off (ms). */
  untimedReferenceMs: 8000,
  shotMin: 0.05,
  shotMax: 0.9,
  /**
   * When the learner fails a save, the opponent scores with this probability
   * plus the rubber-band offset (so a struggling learner sees more misses).
   */
  opponentFinishing: 0.75,
  /** Hardness passed to FactEngine for shots (0..1, higher draws tougher facts). */
  longRangeShotHardness: 0.9,
  inBoxShotHardness: 0.3,
  longBallHardness: 0.6,
  /** Rubber-banding: opponent strength offset = clamp((accuracy - target) * gain). */
  rubberBandTarget: 0.75,
  rubberBandGain: 0.6,
  rubberBandLimit: 0.15,
  /** Minimum answers before rubber-banding starts reacting. */
  rubberBandMinAnswers: 4,
};

export type MatchRules = typeof MATCH_RULES;

export const LEAGUE_RULES = {
  /** Division 1 is the entry level; division 3 is the top. */
  divisionNames: ['Grassroots League', 'County League', 'Premier League'],
  /** Tables each division focuses on (index = division - 1). */
  divisionTables: [
    [1, 2, 5, 10],
    [3, 4, 9, 11],
    [6, 7, 8, 12],
  ] as number[][],
  pointsWin: 3,
  pointsDraw: 1,
  /** Promotion needs a top-N finish... */
  promotionPlaces: 2,
  /** ...and this share of the division's facts Mastered. */
  promotionMasteryShare: 0.7,
  relegationEnabled: false,
  relegationPlaces: 1,
  /** A table is "weak" if its accuracy is below this with enough attempts. */
  weakTableAccuracy: 0.7,
  weakTableMinAttempts: 6,
  /** Short passes above this share of build-up moves (short, long, dribble) = over-reliance. */
  shortPassRelianceShare: 0.7,
  /** Hard-fact actions (long ball, intercept, long-range shot) below this share = avoidance. */
  hardFactAvoidanceShare: 0.12,
  /** Recent matches used for the learner's play-style profile. */
  profileWindow: 3,
};

export type LeagueRules = typeof LEAGUE_RULES;
