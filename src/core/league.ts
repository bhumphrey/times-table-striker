/**
 * LeagueManager: divisions, fixtures, standings, promotion and adaptive
 * scheduling. No DOM code; state is plain JSON for storage.
 *
 * Each division has the learner plus six AI clubs (one per archetype). A
 * season is a single round robin generated with the circle method over eight
 * slots (learner, six clubs, and a "bye"), so every club plays six matches and
 * rests once. The learner's rounds can be played in any order: adaptive
 * scheduling picks the opponent, and the rest of that round is simulated.
 */
import { LEAGUE_RULES, type LeagueRules } from '../data/rules';
import type { FactEngine } from './facts';
import type { ActionId, MatchReport } from './match';
import { Rng } from './rng';
import {
  getTeam,
  restrictions,
  strengthIndex,
  teamsInDivision,
  type TeamProfile,
  type TeamStyle,
} from './teams';

export const PLAYER_ID = 'player';
const BYE = 'bye';

export interface StandingRow {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export interface Fixture {
  round: number;
  opponentId: string;
  /** Adaptive override for a Specialist Club's table bias. */
  tableBias?: number[];
  /** Why the scheduler chose this opponent (shown to adults / used in simulation). */
  reason: FixtureReason;
  note: string;
}

export type FixtureReason = 'weak-tables' | 'short-pass-reliance' | 'hard-fact-avoidance' | 'form-match';

export interface ResultRecord {
  round: number;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
}

export interface SeasonState {
  season: number;
  division: number;
  teamIds: string[];
  rounds: [string, string][][];
  playedRounds: number[];
  standings: Record<string, StandingRow>;
  results: ResultRecord[];
  pendingFixture: Fixture | null;
  complete: boolean;
}

export interface MatchSummary {
  teamId: string;
  style: TeamStyle;
  division: number;
  accuracy: number;
  actionCounts: Record<ActionId, number>;
  longBallAllowed: boolean;
  result: 'win' | 'draw' | 'loss';
  goalsFor: number;
  goalsAgainst: number;
  rubberBand: number;
  opponentStrength: number;
  reason: FixtureReason;
}

export interface SeasonHistory {
  season: number;
  division: number;
  position: number;
  outcome: SeasonOutcome['kind'];
}

export interface LeagueState {
  season: SeasonState;
  history: SeasonHistory[];
  recent: MatchSummary[];
  rngState: number;
}

export interface SeasonOutcome {
  kind: 'promoted' | 'champions' | 'stay' | 'stay-mastery' | 'relegated';
  position: number;
  masteryShare: number;
  nextDivision: number;
  message: string;
}

export interface LearnerProfile {
  matches: number;
  accuracy: number;
  shortPassShare: number;
  hardChoiceShare: number | null;
  weakTables: number[];
}

export function createLeagueState(seed: number, division = 1): LeagueState {
  return {
    season: newSeason(1, division),
    history: [],
    recent: [],
    rngState: seed >>> 0,
  };
}

function emptyRow(teamId: string): StandingRow {
  return { teamId, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
}

/** Circle-method round robin for an even number of slots. */
export function roundRobin(slots: string[]): [string, string][][] {
  const n = slots.length;
  const rotating = slots.slice(1);
  const rounds: [string, string][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const order = [slots[0], ...rotating];
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) pairs.push([order[i], order[n - 1 - i]]);
    rounds.push(pairs);
    rotating.unshift(rotating.pop()!);
  }
  return rounds;
}

function newSeason(season: number, division: number): SeasonState {
  const teamIds = teamsInDivision(division).map((t) => t.id);
  const all = [PLAYER_ID, ...teamIds];
  const standings: Record<string, StandingRow> = {};
  for (const id of all) standings[id] = emptyRow(id);
  return {
    season,
    division,
    teamIds,
    rounds: roundRobin([PLAYER_ID, ...teamIds, BYE]),
    playedRounds: [],
    standings,
    results: [],
    pendingFixture: null,
    complete: false,
  };
}

export class LeagueManager {
  readonly rules: LeagueRules;
  private rng: Rng;

