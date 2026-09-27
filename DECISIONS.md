# Design decisions and assumptions

Where the specification was ambiguous, the simplest reasonable interpretation
was chosen and recorded here. Numbers mentioned below live in
`src/data/rules.ts` or `src/data/teams.json` unless stated otherwise.

## FactEngine

- **Mastery window.** "The last 5 attempts include at least 4 correct" is
  read as "at least 4 correct among the last (up to) 5 attempts", so four fast
  correct answers in a row are enough. The median uses correct answers only.
- **Familiar.** The spec does not define it. Familiar means: the last attempt
  was correct, at least 2 of the recent attempts were correct, and at least 60%
  of recent attempts were correct. Learning is anything seen that is neither
  Mastered nor Familiar. One error on a Familiar fact drops it to Learning, which puts it
  back in the "hard" pool. A single slip on a Mastered fact can leave it
  Mastered, as the 4-of-5 rule allows.
- **Which table a fact belongs to.** A fact belongs to the group of its
  *later-introduced* factor. So 2 x 5 is in group 1, 2 x 3 in group 2, and
  7 x 2 in group 3. This gives groups of 16, 48 and 80 facts, and "introducing
  the 7s" really does mean every fact with a 7 in it. The alternative (the
  earlier factor) would put 80 facts in the first group and, at 2 new facts per
  match, keep a beginner on the 1/2/5/10 tables for about 40 matches.
- **Unlocking.** A group unlocks when 70% of the previous group is Familiar or
  better. This matches the promotion threshold (70% Mastered), so promotion
  always implies the next group is unlocked.
- **New-fact budget and bootstrapping.** At most 2 new facts per match, as
  specified. A brand-new learner would otherwise have nothing to practise, so
  while fewer than 8 facts have been seen, new facts are introduced without using the budget.
  A new fact is shown on a short "New fact!" teaching card before it is asked,
  so the learner is not tested on something never shown.
- **Spaced repetition** counts in *selections*, not wall-clock time, so it
  works the same within a match and across sessions. A wrong answer sets the
  fact due again in 2-3 selections and marks it "relearn". Relearn facts
  override the requested difficulty, so they really do come back within a few
  questions even if the learner keeps choosing easy short passes. Correct answers push the fact back 5
  (Learning) or 12 (Familiar) selections. Mastered facts start at 24 and double
  each time up to 400.
- **Partner link.** When a x b becomes Mastered, b x a gets a priority boost.
  If b x a is unseen, it becomes the next new fact to introduce. The boost
  is used up once the partner is selected.
- **Difficulty pools.** Easy = Mastered + Familiar; hard = Learning; medium is
  a 50/50 pick between the two. An empty pool falls back to the other one. The same
  fact is never asked twice in a row when another is available.
- **"Harder" facts for long balls and long-range shots** use a `hardness`
  weight within the pool, favouring facts with lower recent accuracy and larger
  products. Long-range shots use hardness 0.9 and in-box shots 0.3.

## MatchEngine

- **Zones are relative to the team in possession** (0 Defence ... 3 Penalty
  Area) and are mirrored when possession changes. The pitch always shows the
  learner attacking left to right.
- **Turnovers.** A normal error gives the opponent the ball at the mirrored
  zone. Losing it in your own Defence therefore puts them in your Penalty Area.
  Long-ball errors concede at least in the Attacking Third ("dangerous area").
  Against a `breakaway` team, *any* error on the ball puts the opponent straight into the
  Penalty Area, leaving only a save to stop them.
- **Defence.** The learner chooses Tackle (medium fact) or Intercept (hard
  fact). A correct tackle wins the ball where it is, capped at the Attacking Third,
  so a tackle never gives an instant tap-in. An interception wins it one zone further
  up. Each defensive error moves the opponent forward one zone. In the Penalty Area the only option is
  Save. `tacklesToWin` (an extension field) lets Possession Side teams "keep
  the ball well": they need 2 correct tackles. A single correct
  interception still wins the ball.
- **Failed saves.** A failed save is a goal with probability
  `opponentFinishing` (0.75) plus the rubber-band offset; otherwise the shot goes wide.
  Without this, a struggling learner facing an Offside Trap conceded 13+ goals per match in simulation.
- **Shots.** Goal probability = base (0.5 in the box, 0.28 long range) minus
  keeper strength x 0.45, plus 0.1 for an answer in under 35% of the time limit, minus
  0.15 for one over 75%, clamped to [0.05, 0.9]. A wrong answer on a shot is
  a normal turnover. A saved shot gives the opponent the ball in their Defence.
- **Dribble.** "N medium facts under a short timer" is one shared timer for the
  whole chain (N x the response limit x 0.6). A correct dribble advances one zone and
  "beats a defender", which resets the short-pass count and so breaks a press.
- **Press.** `shortPassAllowance` counts consecutive short passes in the
  current possession. Once it is reached, short passes are "pressed": the fact
  is drawn as hard and the timer drops to 60%. The move button is marked PRESSED.
- **Anti-stalling.** Each learner possession has a 30-second possession clock
  covering thinking and answering time. When it runs out, the ball is turned over (no
  breakaway penalty). Short passes always advance, so the clock mainly stops a
  learner from sitting on the move-choice screen.
