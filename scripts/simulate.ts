/**
 * Plays 50 league matches with a scripted learner whose accuracy and play
 * style change over time, then reports whether difficulty adapted.
 *
 *   npm run simulate              # default seed
 *   npm run simulate -- --seed 7  # another seed
 *   npm run simulate -- --json    # machine-readable output
 */
import { simulate } from '../src/sim/simulate';

const args = process.argv.slice(2);
const seedArg = args.indexOf('--seed');
const seed = seedArg >= 0 ? Number(args[seedArg + 1]) : 2024;
const result = simulate(seed);

if (args.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  const num = (x: number, d = 2) => x.toFixed(d);
  console.log(`\nTimes Table Striker simulation (seed ${seed}, ${result.matches.length} matches)\n`);
  console.log(
    pad('#', 4) + pad('Learner phase', 32) + pad('Acc', 6) + pad('Div', 4) + pad('Opponent', 22) +
      pad('Style', 18) + pad('Picked for', 22) + pad('Str', 6) + pad('RB', 7) + pad('Diff', 6) + pad('Score', 7) + 'Mastered',
  );
  for (const m of result.matches) {
    console.log(
      pad(m.index, 4) + pad(m.phase, 32) + pad(num(m.accuracy), 6) + pad(m.division, 4) + pad(m.opponent, 22) +
        pad(m.style, 18) + pad(m.reason, 22) + pad(num(m.strength), 6) + pad((m.rubberBand >= 0 ? '+' : '') + num(m.rubberBand), 7) +
        pad(num(m.difficulty), 6) + pad(m.score, 7) + m.mastered,
    );
  }
  console.log('\nBy phase:');
  for (const p of result.byPhase) {
    console.log(`  ${pad(p.label, 34)} accuracy ${num(p.accuracy)}  opponent difficulty ${num(p.difficulty)}  rubber band ${num(p.rubberBand)}`);
  }
  console.log('\nFixture reasons:', result.reasons);
  console.log(
    `Correlation: accuracy vs opponent difficulty r = ${num(result.correlation.accuracyVsDifficulty)}, ` +
      `accuracy vs rubber band r = ${num(result.correlation.accuracyVsRubberBand)}`,
  );
  console.log('\nChecks:');
  for (const c of result.checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
  console.log('');
}

process.exitCode = result.checks.every((c) => c.pass) ? 0 : 1;