  constructor(
    readonly state: LeagueState,
    private readonly facts: FactEngine,
    rules: LeagueRules = LEAGUE_RULES,
  ) {
    this.rules = rules;
    this.rng = new Rng(state.rngState);
  }

  private saveRng(): void {
    this.state.rngState = this.rng.state;
  }

  get season(): SeasonState {
    return this.state.season;
  }

  get division(): number {
    return this.state.season.division;
  }

  divisionName(division = this.division): string {
    return this.rules.divisionNames[division - 1] ?? `Division ${division}`;
  }

  /** Facts that count toward this division's mastery threshold. */
  divisionFactIds(division = this.division): string[] {
    return this.facts.groupFactIds(division - 1);
  }

  masteryShare(division = this.division): number {
    return this.facts.shareAtLeast(this.divisionFactIds(division), 'mastered');
  }

  // ---- Standings ------------------------------------------------------------

  table(): StandingRow[] {
    return Object.values(this.season.standings).sort(
      (a, b) =>
        b.points - a.points ||
        b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) ||
        b.goalsFor - a.goalsFor ||
        (a.teamId === PLAYER_ID ? -1 : b.teamId === PLAYER_ID ? 1 : a.teamId.localeCompare(b.teamId)),
    );
  }

  position(teamId = PLAYER_ID): number {
    return this.table().findIndex((r) => r.teamId === teamId) + 1;
  }

  private applyResult(home: string, away: string, hg: number, ag: number, round: number): void {
    const s = this.season.standings;
    const rows: [StandingRow, number, number][] = [
      [s[home], hg, ag],
      [s[away], ag, hg],
    ];
    for (const [row, f, a] of rows) {
      row.played++;
      row.goalsFor += f;
      row.goalsAgainst += a;
      if (f > a) {
        row.won++;
        row.points += this.rules.pointsWin;
      } else if (f === a) {
        row.drawn++;
        row.points += this.rules.pointsDraw;
      } else row.lost++;
    }
    this.season.results.push({ round, home, away, homeGoals: hg, awayGoals: ag });
  }

  // ---- Fixtures ----------------------------------------------------------------

  private roundAgainst(opponentId: string): number {
    return this.season.rounds.findIndex((pairs) =>
      pairs.some(([a, b]) => (a === PLAYER_ID && b === opponentId) || (b === PLAYER_ID && a === opponentId)),
    );
  }

  remainingOpponents(): TeamProfile[] {
    return this.season.teamIds
      .filter((id) => !this.season.playedRounds.includes(this.roundAgainst(id)))
      .map(getTeam);
  }

  /** Summary of the learner's recent play, used by adaptive scheduling. */
  learnerProfile(): LearnerProfile {
    const recent = this.state.recent.slice(-this.rules.profileWindow);
    let attack = 0;
    let short = 0;
    let hard = 0;
    let choices = 0;
    for (const m of recent) {
      const c = m.actionCounts;
      attack += c.short + c.long + c.dribble + c.shot;
      short += c.short;
      if (m.longBallAllowed) {
        hard += c.long + c.intercept;
        choices += c.short + c.long + c.dribble + c.tackle + c.intercept;
      }
    }
    const allowed = this.allowedTables();
    const weakTables = allowed
      .map((t) => ({ t, s: this.facts.tableStats(t) }))
      .filter(({ s }) => s.attempts >= this.rules.weakTableMinAttempts && s.recentAccuracy < this.rules.weakTableAccuracy)
      .sort((a, b) => a.s.recentAccuracy - b.s.recentAccuracy)
      .map(({ t }) => t);
    return {
      matches: recent.length,
      accuracy: recent.length ? recent.reduce((s, m) => s + m.accuracy, 0) / recent.length : 0.55,
      shortPassShare: attack ? short / attack : 0,
      hardChoiceShare: choices ? hard / choices : null,
      weakTables,
    };
  }

  /** Tables the learner can currently meet in this division. */
  allowedTables(): number[] {
    const groups = this.facts.rules.tableGroups;
    const n = Math.min(this.facts.unlockedGroupCount(), this.division);
    return groups.slice(0, n).flat().sort((a, b) => a - b);
  }