- **Match length.** Time mode: two halves of `halfLengthSec` (default 180).
  The clock runs during questions and move choices but pauses during feedback
  overlays, pause and half-time. Possession mode: a half ends when the learner
  would start possession N+1. The clock never ends a half mid-question;
  the current answer resolves first.
- **Rubber-banding.** Opponent offset = clamp((accuracy over the last 12
  answers - 0.75) x 0.6, +/-0.15), active after 4 answers. It raises or lowers
  keeper strength, shortens or lengthens the answer timer by the same share, and shifts the
  opponent's finishing on failed saves.
- **Responses slower than the time limit** count as wrong even if the value is
  right, so the engine does not have to trust the UI's timer.
- **Quitting** a match from the pause menu does not record a result, but fact
  attempts made so far are kept, since they are real practice data.

### Balance note (from the simulation)

With the current numbers, learners at 55-60% accuracy get close matches
(about 2.5 goals each, winning about half). A 75% learner wins about 6-1, and a
95% learner wins about 9-0 while the rubber band is at its +0.15 limit. The spec
asks for *modest, bounded* rubber-banding, so very fluent learners win clearly;
promotion is what moves them on to harder divisions. To tighten scores, lower
`shotBaseInBox` / `shotBaseLongRange` or raise `rubberBandLimit`.

## TeamProfiles

- 18 clubs, six per division, one per archetype, so adaptive scheduling
  always has every style available.
- Two extension fields: `tacklesToWin` and `colors`. `longBall.difficulty`
  is honoured. All current teams use "hard".
- **Physical Defence** uses 3-fact dribbles in divisions 1-2 and 4 in division 3.
  Physical teams are also drawn larger on the pitch.
- **Possession Side**: unlimited short passes, longer timers, 2 tackles to win the ball.
- **Specialist Club** has a default table in the data, which adaptive
  scheduling may override for a fixture (see below).
- Division 3 non-press teams have `shortPassAllowance: 4`, one of the
  "stricter parameters" in the top division.
- A 0-1 `strengthIndex` (timer, keeper, tackles, chain length, press,
  breakaway) is used for AI-vs-AI results and for matching opponents to form.

## LeagueManager

- **Division numbering.** Division 1 is the entry level (Grassroots League) and 3
  is the top (Premier League), matching the spec's example team (`division: 1`, lenient).
- **Division size.** Each table has the learner plus six clubs (7 teams). A season is a
  single round robin built with the circle method over 8 slots (learner, six
  clubs, bye), so everyone plays six matches and rests once. The learner's rounds can
  be played in any order: adaptive scheduling picks the opponent and the rest
  of that round is simulated. The learner's rest round is simulated at the end.
- **Division facts.** Matches draw only from groups up to the current
  division. From division 2 onward, fact selection is biased toward the division's own
  tables unless the opponent specialises in something else. Promotion needs a top-two
  finish and 70% of *that division's group* Mastered. If only the first holds,
  the learner stays and is told what mastery is needed.
- **Top division.** Finishing top two in division 3 with the threshold met
  counts as "champions" (or runners-up), and the learner stays in division 3.
- **Adaptive scheduling**, in priority order, using the last 3 matches:
  1. Weak tables (recent accuracy < 70% over at least 6 attempts): the division's
     Specialist Club, with its bias overridden to the 1-2 weakest tables. The
     scouting report says so.
  2. Short passes > 70% of build-up moves (short + long + dribble; shots are
     left out because every attack needs one): High Press.
  3. Long balls + interceptions < 12% of choices, measured only in matches where
     the long ball was allowed: Low Block or Offside Trap.
  4. Otherwise, the opponent's strength is matched to recent accuracy (55% maps
     to the weakest club, 95% to the strongest). A new learner starts against the
     gentlest club.
  A trigger is skipped if that style has already been played this season.
- **AI results** use Poisson goals driven by the strength difference.
- **Relegation** is off by default. When on (Settings), the bottom club drops a
  division.

## Storage

- One `localStorage` key holding `{ schemaVersion, profiles[], activeProfileId }`.
  Each profile holds its fact records, league state and settings.
- Schema version 2. `MIGRATIONS[n]` upgrades n to n+1: 0 to 1 wraps the unversioned
  prototype format, and 1 to 2 moves global settings onto profiles. Loading also
  fills missing fields so partial or hand-edited saves still work.
- Saves from a *newer* version, or unreadable JSON, are not overwritten
  silently: the raw text is copied to a timestamped backup key first.
- If `localStorage` is unavailable (for example, some private modes), the game runs on
  an in-memory store for the session.

## UI

- No framework: small DOM helpers plus a canvas renderer. This keeps the
  bundle to about 70 KB (22 KB gzipped) and the engines free of UI concerns.
- Settings are per profile, so siblings can have different timers. The Sound toggle is always
  visible. Before a profile is chosen it only affects the current session.
- Answer input has no text field. On-screen and physical keys feed the same
  handler, which avoids the tablet's own keyboard popping up.
- Deleting a profile needs a second tap within 4 seconds, rather than a
  modal dialog.
- Dev-only hooks (`window.__app`, `window.__match`, and a `?speed=N` clock
  multiplier used for browser testing) are stripped from production builds.
