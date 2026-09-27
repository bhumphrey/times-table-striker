/**
 * Menu screens. Each function builds a screen element from data plus callbacks;
 * the App in main.ts decides which one is showing.
 */
import { MASTERY_ORDER, parseFactId, median, type FactEngine, type Mastery } from '../core/facts';
import { PLAYER_ID, ordinal, type Fixture, type LeagueManager } from '../core/league';
import type { MatchReport } from '../core/match';
import { TIMER_SCALES, type Settings } from '../core/settings';
import { getTeam, type TeamProfile } from '../core/teams';
import type { Profile } from '../storage/storage';
import { formatFact, h, times } from './dom';

export const KIT_COLORS = ['#1e63d6', '#d62828', '#f77f00', '#7b2cbf', '#2a9d8f', '#e63998', '#3a3a3a', '#8ac926'];

export const MASTERY_LABEL: Record<Mastery, string> = {
  unseen: 'Not seen yet',
  learning: 'Learning',
  familiar: 'Familiar',
  mastered: 'Mastered',
};

/** Symbols so mastery is never conveyed by colour alone. */
export const MASTERY_SYMBOL: Record<Mastery, string> = {
  unseen: '·',
  learning: '○',
  familiar: '◐',
  mastered: '★',
};

function heading(text: string, level: 'h1' | 'h2' = 'h1'): HTMLElement {
  return h(level, { tabindex: '-1', class: 'screen-heading' }, text);
}

function crest(team: TeamProfile): HTMLElement {
  const initials = team.name
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w))
    .map((w) => w[0])
    .join('')
    .slice(0, 2);
  return h(
    'div',
    { class: 'team-crest', style: `background:${team.colors.primary};color:${team.colors.secondary};border:3px solid ${team.colors.secondary}`, 'aria-hidden': 'true' },
    h('span', {}, initials),
  );
}

// ---- Title ---------------------------------------------------------------------

export function titleScreen(opts: { onPlay(): void; hasProfiles: boolean }): HTMLElement {
  return h(
    'main',
    { class: 'screen title-screen' },
    h('div', { class: 'title-ball', 'aria-hidden': 'true' }, '⚽'),
    heading('Times Table Striker'),
    h('p', { class: 'tagline' }, 'Answer multiplication facts to pass, dribble and shoot your way up the league!'),
    h(
      'div',
      { class: 'title-actions' },
      h('button', { class: 'btn primary big', onclick: opts.onPlay }, opts.hasProfiles ? 'Play' : 'Start playing'),
    ),
    h('p', { class: 'muted', style: 'color:#cfe8d6' }, 'Works with a mouse, touch screen or keyboard.'),
  );
}

// ---- Profiles ------------------------------------------------------------------

