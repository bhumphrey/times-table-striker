/**
 * FactEngine: fact selection, fluency tracking and spaced repetition for the
 * 144 multiplication facts. No DOM code; all state is plain JSON.
 */
import { FACT_RULES, type FactRules } from '../data/rules';
import type { Rng } from './rng';

export type Mastery = 'unseen' | 'learning' | 'familiar' | 'mastered';
export type Difficulty = 'easy' | 'medium' | 'hard';

export const MASTERY_ORDER: Mastery[] = ['unseen', 'learning', 'familiar', 'mastered'];

export interface Attempt {
  /** correct */
  c: boolean;
  /** response time in ms */
  ms: number;
}

export interface FactRecord {
  attempts: number;
  correct: number;
  /** Last N attempts, oldest first. */
  recent: Attempt[];
  /** Epoch ms of the last attempt, or null if never seen. */
  lastSeen: number | null;
  state: Mastery;
  /** Selection tick at which this fact is next due for review. */
  due: number;
  /** Current review interval in selections. */
  interval: number;
  /** Answered incorrectly and must reappear soon. */
  relearn: boolean;
  /** Extra selection priority (from a mastered partner fact). */
  boost: number;
}

export interface FactState {
  /** Number of selections made so far; the spaced-repetition clock. */
  tick: number;
  records: Record<string, FactRecord>;
}

export interface Fact {
  id: string;
  a: number;
  b: number;
  answer: number;
}

export interface Selection extends Fact {
  isNew: boolean;
  state: Mastery;
}

export interface SelectOptions {
  /** Weight selection toward these tables (a team's specialism). */
  tableBias?: readonly number[];
  /** 0..1: prefer larger / less accurate facts within the pool. */
  hardness?: number;
  /** Highest table group (0-based) allowed, e.g. to keep a division on its tables. */
  maxGroup?: number;
}

export interface AnswerOutcome {
  previous: Mastery;
  state: Mastery;
}

export const factId = (a: number, b: number): string => `${a}x${b}`;

export function parseFactId(id: string): Fact {
  const [a, b] = id.split('x').map(Number);
  return { id, a, b, answer: a * b };
}

