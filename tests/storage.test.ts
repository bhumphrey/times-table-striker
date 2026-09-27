import { describe, expect, it } from 'vitest';
import { FactEngine } from '../src/core/facts';
import { Rng } from '../src/core/rng';
import {
  MemoryStore,
  SCHEMA_VERSION,
  STORAGE_KEY,
  Storage,
  createProfile,
  migrate,
} from '../src/storage/storage';

describe('Storage', () => {
  it('returns an empty save when nothing is stored', () => {
    const s = new Storage(new MemoryStore());
    expect(s.load()).toEqual({ schemaVersion: SCHEMA_VERSION, profiles: [], activeProfileId: null });
  });

  it('round-trips profiles, fluency data and settings', () => {
    const store = new MemoryStore();
    const s = new Storage(store);
    const p = createProfile('Ada', '#ff0000', 42);
    const facts = new FactEngine(p.facts, new Rng(1));
    for (let i = 0; i < 4; i++) facts.recordAnswer('7x8', true, 1200);
    facts.recordAnswer('3x4', false, 5000);
    p.settings.highContrast = true;
    p.settings.timerScale = null;
    s.save({ schemaVersion: SCHEMA_VERSION, profiles: [p], activeProfileId: p.id });

    const loaded = new Storage(store).load();
    expect(loaded.activeProfileId).toBe(p.id);
    const q = loaded.profiles[0];
    expect(q.name).toBe('Ada');
    expect(q.facts.records['7x8'].state).toBe('mastered');
    expect(q.facts.records['3x4'].state).toBe('learning');
    expect(q.facts.records['3x4'].recent).toEqual([{ c: false, ms: 5000 }]);
    expect(q.settings.highContrast).toBe(true);
    expect(q.settings.timerScale).toBeNull();
    expect(q.league.season.division).toBe(1);
  });

  it('supports multiple profiles', () => {
    const store = new MemoryStore();
    const s = new Storage(store);
    const a = createProfile('A', '#111', 1);
    const b = createProfile('B', '#222', 2);
    s.save({ schemaVersion: SCHEMA_VERSION, profiles: [a, b], activeProfileId: b.id });
    const loaded = s.load();
    expect(loaded.profiles.map((p) => p.name)).toEqual(['A', 'B']);
    expect(loaded.activeProfileId).toBe(b.id);
  });

  it('migrates a legacy unversioned save through every step', () => {
    const store = new MemoryStore();
    const legacyFacts = createProfile('x', '#000', 1).facts;
    legacyFacts.records['2x2'] = { ...legacyFacts.records['2x2'], attempts: 3, correct: 3, state: 'familiar' };
    store.setItem(STORAGE_KEY, JSON.stringify({ name: 'Old Timer', facts: legacyFacts }));
    const loaded = new Storage(store).load();
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(loaded.profiles).toHaveLength(1);
    expect(loaded.profiles[0].name).toBe('Old Timer');
    expect(loaded.profiles[0].facts.records['2x2'].state).toBe('familiar');
    expect(loaded.profiles[0].settings.timerScale).toBe(1);
  });

  it('moves global v1 settings onto each profile', () => {
    const out = migrate({
      schemaVersion: 1,
      settings: { muted: true },
      profiles: [{ id: 'a' }, { id: 'b' }],
      activeProfileId: 'a',
    });
    expect(out.schemaVersion).toBe(2);
    expect(out.settings).toBeUndefined();
    expect((out.profiles as { settings: { muted: boolean } }[]).every((p) => p.settings.muted)).toBe(true);
  });

  it('runs a custom migration chain in order', () => {
    const out = migrate(
      { schemaVersion: 1, n: 1 },
      { 1: (d) => ({ ...d, schemaVersion: 2, n: (d.n as number) * 10 }), 2: (d) => ({ ...d, schemaVersion: 3, n: (d.n as number) + 1 }) },
      3,
    );
    expect(out).toEqual({ schemaVersion: 3, n: 11 });
  });

  it('refuses saves from a newer version and keeps a backup of unreadable data', () => {
    const store = new MemoryStore();
    store.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 999 }));
    const s = new Storage(store);
    expect(s.load().profiles).toEqual([]);
    expect(s.lastError).toMatch(/newer version/);
    expect(store.keys().some((k) => k.startsWith(`${STORAGE_KEY}.backup-`))).toBe(true);

    const store2 = new MemoryStore();
    store2.setItem(STORAGE_KEY, '{not json');
    const s2 = new Storage(store2);
    expect(s2.load().profiles).toEqual([]);
    expect(s2.lastError).toBeTruthy();
  });

  it('fills fields missing from partial saves', () => {
    const store = new MemoryStore();
    store.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, profiles: [{ id: 'z', name: 'Zed' }], activeProfileId: 'nope' }));
    const loaded = new Storage(store).load();
    const p = loaded.profiles[0];
    expect(Object.keys(p.facts.records)).toHaveLength(144);
    expect(p.league.season.division).toBe(1);
    expect(loaded.activeProfileId).toBeNull();
  });
});