export function profileScreen(opts: {
  profiles: Profile[];
  facts: (p: Profile) => FactEngine;
  onSelect(p: Profile): void;
  onCreate(name: string, color: string, younger: boolean): void;
  onDelete(p: Profile): void;
  onBack(): void;
}): HTMLElement {
  let color = KIT_COLORS[0];
  let younger = false;
  const nameInput = h('input', { type: 'text', id: 'new-name', maxlength: '20', autocomplete: 'off', placeholder: 'Your name' });
  const swatches = h(
    'div',
    { class: 'swatches', role: 'radiogroup', 'aria-label': 'Kit colour' },
    KIT_COLORS.map((c, i) => {
      const b = h('button', {
        class: 'swatch',
        type: 'button',
        role: 'radio',
        'aria-checked': String(i === 0),
        'aria-label': `Kit colour ${i + 1}`,
        style: `background:${c}`,
        onclick: () => {
          color = c;
          swatches.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-checked', String(s === b)));
        },
      });
      return b;
    }),
  );
  const youngerBtn = h('button', {
    class: 'btn',
    type: 'button',
    'aria-pressed': 'false',
    onclick: () => {
      younger = !younger;
      youngerBtn.setAttribute('aria-pressed', String(younger));
    },
  }, 'Shorter matches (counted by possessions)');

  const form = h(
    'form',
    {
      class: 'panel',
      onsubmit: (e: Event) => {
        e.preventDefault();
        const name = nameInput.value.trim();
        if (!name) {
          nameInput.focus();
          nameInput.setAttribute('aria-invalid', 'true');
          return;
        }
        opts.onCreate(name, color, younger);
      },
    },
    h('h2', {}, 'New player'),
    h('div', { class: 'form-row' }, h('label', { for: 'new-name' }, 'Name'), nameInput),
    h('fieldset', { class: 'form-row' }, h('legend', {}, 'Kit colour'), swatches),
    h('div', { class: 'form-row choice-row' }, youngerBtn),
    h('button', { class: 'btn primary big', type: 'submit' }, 'Create player'),
  );

  const cards = opts.profiles.map((p) => {
    const f = opts.facts(p);
    const counts = f.masteryCounts();
    let armed = false;
    const del = h('button', {
      class: 'btn small danger',
      onclick: () => {
        if (!armed) {
          armed = true;
          del.textContent = `Tap again to delete ${p.name}`;
          setTimeout(() => {
            armed = false;
            del.textContent = 'Delete';
          }, 4000);
          return;
        }
        opts.onDelete(p);
      },
    }, 'Delete');
    return h(
      'div',
      { class: 'panel profile-card' },
      h('h2', {}, h('span', { class: 'kit circle', style: `background:${p.color};margin-right:8px` }), p.name),
      h('p', { class: 'muted' }, `Division ${p.league.season.division} • ${counts.mastered} facts mastered • ${p.matchesPlayed} matches`),
      h('button', { class: 'btn primary', onclick: () => opts.onSelect(p) }, `Play as ${p.name}`),
      del,
    );
  });

  return h(
    'main',
    { class: 'screen' },
    h('div', { class: 'topbar' }, h('button', { class: 'btn small ghost', onclick: opts.onBack }, '← Back'), heading('Who is playing?')),
    cards.length ? h('div', { class: 'profile-list' }, cards) : null,
    form,
  );
}

// ---- League hub -------------------------------------------------------------------