export function median(values: number[]): number {
  if (values.length === 0) return Infinity;
  const s = values.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function createFactState(rules: FactRules = FACT_RULES): FactState {
  const records: Record<string, FactRecord> = {};
  for (let a = 1; a <= rules.maxFactor; a++) {
    for (let b = 1; b <= rules.maxFactor; b++) {
      records[factId(a, b)] = {
        attempts: 0,
        correct: 0,
        recent: [],
        lastSeen: null,
        state: 'unseen',
        due: 0,
        interval: 0,
        relearn: false,
        boost: 0,
      };
    }
  }
  return { tick: 0, records };
}

/** Mastery state implied by a record's recent history. */
export function computeMastery(r: FactRecord, rules: FactRules = FACT_RULES): Mastery {
  if (r.attempts === 0) return 'unseen';
  const recentCorrect = r.recent.filter((x) => x.c);
  const correctTimes = recentCorrect.map((x) => x.ms);
  if (
    recentCorrect.length >= rules.masteryCorrectRequired &&
    median(correctTimes) < rules.masteryMedianMs
  ) {
    return 'mastered';
  }
  const last = r.recent[r.recent.length - 1];
  if (
    last?.c &&
    recentCorrect.length >= rules.familiarCorrectRequired &&
    recentCorrect.length / r.recent.length >= rules.familiarAccuracy
  ) {
    return 'familiar';
  }
  return 'learning';
}

export class FactEngine {
  readonly rules: FactRules;
  private newThisMatch = 0;
  private lastId: string | null = null;
  private readonly groupIndexOf: Map<number, number>;

  constructor(
    readonly state: FactState,
    private readonly rng: Rng,
    rules: FactRules = FACT_RULES,
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.rules = rules;
    this.groupIndexOf = new Map();
    rules.tableGroups.forEach((g, i) => g.forEach((t) => this.groupIndexOf.set(t, i)));
  }

  // ---- Structure -----------------------------------------------------------

  /** A fact belongs to the group of its later-introduced factor. */
  groupOf(a: number, b: number): number {
    return Math.max(this.groupIndexOf.get(a) ?? 0, this.groupIndexOf.get(b) ?? 0);
  }

  allFacts(): Fact[] {
    return Object.keys(this.state.records).map(parseFactId);
  }

  groupFactIds(group: number): string[] {
    return this.allFacts()
      .filter((f) => this.groupOf(f.a, f.b) === group)
      .map((f) => f.id);
  }

  /** Facts involving the given table (either factor). */
  tableFactIds(table: number): string[] {
    return this.allFacts()
      .filter((f) => f.a === table || f.b === table)
      .map((f) => f.id);
  }

  record(id: string): FactRecord {
    const r = this.state.records[id];
    if (!r) throw new Error(`Unknown fact ${id}`);
    return r;
  }

  /** Share of the given facts at or above a mastery level. */
  shareAtLeast(ids: string[], level: Mastery): number {
    if (ids.length === 0) return 0;
    const min = MASTERY_ORDER.indexOf(level);
    const n = ids.filter((id) => MASTERY_ORDER.indexOf(this.record(id).state) >= min).length;
    return n / ids.length;
  }

  /** Number of table groups currently unlocked (1..groups). */
  unlockedGroupCount(): number {
    let count = 1;
    for (let g = 0; g < this.rules.tableGroups.length - 1; g++) {
      if (this.shareAtLeast(this.groupFactIds(g), 'familiar') >= this.rules.unlockShare) count++;
      else break;
    }
    return count;
  }

  unlockedTables(): number[] {
    return this.rules.tableGroups.slice(0, this.unlockedGroupCount()).flat();
  }

  masteryCounts(ids: string[] = Object.keys(this.state.records)): Record<Mastery, number> {
    const counts: Record<Mastery, number> = { unseen: 0, learning: 0, familiar: 0, mastered: 0 };
    for (const id of ids) counts[this.record(id).state]++;
    return counts;
  }

  /** Aggregate stats for one table, used for weak-table detection. */
  tableStats(table: number): { attempts: number; accuracy: number; recentAccuracy: number } {
    let attempts = 0;
    let correct = 0;
    let recentN = 0;
    let recentC = 0;
    for (const id of this.tableFactIds(table)) {
      const r = this.record(id);
      attempts += r.attempts;
      correct += r.correct;
      recentN += r.recent.length;
      recentC += r.recent.filter((x) => x.c).length;
    }
    return {
      attempts,
      accuracy: attempts ? correct / attempts : 0,
      recentAccuracy: recentN ? recentC / recentN : 0,
    };
  }

  // ---- Selection -----------------------------------------------------------

  /** Reset the per-match new-fact budget. Call at kick-off. */
  beginMatch(): void {
    this.newThisMatch = 0;
    this.lastId = null;
  }

  get newFactsThisMatch(): number {
    return this.newThisMatch;
  }

  selectFact(difficulty: Difficulty, opts: SelectOptions = {}): Selection {
    const tick = ++this.state.tick;
    const maxGroup = Math.min(this.unlockedGroupCount() - 1, opts.maxGroup ?? Infinity);
    const allowed = this.allFacts().filter((f) => this.groupOf(f.a, f.b) <= maxGroup);
    const seen = allowed.filter((f) => this.record(f.id).state !== 'unseen');
    const bias = opts.tableBias ?? [];
    const inBias = (f: Fact) => bias.includes(f.a) || bias.includes(f.b);

    // 1. Facts answered incorrectly come back within a few selections, whatever the difficulty.
    const relearn = seen
      .filter((f) => f.id !== this.lastId)
      .map((f) => ({ f, r: this.record(f.id) }))
      .filter(({ r }) => r.relearn && r.due <= tick)
      .sort((x, y) => x.r.due - y.r.due);
    if (relearn.length > 0) return this.finish(relearn[0].f, false);

    // 2. Build the difficulty pool.
    const byState = (states: Mastery[]) =>
      seen.filter((f) => states.includes(this.record(f.id).state));
    const easyPool = byState(['mastered', 'familiar']);
    const hardPool = byState(['learning']);
    let pool: Fact[];
    if (difficulty === 'easy') pool = easyPool.length ? easyPool : hardPool;
    else if (difficulty === 'hard') pool = hardPool.length ? hardPool : easyPool;
    else {
      const first = this.rng.chance(0.5) ? easyPool : hardPool;
      pool = first.length ? first : easyPool.length ? easyPool : hardPool;
    }

    // Avoid asking the same fact twice in a row: widen to any seen fact if needed.
    pool = pool.filter((f) => f.id !== this.lastId);
    if (pool.length === 0) pool = seen.filter((f) => f.id !== this.lastId);

    // 3. Maybe introduce a brand-new fact.
    const unseen = allowed.filter((f) => this.record(f.id).state === 'unseen');
    const bootstrap = seen.length < this.rules.minActivePool;
    const budgetLeft = this.newThisMatch < this.rules.maxNewFactsPerMatch;
    if (unseen.length > 0 && (bootstrap || budgetLeft)) {
      const wantNew =
        pool.length === 0 ||
        (bootstrap && this.rng.chance(0.6)) ||
        (difficulty !== 'easy' && this.rng.chance(this.rules.newFactChance));
      if (wantNew) {
        const next = unseen.slice().sort((x, y) => {
          const key = (f: Fact) => [
            this.record(f.id).boost > 0 ? 0 : 1,
            inBias(f) ? 0 : 1,
            this.groupOf(f.a, f.b),
            Math.max(f.a, f.b),
            Math.min(f.a, f.b),
            f.a,
          ];
          const kx = key(x);
          const ky = key(y);
          for (let i = 0; i < kx.length; i++) if (kx[i] !== ky[i]) return kx[i] - ky[i];
          return 0;
        })[0];
        if (!bootstrap) this.newThisMatch++;
        return this.finish(next, true);
      }
    }

    // 4. Weighted pick from the pool, favouring facts due for review.
    const candidates = pool.length ? pool : seen.length ? seen : allowed;
    const hardness = opts.hardness ?? 0;
    const weights = candidates.map((f) => {
      const r = this.record(f.id);
      const due = r.due <= tick;
      let w = due ? 3 + Math.min(3, (tick - r.due) / 10) : r.state === 'mastered' ? 0.15 : 0.5;
      w += r.boost;
      if (inBias(f)) w *= this.rules.tableBiasWeight;
      if (hardness > 0) {
        const acc = r.recent.length ? r.recent.filter((x) => x.c).length / r.recent.length : 0.5;
        const size = (f.a * f.b) / (this.rules.maxFactor * this.rules.maxFactor);
        w *= 1 + hardness * 4 * (0.5 * (1 - acc) + 0.5 * size);
      }
      return w;
    });
    return this.finish(candidates[this.rng.weightedIndex(weights)], false);
  }

  private finish(f: Fact, isNew: boolean): Selection {
    const r = this.record(f.id);
    r.boost = 0;
    this.lastId = f.id;
    return { ...f, isNew, state: r.state };
  }

  // ---- Recording -----------------------------------------------------------

  recordAnswer(id: string, correct: boolean, ms: number): AnswerOutcome {
    const r = this.record(id);
    const rules = this.rules;
    const previous = r.state;
    r.attempts++;
    if (correct) r.correct++;
    r.recent.push({ c: correct, ms: Math.round(ms) });
    if (r.recent.length > rules.recentWindow) r.recent.splice(0, r.recent.length - rules.recentWindow);
    r.lastSeen = this.clock();
    r.state = computeMastery(r, rules);

    const tick = this.state.tick;
    if (!correct) {
      r.relearn = true;
      r.interval = rules.intervalLearning;
      r.due = tick + this.rng.int(rules.relearnDelay[0], rules.relearnDelay[1]);
    } else {
      r.relearn = false;
      if (r.state === 'mastered') {
        r.interval =
          previous === 'mastered'
            ? Math.min(
                rules.intervalMasteredMax,
                Math.max(rules.intervalMasteredMin, r.interval * rules.intervalGrowth),
              )
            : rules.intervalMasteredMin;
      } else {
        r.interval = r.state === 'familiar' ? rules.intervalFamiliar : rules.intervalLearning;
      }
      r.due = tick + r.interval;
    }

    if (r.state === 'mastered' && previous !== 'mastered') {
      const f = parseFactId(id);
      if (f.a !== f.b) this.record(factId(f.b, f.a)).boost += rules.partnerBoost;
    }
    return { previous, state: r.state };
  }
}