  /** The next fixture, generated adaptively from the learner profile. */
  nextFixture(): Fixture | null {
    if (this.season.complete) return null;
    if (this.season.pendingFixture) return this.season.pendingFixture;
    const remaining = this.remainingOpponents();
    if (remaining.length === 0) return null;
    const p = this.learnerProfile();
    const byStyle = (...styles: TeamStyle[]) => remaining.filter((t) => styles.includes(t.style));
    const make = (team: TeamProfile, reason: FixtureReason, note: string, tableBias?: number[]): Fixture => ({
      round: this.roundAgainst(team.id),
      opponentId: team.id,
      reason,
      note,
      tableBias,
    });

    let fixture: Fixture | null = null;
    if (p.matches > 0) {
      const specialist = byStyle('Specialist Club');
      const press = byStyle('High Press');
      const deep = byStyle('Low Block', 'Offside Trap');
      if (p.weakTables.length && specialist.length) {
        const bias = p.weakTables.slice(0, 2);
        fixture = make(
          specialist[0],
          'weak-tables',
          `Picked to practise the ${bias.join(' and ')} times table${bias.length > 1 ? 's' : ''}.`,
          bias,
        );
      } else if (p.shortPassShare > this.rules.shortPassRelianceShare && press.length) {
        fixture = make(press[0], 'short-pass-reliance', 'Picked because you rely on short passes.');
      } else if (p.hardChoiceShare !== null && p.hardChoiceShare < this.rules.hardFactAvoidanceShare && deep.length) {
        fixture = make(this.rng.pick(deep), 'hard-fact-avoidance', 'Picked to stretch you with tougher facts.');
      }
    }
    if (!fixture) {
      // Match opponent strength to recent accuracy: better form, tougher opponent.
      const strengths = remaining.map(strengthIndex);
      const all = teamsInDivision(this.division).map(strengthIndex);
      const lo = Math.min(...all);
      const hi = Math.max(...all);
      const form = Math.min(1, Math.max(0, (p.accuracy - 0.55) / 0.4));
      const target = lo + (hi - lo) * form;
      let best = 0;
      strengths.forEach((s, i) => {
        if (Math.abs(s - target) < Math.abs(strengths[best] - target)) best = i;
      });
      fixture = make(remaining[best], 'form-match', 'Picked to match your current form.');
    }
    this.season.pendingFixture = fixture;
    this.saveRng();
    return fixture;
  }

  /** Team profile with any fixture-specific overrides applied. */
  effectiveTeam(fixture: Fixture): TeamProfile {
    const team = getTeam(fixture.opponentId);
    return fixture.tableBias ? { ...team, tableBias: fixture.tableBias } : team;
  }

  /** Table bias for the match: the team's specialism, else the division's focus tables. */
  matchTableBias(fixture: Fixture): number[] {
    const team = this.effectiveTeam(fixture);
    if (team.tableBias.length) return team.tableBias;
    return this.division > 1 ? this.rules.divisionTables[this.division - 1] : [];
  }

  scoutingReport(fixture: Fixture): { team: TeamProfile; summary: string; rules: string[]; note: string } {
    const team = this.effectiveTeam(fixture);
    const summary =
      fixture.tableBias && team.style === 'Specialist Club'
        ? `Normal rules, but today they specialise in the ${fixture.tableBias.join(' and ')} times table${fixture.tableBias.length > 1 ? 's' : ''}.`
        : team.scoutingReport;
    return { team, summary, rules: restrictions(team), note: fixture.note };
  }

  // ---- Results -------------------------------------------------------------------