export function hubScreen(opts: {
  profile: Profile;
  league: LeagueManager;
  facts: FactEngine;
  outcomeMessage: string | null;
  onScout(f: Fixture): void;
  onNextSeason(): void;
  onMastery(): void;
  onSettings(): void;
  onSwitch(): void;
}): HTMLElement {
  const { league, profile } = opts;
  const table = league.table();
  const nameOf = (id: string) => (id === PLAYER_ID ? profile.name : getTeam(id).name);
  const standings = h(
    'table',
    { class: 'standings' },
    h('caption', { class: 'sr-only' }, 'League table'),
    h('thead', {}, h('tr', {}, ['#', 'Team', 'P', 'W', 'D', 'L', 'GF', 'GA', 'Pts'].map((c) => h('th', { scope: 'col' }, c)))),
    h(
      'tbody',
      {},
      table.map((r, i) =>
        h(
          'tr',
          { class: `${r.teamId === PLAYER_ID ? 'me' : ''} ${i < league.rules.promotionPlaces ? 'promo' : ''}` },
          h('td', {}, String(i + 1)),
          h('td', {}, r.teamId === PLAYER_ID ? `★ ${nameOf(r.teamId)}` : nameOf(r.teamId)),
          [r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst, r.points].map((v) => h('td', {}, String(v))),
        ),
      ),
    ),
  );

  const share = league.masteryShare();
  const need = league.rules.promotionMasteryShare;
  const played = league.season.playedRounds.filter((r) => league.season.rounds[r].some((p) => p.includes(PLAYER_ID) && !p.includes('bye'))).length;
  const masteryPanel = h(
    'div',
    { class: 'panel' },
    h('h2', {}, 'Promotion target'),
    h('p', {}, `Finish in the top ${league.rules.promotionPlaces} and master ${Math.round(need * 100)}% of this division's facts.`),
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(share * 100)), 'aria-label': 'Division facts mastered' },
      h('span', { style: `width:${Math.min(100, share * 100)}%` })),
    h('p', { class: 'muted' }, `${Math.round(share * 100)}% mastered ${share >= need ? '✓ target reached' : ''} • You are ${ordinal(league.position())}`),
  );

  let fixturePanel: HTMLElement;
  const fixture = league.nextFixture();
  if (fixture) {
    const scout = league.scoutingReport(fixture);
    fixturePanel = h(
      'div',
      { class: 'panel fixture-card' },
      h('h2', {}, `Next match (${played + 1} of ${league.season.teamIds.length})`),
      h('div', { style: 'display:flex;gap:16px;align-items:center' }, crest(scout.team),
        h('div', {}, h('p', { style: 'margin:0;font-size:1.3rem;font-weight:800' }, scout.team.name), h('span', { class: 'style-badge' }, scout.team.style))),
      h('button', { class: 'btn primary big', onclick: () => opts.onScout(fixture) }, 'Scouting report →'),
    );
  } else {
    const outcome = league.seasonOutcome(profile.settings.relegationEnabled);
    fixturePanel = h(
      'div',
      { class: 'panel fixture-card' },
      h('h2', {}, 'Season complete!'),
      h('p', { class: 'notice' }, outcome.message),
      h('button', { class: 'btn primary big', onclick: opts.onNextSeason }, 'Start next season'),
    );
  }

  return h(
    'main',
    { class: 'screen' },
    h('div', { class: 'topbar' },
      heading(`${league.divisionName()} • Season ${league.season.season}`),
      h('button', { class: 'btn small ghost', onclick: opts.onMastery }, 'Mastery grid'),
      h('button', { class: 'btn small ghost', onclick: opts.onSettings }, 'Settings'),
      h('button', { class: 'btn small ghost', onclick: opts.onSwitch }, 'Switch player'),
    ),
    opts.outcomeMessage ? h('p', { class: 'notice', role: 'status' }, opts.outcomeMessage) : null,
    h('div', { class: 'hub-grid' },
      h('div', { class: 'panel' }, h('h2', {}, 'League table'), standings,
        h('p', { class: 'muted', style: 'font-size:0.85rem' }, '▲ = promotion places. ★ = you.')),
      h('div', { style: 'display:flex;flex-direction:column;gap:14px' }, fixturePanel, masteryPanel),
    ),
  );
}

// ---- Scouting report ---------------------------------------------------------------

export function scoutingScreen(opts: {
  league: LeagueManager;
  fixture: Fixture;
  onKickOff(): void;
  onBack(): void;
}): HTMLElement {
  const s = opts.league.scoutingReport(opts.fixture);
  return h(
    'main',
    { class: 'screen scouting' },
    h('div', { class: 'panel', style: 'display:flex;flex-direction:column;gap:12px' },
      h('p', { class: 'overlay-kicker', style: 'margin:0' }, 'Scouting report'),
      h('div', { style: 'display:flex;gap:18px;align-items:center' }, crest(s.team),
        h('div', {}, heading(s.team.name), h('span', { class: 'style-badge' }, s.team.style))),
      h('p', { class: 'report' }, s.summary),
      h('h2', { style: 'font-size:1.1rem;margin:0' }, 'Rules today'),
      h('ul', {}, s.rules.map((r) => h('li', {}, r))),
      h('p', { class: 'muted' }, s.note),
      h('div', { class: 'hub-actions' },
        h('button', { class: 'btn primary big', onclick: opts.onKickOff }, 'Kick off!'),
        h('button', { class: 'btn', onclick: opts.onBack }, 'Back')),
    ),
  );
}

// ---- Full time -----------------------------------------------------------------------

