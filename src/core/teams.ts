/**
 * TeamProfiles: typed access to the opponent data in src/data/teams.json.
 * The data is the source of truth; this module only validates and describes it.
 */
import rawTeams from '../data/teams.json';
import type { Difficulty } from './facts';

export type TeamStyle =
  | 'Low Block'
  | 'High Press'
  | 'Offside Trap'
  | 'Physical Defence'
  | 'Possession Side'
  | 'Specialist Club';

export const TEAM_STYLES: TeamStyle[] = [
  'Low Block',
  'High Press',
  'Offside Trap',
  'Physical Defence',
  'Possession Side',
  'Specialist Club',
];

export interface TeamProfile {
  id: string;
  name: string;
  style: TeamStyle;
  division: number;
  /** null = unlimited; integer = the opponent presses after N consecutive short passes. */
  shortPassAllowance: number | null;
  dribbleChainLength: number;
  longBall: { enabled: boolean; difficulty: Difficulty };
  responseTimeLimitSec: number;
  /** 0.0 to 1.0 */
  keeperStrength: number;
  tableBias: number[];
  turnoverPenalty: 'normal' | 'breakaway';
  scoutingReport: string;
  /** Extension: correct defensive answers needed to win the ball back in one spell. */
  tacklesToWin: number;
  /** Extension: kit colours for the pitch renderer. */
  colors: { primary: string; secondary: string };
}

export function validateTeam(t: TeamProfile): string[] {
  const errors: string[] = [];
  if (!TEAM_STYLES.includes(t.style)) errors.push(`${t.id}: unknown style ${t.style}`);
  if (t.shortPassAllowance !== null && (!Number.isInteger(t.shortPassAllowance) || t.shortPassAllowance < 1))
    errors.push(`${t.id}: shortPassAllowance must be null or a positive integer`);
  if (!Number.isInteger(t.dribbleChainLength) || t.dribbleChainLength < 1)
    errors.push(`${t.id}: dribbleChainLength must be a positive integer`);
  if (t.keeperStrength < 0 || t.keeperStrength > 1) errors.push(`${t.id}: keeperStrength out of range`);
  if (t.responseTimeLimitSec <= 0) errors.push(`${t.id}: responseTimeLimitSec must be positive`);
  if (!['normal', 'breakaway'].includes(t.turnoverPenalty)) errors.push(`${t.id}: bad turnoverPenalty`);
  if (!Number.isInteger(t.tacklesToWin) || t.tacklesToWin < 1) errors.push(`${t.id}: bad tacklesToWin`);
  if (t.tableBias.some((n) => !Number.isInteger(n) || n < 1 || n > 12)) errors.push(`${t.id}: bad tableBias`);
  return errors;
}

export const TEAMS: TeamProfile[] = rawTeams as TeamProfile[];

{
  const problems = TEAMS.flatMap(validateTeam);
  if (problems.length) throw new Error(`Invalid team data:\n${problems.join('\n')}`);
}

export function getTeam(id: string): TeamProfile {
  const t = TEAMS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown team ${id}`);
  return t;
}

export function teamsInDivision(division: number): TeamProfile[] {
  return TEAMS.filter((t) => t.division === division);
}

/** Rough 0..1 strength index used for AI-vs-AI results and fixture matching. */
export function strengthIndex(t: TeamProfile): number {
  const timer = Math.min(1, Math.max(0, (12 - t.responseTimeLimitSec) / 7));
  const press = t.shortPassAllowance === null ? 0 : 1 / t.shortPassAllowance;
  const s =
    0.35 * timer +
    0.3 * t.keeperStrength +
    0.1 * (t.tacklesToWin - 1) +
    0.05 * (t.dribbleChainLength - 2) +
    0.1 * press +
    0.1 * (t.turnoverPenalty === 'breakaway' ? 1 : 0);
  return Math.min(1, Math.max(0, s));
}

/** Short, child-readable list of rule changes shown on the scouting report. */
export function restrictions(t: TeamProfile): string[] {
  const out: string[] = [];
  if (!t.longBall.enabled) out.push('Long ball is switched off.');
  if (t.shortPassAllowance !== null)
    out.push(`They press after ${t.shortPassAllowance} short passes in a row.`);
  if (t.dribbleChainLength !== 2) out.push(`Dribbles need ${t.dribbleChainLength} facts in a row.`);
  if (t.turnoverPenalty === 'breakaway') out.push('Any mistake on the ball gives them a breakaway.');
  if (t.tacklesToWin > 1) out.push(`You need ${t.tacklesToWin} tackles to win the ball back.`);
  if (t.tableBias.length) out.push(`They specialise in the ${t.tableBias.join(', ')} times table.`);
  out.push(`Answer clock: ${t.responseTimeLimitSec} seconds.`);
  return out;
}