  private simulateAi(home: string, away: string, round: number): void {
    const sh = strengthIndex(getTeam(home));
    const sa = strengthIndex(getTeam(away));
    const goals = (lambda: number) => {
      // Poisson sample (Knuth).
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= this.rng.next();
      } while (p > L && k < 10);
      return k - 1;
    };
    const lh = Math.min(3, Math.max(0.3, 1.3 + (sh - sa) * 2));
    const la = Math.min(3, Math.max(0.3, 1.1 + (sa - sh) * 2));
    this.applyResult(home, away, goals(lh), goals(la), round);
  }

  private simulateRound(round: number, skipPlayer: boolean): void {
    for (const [a, b] of this.season.rounds[round]) {
      if (a === BYE || b === BYE) continue;
      if (skipPlayer && (a === PLAYER_ID || b === PLAYER_ID)) continue;
      this.simulateAi(a, b, round);
    }
    this.season.playedRounds.push(round);
  }

  /** Record the learner's match; simulates the rest of the round. */
  recordResult(fixture: Fixture, report: MatchReport): void {
    if (this.season.playedRounds.includes(fixture.round)) throw new Error('Round already played');
    const team = getTeam(fixture.opponentId);
    this.applyResult(PLAYER_ID, team.id, report.score.player, report.score.opponent, fixture.round);
    this.simulateRound(fixture.round, true);
    this.state.recent.push({
      teamId: team.id,
      style: team.style,
      division: this.division,
      accuracy: report.accuracy,
      actionCounts: { ...report.actionCounts },
      longBallAllowed: team.longBall.enabled,
      result: report.result,
      goalsFor: report.score.player,
      goalsAgainst: report.score.opponent,
      rubberBand: report.rubberBand,
      opponentStrength: strengthIndex(team),
      reason: fixture.reason,
    });
    if (this.state.recent.length > 20) this.state.recent.splice(0, this.state.recent.length - 20);
    this.season.pendingFixture = null;

    if (this.remainingOpponents().length === 0) {
      // Play the learner's rest round, then the season is over.
      const byeRound = this.season.rounds.findIndex(
        (pairs, i) => !this.season.playedRounds.includes(i) && pairs.some((p) => p.includes(PLAYER_ID) && p.includes(BYE)),
      );
      if (byeRound >= 0) this.simulateRound(byeRound, false);
      this.season.complete = true;
    }
    this.saveRng();
  }

  // ---- Season end --------------------------------------------------------------

  seasonOutcome(relegationEnabled = this.rules.relegationEnabled): SeasonOutcome {
    const position = this.position();
    const share = this.masteryShare();
    const d = this.division;
    const top = this.rules.divisionNames.length;
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const need = this.rules.promotionMasteryShare;
    const teams = this.season.teamIds.length + 1;
    if (position <= this.rules.promotionPlaces) {
      if (share >= need) {
        if (d >= top) {
          return {
            kind: 'champions', position, masteryShare: share, nextDivision: d,
            message: position === 1 ? `Champions of the ${this.divisionName()}!` : `Runners-up in the ${this.divisionName()}! Defend your place next season.`,
          };
        }
        return {
          kind: 'promoted', position, masteryShare: share, nextDivision: d + 1,
          message: `Promoted to the ${this.divisionName(d + 1)}!`,
        };
      }
      return {
        kind: 'stay-mastery', position, masteryShare: share, nextDivision: d,
        message: `A top-two finish, but promotion needs ${pct(need)} of this division's facts mastered (you have ${pct(share)}). Keep training!`,
      };
    }
    if (relegationEnabled && d > 1 && position > teams - this.rules.relegationPlaces) {
      return {
        kind: 'relegated', position, masteryShare: share, nextDivision: d - 1,
        message: `Relegated to the ${this.divisionName(d - 1)}. Bounce back!`,
      };
    }
    return {
      kind: 'stay', position, masteryShare: share, nextDivision: d,
      message: `Finished ${ordinal(position)}. Finish in the top ${this.rules.promotionPlaces} to go up.`,
    };
  }

  startNextSeason(relegationEnabled = this.rules.relegationEnabled): SeasonOutcome {
    if (!this.season.complete) throw new Error('Season not finished');
    const outcome = this.seasonOutcome(relegationEnabled);
    this.state.history.push({
      season: this.season.season,
      division: this.division,
      position: outcome.position,
      outcome: outcome.kind,
    });
    this.state.season = newSeason(this.season.season + 1, outcome.nextDivision);
    return outcome;
  }
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