export function fullTimeScreen(opts: {
  report: MatchReport;
  playerName: string;
  masteredBefore: number;
  masteredAfter: number;
  onContinue(): void;
}): HTMLElement {
  const r = opts.report;
  const team = getTeam(r.teamId);
  const banner = r.result === 'win' ? 'You won!' : r.result === 'draw' ? "It's a draw" : 'You lost this time';
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const stat = (v: string, k: string) => h('div', { class: 'stat' }, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k));
  const chips = (facts: { a: number; b: number }[], showAnswer: boolean, empty: string) =>
    facts.length
      ? h('div', { class: 'fact-chips' }, facts.map((f) => h('span', { class: 'chip' }, showAnswer ? `${formatFact(f.a, f.b)} = ${f.a * f.b}` : formatFact(f.a, f.b))))
      : h('p', { class: 'muted' }, empty);
  const gained = opts.masteredAfter - opts.masteredBefore;
  return h(
    'main',
    { class: 'screen' },
    h('div', { class: 'panel', style: 'display:flex;flex-direction:column;gap:14px' },
      h('p', { class: 'overlay-kicker', style: 'margin:0' }, 'Full-time report'),
      heading(`${banner} ${opts.playerName} ${r.score.player} - ${r.score.opponent} ${team.name}`),
      h('div', { class: 'stat-grid' },
        stat(`${r.score.player} - ${r.score.opponent}`, 'Score'),
        stat(pct(r.possessionShare), 'Possession'),
        stat(`${pct(r.accuracy)}`, `Accuracy (${r.correct}/${r.answered})`),
        stat(r.averageMs ? `${(r.averageMs / 1000).toFixed(1)}s` : '-', 'Average correct answer'),
        stat(String(r.shots), 'Shots'),
        stat(gained > 0 ? `+${gained}` : String(gained), 'Facts newly mastered'),
      ),
      h('h2', {}, '⚡ Fastest facts'),
      chips(r.fastestFacts.map((f) => ({ a: f.a, b: f.b, ms: f.ms })), true, 'No correct answers this time.'),
      r.fastestFacts.length ? h('p', { class: 'muted', style: 'margin:0' }, r.fastestFacts.map((f) => `${formatFact(f.a, f.b)} in ${(f.ms / 1000).toFixed(1)}s`).join(' • ')) : null,
      h('h2', {}, '⚠ Facts that lost the ball'),
      chips(r.turnoverFacts, true, 'None. You never gave the ball away from a mistake!'),
      r.newFacts.length ? h('h2', {}, '★ New facts learned') : null,
      r.newFacts.length ? chips(r.newFacts, true, '') : null,
      h('button', { class: 'btn primary big', onclick: opts.onContinue }, 'Back to the league'),
    ),
  );
}

// ---- Mastery grid ------------------------------------------------------------------

export function masteryScreen(opts: { facts: FactEngine; onBack(): void }): HTMLElement {
  const { facts } = opts;
  const max = facts.rules.maxFactor;
  const detail = h('p', { class: 'fact-detail', 'aria-live': 'polite' }, 'Tap or focus a square to see details.');
  const describe = (id: string) => {
    const f = parseFactId(id);
    const r = facts.record(id);
    if (r.attempts === 0) return `${formatFact(f.a, f.b)}: not seen yet.`;
    const correctTimes = r.recent.filter((x) => x.c).map((x) => x.ms);
    const med = correctTimes.length ? `${(median(correctTimes) / 1000).toFixed(1)}s median` : 'no recent correct answers';
    const recent = r.recent.filter((x) => x.c).length;
    return `${formatFact(f.a, f.b)} = ${f.answer}: ${MASTERY_LABEL[r.state]}. ${r.attempts} tries, ${recent}/${r.recent.length} of the last ${r.recent.length} correct, ${med}.`;
  };
  const counts = facts.masteryCounts();
  const rows: HTMLElement[] = [];
  rows.push(h('tr', {}, h('th', { scope: 'col' }, times), Array.from({ length: max }, (_, j) => h('th', { scope: 'col' }, String(j + 1)))));
  for (let a = 1; a <= max; a++) {
    const cells = [];
    for (let b = 1; b <= max; b++) {
      const id = `${a}x${b}`;
      const state = facts.record(id).state;
      const td = h(
        'td',
        {
          class: `m-${state}`,
          tabindex: '0',
          'aria-label': `${a} times ${b}: ${MASTERY_LABEL[state]}`,
          title: describe(id),
          onclick: () => (detail.textContent = describe(id)),
          onfocus: () => (detail.textContent = describe(id)),
        },
        h('span', { class: 'sym', 'aria-hidden': 'true' }, MASTERY_SYMBOL[state]),
        h('span', { 'aria-hidden': 'true', style: 'font-size:0.65rem;opacity:0.8' }, String(a * b)),
      );
      cells.push(td);
    }
    rows.push(h('tr', {}, h('th', { scope: 'row' }, String(a)), cells));
  }
  return h(
    'main',
    { class: 'screen' },
    h('div', { class: 'topbar' }, h('button', { class: 'btn small ghost', onclick: opts.onBack }, '← Back'), heading('Mastery grid')),
    h('div', { class: 'panel' },
      h('div', { class: 'legend', role: 'list', 'aria-label': 'Legend' },
        MASTERY_ORDER.map((m) =>
          h('span', { role: 'listitem' }, h('i', { class: `m-${m}`, 'aria-hidden': 'true' }, MASTERY_SYMBOL[m]), `${MASTERY_LABEL[m]} (${counts[m]})`))),
      h('p', { class: 'muted', style: 'margin-top:0' }, `Row ${times} column. Tables unlocked: ${facts.unlockedTables().sort((x, y) => x - y).join(', ')}. Mastered = 4 of the last 5 correct and a median time under ${facts.rules.masteryMedianMs / 1000} seconds.`),
      detail,
      h('div', { class: 'mastery-wrap' }, h('table', { class: 'mastery-grid' }, h('caption', { class: 'sr-only' }, 'Mastery of each multiplication fact'), h('tbody', {}, rows))),
    ),
  );
}

