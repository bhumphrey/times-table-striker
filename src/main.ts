// Milestone 2 harness: a single match against a default opponent.
import './styles.css';
import { FactEngine, createFactState } from './core/facts';
import { MatchEngine } from './core/match';
import { Rng, randomSeed } from './core/rng';
import { defaultSettings } from './core/settings';
import { getTeam } from './core/teams';
import { MatchScreen } from './ui/matchScreen';

const root = document.getElementById('app')!;
const seed = randomSeed();
const facts = new FactEngine(createFactState(), new Rng(seed));
const settings = defaultSettings();
const engine = new MatchEngine({ team: getTeam('two-town-terriers'), facts, rng: new Rng(seed + 1), division: 1, halfLengthSec: 60 });
const screen = new MatchScreen({
  engine,
  playerName: 'You',
  playerColor: '#1e63d6',
  settings,
  onFinish: (r) => { screen.destroy(); root.textContent = JSON.stringify(r.score); },
  onQuit: () => { screen.destroy(); root.textContent = 'quit'; },
});
screen.mount(root);
