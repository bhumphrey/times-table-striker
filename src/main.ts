/**
 * App controller: owns the save data and the active profile, and switches
 * between screens. All game rules live in src/core; this file only wires them.
 */
import './styles.css';
import { FactEngine } from './core/facts';
import { LeagueManager, type Fixture } from './core/league';
import { MatchEngine, type MatchReport } from './core/match';
import { Rng, randomSeed } from './core/rng';
import type { Settings } from './core/settings';
import { Storage, createProfile, MemoryStore, type Profile, type SaveData } from './storage/storage';
import { audio } from './ui/audio';
import { clear, h } from './ui/dom';
import { MatchScreen } from './ui/matchScreen';
import {
  fullTimeScreen,
  hubScreen,
  masteryScreen,
  profileScreen,
  scoutingScreen,
  settingsScreen,
  titleScreen,
} from './ui/screens';

const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function browserStore() {
  try {
    const k = '__tts_probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return new MemoryStore();
  }
}

class App {
  private readonly storage = new Storage(browserStore());
  private data: SaveData;
  private profile: Profile | null = null;
  private facts: FactEngine | null = null;
  private league: LeagueManager | null = null;
  private match: MatchScreen | null = null;
  private outcomeMessage: string | null = null;
  private readonly muteBtn: HTMLButtonElement;
  private sessionMuted = false;

  constructor(private readonly root: HTMLElement) {
    this.data = this.storage.load();
    this.muteBtn = h('button', { class: 'btn small mute-btn', onclick: () => this.toggleMute() });
    document.body.appendChild(this.muteBtn);
    this.applySettings();
    this.showTitle();
    if (this.storage.lastError) console.warn(this.storage.lastError);
  }

  // ---- Persistence & settings -------------------------------------------------

  private persist(): void {
    this.storage.save(this.data);
  }

  private get settings(): Settings | null {
    return this.profile?.settings ?? null;
  }

  private applySettings(): void {
    const s = this.settings;
    document.body.classList.toggle('hc', !!s?.highContrast);
    document.body.classList.toggle('rm', s ? s.reducedMotion : prefersReducedMotion);
    audio.muted = s ? s.muted : this.sessionMuted;
    this.muteBtn.textContent = audio.muted ? '\u{1F507} Sound off' : '\u{1F50A} Sound on';
    this.muteBtn.setAttribute('aria-pressed', String(!audio.muted));
    this.muteBtn.setAttribute('aria-label', audio.muted ? 'Sound is off. Turn sound on' : 'Sound is on. Turn sound off');
  }

  private toggleMute(): void {
    if (this.profile) {
      this.profile.settings.muted = !this.profile.settings.muted;
      this.persist();
    } else {
      this.sessionMuted = !this.sessionMuted;
    }
    this.applySettings();
  }

  private selectProfile(p: Profile): void {
    this.profile = p;
    this.facts = new FactEngine(p.facts, new Rng(randomSeed()));
    this.league = new LeagueManager(p.league, this.facts);
    this.data.activeProfileId = p.id;
    this.persist();
    this.applySettings();
  }

  // ---- Screens ------------------------------------------------------------------

  private show(el: HTMLElement): void {
    this.match?.destroy();
    this.match = null;
    clear(this.root);
    this.root.appendChild(el);
    window.scrollTo(0, 0);
    (el.querySelector('.screen-heading') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  showTitle(): void {
    this.show(titleScreen({ hasProfiles: this.data.profiles.length > 0, onPlay: () => this.showProfiles() }));
  }

  showProfiles(): void {
    this.profile = null;
    this.applySettings();
    this.show(
      profileScreen({
        profiles: this.data.profiles,
        facts: (p) => new FactEngine(p.facts, new Rng(1)),
        onSelect: (p) => {
          this.selectProfile(p);
          this.showHub();
        },
        onCreate: (name, color, younger) => {
          const p = createProfile(name, color, randomSeed(), prefersReducedMotion);
          if (younger) {
            p.settings.lengthMode = 'possessions';
            p.settings.timerScale = 1.5;
          }
          this.data.profiles.push(p);
          this.selectProfile(p);
          this.showHub();
        },
        onDelete: (p) => {
          this.data.profiles = this.data.profiles.filter((x) => x.id !== p.id);
          if (this.data.activeProfileId === p.id) this.data.activeProfileId = null;
          this.persist();
          this.showProfiles();
        },
        onBack: () => this.showTitle(),
      }),
    );
  }

  showHub(): void {
    const { profile, league, facts } = this;
    if (!profile || !league || !facts) return this.showProfiles();
    const message = this.outcomeMessage;
    this.outcomeMessage = null;
    this.show(
      hubScreen({
        profile,
        league,
        facts,
        outcomeMessage: message,
        onScout: (f) => this.showScouting(f),
        onNextSeason: () => {
          this.outcomeMessage = league.startNextSeason(profile.settings.relegationEnabled).message;
          this.persist();
          this.showHub();
        },
        onMastery: () => this.show(masteryScreen({ facts, onBack: () => this.showHub() })),
        onSettings: () => this.showSettings(),
        onSwitch: () => this.showProfiles(),
      }),
    );
    this.persist(); // nextFixture() may have generated a pending fixture.
  }

  showSettings(): void {
    const profile = this.profile;
    if (!profile) return this.showProfiles();
    this.show(
      settingsScreen({
        settings: profile.settings,
        onChange: (s) => {
          profile.settings = s;
          this.persist();
          this.applySettings();
        },
        onBack: () => this.showHub(),
      }),
    );
  }

  showScouting(fixture: Fixture): void {
    const league = this.league!;
    this.show(scoutingScreen({ league, fixture, onKickOff: () => this.startMatch(fixture), onBack: () => this.showHub() }));
  }

  startMatch(fixture: Fixture): void {
    const { profile, league, facts } = this;
    if (!profile || !league || !facts) return;
    const s = profile.settings;
    const seed = randomSeed();
    const masteredBefore = facts.masteryCounts().mastered;
    const engine = new MatchEngine({
      team: league.effectiveTeam(fixture),
      facts,
      rng: new Rng(seed),
      division: league.division,
      tableBias: league.matchTableBias(fixture),
      timerScale: s.timerScale,
      lengthMode: s.lengthMode,
      halfLengthSec: s.halfLengthSec,
      possessionsPerHalf: s.possessionsPerHalf,
    });
    const screen = new MatchScreen({
      engine,
      playerName: profile.name,
      playerColor: profile.color,
      settings: s,
      clockSpeed: import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('speed') ?? 1) || 1 : 1,
      onFinish: (report) => this.finishMatch(fixture, report, masteredBefore),
      onQuit: () => {
        this.persist(); // Keep the fluency data from the answers given.
        this.showHub();
      },
    });
    this.match?.destroy();
    clear(this.root);
    this.match = screen;
    screen.mount(this.root);
    if (import.meta.env.DEV) (window as unknown as { __match: MatchEngine }).__match = engine;
  }

  private finishMatch(fixture: Fixture, report: MatchReport, masteredBefore: number): void {
    const { profile, league, facts } = this;
    if (!profile || !league || !facts) return;
    league.recordResult(fixture, report);
    profile.matchesPlayed++;
    this.persist();
    this.show(
      fullTimeScreen({
        report,
        playerName: profile.name,
        masteredBefore,
        masteredAfter: facts.masteryCounts().mastered,
        onContinue: () => this.showHub(),
      }),
    );
  }
}

const app = new App(document.getElementById('app')!);
if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;