// ---- Settings ------------------------------------------------------------------------

export function settingsScreen(opts: { settings: Settings; onChange(s: Settings): void; onBack(): void }): HTMLElement {
  const s = { ...opts.settings };
  const update = () => opts.onChange({ ...s });
  const toggle = (label: string, key: 'muted' | 'highContrast' | 'reducedMotion' | 'relegationEnabled', invert = false) => {
    const input = h('input', { type: 'checkbox', checked: invert ? !s[key] : s[key] });
    input.addEventListener('change', () => {
      s[key] = invert ? !input.checked : input.checked;
      update();
    });
    return h('label', { class: 'toggle' }, input, label);
  };
  const choices = <T>(label: string, items: { label: string; value: T }[], get: () => T, set: (v: T) => void) => {
    const row = h('div', { class: 'choice-row', role: 'group', 'aria-label': label });
    const paint = () => row.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(items[i].value === get())));
    items.forEach((it) =>
      row.appendChild(h('button', { class: 'btn', type: 'button', onclick: () => { set(it.value); paint(); update(); } }, it.label)),
    );
    paint();
    return h('div', { class: 'form-row' }, h('span', { style: 'font-weight:650' }, label), row);
  };
  return h(
    'main',
    { class: 'screen' },
    h('div', { class: 'topbar' }, h('button', { class: 'btn small ghost', onclick: opts.onBack }, '← Back'), heading('Settings')),
    h('div', { class: 'panel settings-list' },
      toggle('Sound effects', 'muted', true),
      toggle('High-contrast colours', 'highContrast'),
      toggle('Reduce motion', 'reducedMotion'),
      choices('Answer timer', TIMER_SCALES, () => s.timerScale, (v) => (s.timerScale = v)),
      choices('Match length', [{ label: 'By time', value: 'time' as const }, { label: 'By possessions (younger players)', value: 'possessions' as const }], () => s.lengthMode, (v) => (s.lengthMode = v)),
      choices('Half length (time mode)', [90, 180, 240].map((v) => ({ label: `${v / 60} min`, value: v })), () => s.halfLengthSec, (v) => (s.halfLengthSec = v)),
      choices('Possessions per half (possession mode)', [4, 6, 8].map((v) => ({ label: String(v), value: v })), () => s.possessionsPerHalf, (v) => (s.possessionsPerHalf = v)),
      toggle('Relegation (bottom club goes down)', 'relegationEnabled'),
    ),
  );
}
