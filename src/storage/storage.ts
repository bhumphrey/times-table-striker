/**
 * Storage: save/load learner profiles and league state in localStorage.
 * The blob carries a schemaVersion; older blobs are upgraded step by step
 * through MIGRATIONS. No DOM code beyond the injected key-value store.
 */
import { createFactState, type FactState } from '../core/facts';
import { createLeagueState, type LeagueState } from '../core/league';
import { defaultSettings, type Settings } from '../core/settings';

export const STORAGE_KEY = 'times-table-striker';
export const SCHEMA_VERSION = 2;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Profile {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  facts: FactState;
  league: LeagueState;
  settings: Settings;
  matchesPlayed: number;
}

export interface SaveData {
  schemaVersion: number;
  profiles: Profile[];
  activeProfileId: string | null;
}

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * MIGRATIONS[n] upgrades a version-n blob to version n + 1.
 *  0 -> 1: unversioned prototype saves held a single learner at the top level.
 *  1 -> 2: settings were global; they moved onto each profile.
 */
export const MIGRATIONS: Record<number, Migration> = {
  0: (d) => {
    const legacy = d as { name?: string; facts?: FactState };
    const profiles = legacy.facts
      ? [{ id: 'p-legacy', name: legacy.name ?? 'Player 1', color: '#1e63d6', createdAt: 0, facts: legacy.facts, matchesPlayed: 0 }]
      : [];
    return { schemaVersion: 1, profiles, activeProfileId: null, settings: defaultSettings() };
  },
  1: (d) => {
    const settings = (d.settings as Settings | undefined) ?? defaultSettings();
    const profiles = ((d.profiles as Record<string, unknown>[]) ?? []).map((p) => ({ ...p, settings: { ...settings } }));
    const { settings: _drop, ...rest } = d;
    void _drop;
    return { ...rest, schemaVersion: 2, profiles };
  },
};

export function migrate(
  raw: Record<string, unknown>,
  migrations: Record<number, Migration> = MIGRATIONS,
  target = SCHEMA_VERSION,
): Record<string, unknown> {
  let data = raw;
  let v = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;
  if (v > target) throw new Error(`Save data is from a newer version (${v}) of the game`);
  while (v < target) {
    const step = migrations[v];
    if (!step) throw new Error(`No migration from schema ${v}`);
    data = step(data);
    v = data.schemaVersion as number;
  }
  return data;
}

/** Fill any fields missing from older or hand-edited saves. */
function normalizeProfile(p: Partial<Profile>, index: number): Profile {
  const facts = createFactState();
  if (p.facts) {
    facts.tick = p.facts.tick ?? 0;
    for (const [id, r] of Object.entries(p.facts.records ?? {})) if (facts.records[id]) facts.records[id] = { ...facts.records[id], ...r };
  }
  return {
    id: p.id ?? `p-${Date.now().toString(36)}-${index}`,
    name: p.name ?? `Player ${index + 1}`,
    color: p.color ?? '#1e63d6',
    createdAt: p.createdAt ?? Date.now(),
    facts,
    league: p.league ?? createLeagueState(Math.floor(Math.random() * 2 ** 31)),
    settings: { ...defaultSettings(), ...(p.settings ?? {}) },
    matchesPlayed: p.matchesPlayed ?? 0,
  };
}

export function emptySave(): SaveData {
  return { schemaVersion: SCHEMA_VERSION, profiles: [], activeProfileId: null };
}

export class Storage {
  /** Set when a save could not be read; the bad blob is kept under a backup key. */
  lastError: string | null = null;

  constructor(
    private readonly store: KeyValueStore,
    private readonly key = STORAGE_KEY,
  ) {}

  load(): SaveData {
    let text: string | null = null;
    try {
      text = this.store.getItem(this.key);
    } catch (e) {
      this.lastError = `Storage unavailable: ${String(e)}`;
      return emptySave();
    }
    if (!text) return emptySave();
    try {
      const data = migrate(JSON.parse(text)) as unknown as SaveData;
      const profiles = (data.profiles ?? []).map((p, i) => normalizeProfile(p, i));
      const active = profiles.some((p) => p.id === data.activeProfileId) ? data.activeProfileId : null;
      return { schemaVersion: SCHEMA_VERSION, profiles, activeProfileId: active };
    } catch (e) {
      this.lastError = `Could not read saved data (${String(e)}). A backup was kept.`;
      try {
        this.store.setItem(`${this.key}.backup-${Date.now()}`, text);
      } catch {
        /* ignore */
      }
      return emptySave();
    }
  }

  save(data: SaveData): boolean {
    try {
      this.store.setItem(this.key, JSON.stringify({ ...data, schemaVersion: SCHEMA_VERSION }));
      return true;
    } catch (e) {
      this.lastError = `Could not save: ${String(e)}`;
      return false;
    }
  }
}

export function createProfile(name: string, color: string, seed: number, prefersReducedMotion = false): Profile {
  return {
    id: `p-${Date.now().toString(36)}-${seed.toString(36)}`,
    name: name.trim().slice(0, 20) || 'Player',
    color,
    createdAt: Date.now(),
    facts: createFactState(),
    league: createLeagueState(seed),
    settings: defaultSettings(prefersReducedMotion),
    matchesPlayed: 0,
  };
}

/** In-memory store for tests and when localStorage is unavailable. */
export class MemoryStore implements KeyValueStore {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  keys() {
    return [...this.m.keys()];
  }
}
