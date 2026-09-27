# Times Table Striker

A browser soccer game that builds fluent recall of the multiplication facts
from 1 x 1 to 12 x 12, for learners aged about 7 to 11. You move the ball up the
pitch by answering facts, inside a three-division league of opponents that each
change the rules in a different way.

Client-side only (TypeScript + Vite), no backend, no licensed assets. Sounds are
generated with the Web Audio API. Progress is saved in `localStorage`.

## Setup

Requires Node 18+.

```bash
npm install
```

## Run

```bash
npm run dev
```

Then open http://localhost:5173. For a production build:

```bash
npm run build
```

`dist/` is fully static and uses relative paths, so it can be served from any
host or sub-folder (GitHub Pages, S3, `python3 -m http.server`, and so on).
Preview it locally with:

```bash
npm run preview
```

## Test

```bash
npm test
```

Runs the Vitest suites (84 tests): FactEngine selection and mastery,
MatchEngine action resolution, team-rule enforcement for all six archetypes,
LeagueManager scheduling and promotion, storage and migrations, and the
simulation checks. `npm run typecheck` runs the TypeScript compiler.

### Simulation

```bash
npm run simulate
```

Plays 50 league matches with a scripted learner whose accuracy and play style
change in five phases (struggling, short-passer, fluent, avoids hard facts,
off form). It prints every match (opponent, why it was picked, rubber-band
offset, score) and checks that:

- rubber-banding correlates with accuracy,
- opponent difficulty (team strength + rubber band) correlates with accuracy,
- short-pass reliance produces a High Press fixture,
- avoiding hard facts produces a Low Block or Offside Trap fixture.

The script exits non-zero if any check fails. Options: `--seed N`, `--json`.

## How to play

1. Create a player (name and kit colour). Tick "Shorter matches" for younger
   learners: halves then end after a number of possessions, and timers are relaxed.
2. The League Hub shows the table and your next opponent. Open the scouting
   report to see how that team plays and which rules change.
3. In a match, choose a move, then type the answer on the number pad or the keyboard (Enter submits).
   - **Short pass** (P): one easy fact, +1 zone.
   - **Long ball** (L): one hard fact, +2 zones. Mistakes concede in a dangerous area.
   - **Dribble** (D): a chain of facts on one short timer, +1 zone. Beats a press.
   - **Shoot** (S): Attacking Third or Penalty Area only. Long-range shots draw tougher facts.
   - Defending: **Tackle** (T), **Intercept** (I, harder, wins the ball higher up), **Save** (S).
4. After a mistake the correct fact is shown for 1.5 seconds. A fact you get wrong comes back within the next few questions.
5. Finish in the top two **and** master 70% of the division's facts to be promoted.

Keyboard: digits, Backspace, Enter, the action letters, and Escape to pause.

## Project layout

```
src/
  core/            Engine modules: no DOM code, unit-tested
    facts.ts       FactEngine: fluency tracking, mastery, spaced repetition, selection
    match.ts       MatchEngine: zones, actions, possession, turnovers, clock, report
    teams.ts       TeamProfiles: typed loader, validation, strength index, rule summaries
    league.ts      LeagueManager: divisions, fixtures, standings, promotion, adaptive scheduling
    rng.ts         Seeded PRNG (mulberry32) for replayable matches
    settings.ts    Per-profile settings type and defaults
  data/
    rules.ts       All tunable numbers (fact, match and league rules)
    teams.json     The 18 opponent clubs (data only)
  storage/
    storage.ts     Versioned save/load, migrations, profiles
  sim/
    simulate.ts    Headless scripted-learner simulation
  ui/              DOM + canvas: match screen, pitch renderer, menus, audio
  main.ts          App controller wiring screens to the engines
scripts/simulate.ts   CLI for the simulation
tests/                Vitest suites
```

## Tuning

Change data files, not engine code:

- **`src/data/teams.json`**: every opponent. Fields follow the spec schema
  (`shortPassAllowance`, `dribbleChainLength`, `longBall`, `responseTimeLimitSec`,
  `keeperStrength`, `tableBias`, `turnoverPenalty`, `scoutingReport`) plus two
  extensions: `tacklesToWin` (correct defensive answers needed to win the ball)
  and `colors`. The data is validated at start-up, so a bad value throws
  an error that names the field.
- **`src/data/rules.ts`**:
  - `FACT_RULES`: mastery thresholds (4 of the last 5 correct, median under 3000 ms),
    Familiar rule, table groups and unlock share, new facts per match, spaced-repetition intervals.
  - `MATCH_RULES`: half length, possessions per half, possession clock, dribble and
    press timers, correction display time, shot model, opponent finishing, rubber-band gain and limit.
  - `LEAGUE_RULES`: division names and focus tables, points, promotion places and
    mastery share, relegation, adaptive-scheduling thresholds.

After tuning, run `npm test` and `npm run simulate` to check that difficulty still adapts.

## Accessibility

- All touch targets are at least 44 px; the number pad keys are 60 px.
- Full keyboard play with visible focus rings.
- High-contrast mode, reduced-motion mode (also follows the OS setting), and
  adjustable answer timers (standard, 1.5x, 2x, or no timer).
- Nothing relies on colour alone: teams differ by shape (circles vs diamonds), mastery
  cells carry symbols, disabled moves are struck through with a written reason,
  and timers show seconds as text.
- Live regions announce commentary, questions and results for screen readers.
