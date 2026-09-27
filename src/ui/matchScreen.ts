/**
 * Match screen: scoreboard, canvas pitch, action choice, question + number pad,
 * and feedback overlays. Drives a MatchEngine from a requestAnimationFrame loop.
 */
import {
  ACTION_LABELS,
  ZONE_NAMES,
  type ActionId,
  type MatchEngine,
  type MatchEvent,
  type MatchReport,
} from '../core/match';
import type { Settings } from '../core/settings';
import { audio } from './audio';
import { clear, formatFact, h, times } from './dom';
import { PitchRenderer } from './pitch';

export interface MatchScreenOptions {
  engine: MatchEngine;
  playerName: string;
  playerColor: string;
  settings: Settings;
  onFinish(report: MatchReport): void;
  onQuit(): void;
}

const ACTION_KEYS: Record<ActionId, string> = {
  short: 'P',
  long: 'L',
  dribble: 'D',
  shot: 'S',
  tackle: 'T',
  intercept: 'I',
  save: 'S',
};

const ACTION_HINTS: Record<ActionId, string> = {
  short: '1 easy fact, +1 zone',
  long: '1 hard fact, +2 zones',
  dribble: 'Fact chain, +1 zone',
  shot: 'Hard fact, try to score',
  tackle: 'Win the ball back',
  intercept: 'Hard fact, win it higher',
  save: 'Stop their shot!',
};

const NEW_FACT_MS = 2600;

export class MatchScreen {
  readonly el: HTMLElement;
  private readonly engine: MatchEngine;
  private readonly pitch: PitchRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly scoreEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly possEl: HTMLElement;
  private readonly commentaryEl: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly overlay: HTMLElement;
  private timerFill: HTMLElement | null = null;
  private timerText: HTMLElement | null = null;
  private answerEl: HTMLElement | null = null;

  private input = '';
  private blocked = false;
  private paused = false;
  private pausedAt = 0;
  private questionShownAt = 0;
  private renderedFactKey = '';
  private raf = 0;
  private last = 0;
  private destroyed = false;
  private readonly onKey = (e: KeyboardEvent) => this.handleKey(e);
  private readonly onResize = () => this.pitch.resize();

  constructor(private readonly opts: MatchScreenOptions) {
    this.engine = opts.engine;
    const team = this.engine.team;
    this.canvas = h('canvas', { class: 'pitch', 'aria-hidden': 'true' });
    this.scoreEl = h('div', { class: 'score', 'aria-live': 'polite' });
    this.clockEl = h('div', { class: 'clock' });
    this.possEl = h('div', { class: 'possession-clock' });
    this.commentaryEl = h('p', { class: 'commentary', role: 'status', 'aria-live': 'polite' });
    this.panel = h('section', { class: 'match-panel' });
    this.overlay = h('div', { class: 'overlay hidden', role: 'dialog', 'aria-live': 'assertive' });

    this.el = h(
      'main',
      { class: 'screen match-screen' },
      h(
        'header',
        { class: 'scoreboard' },
        h('span', { class: 'team-name home' }, h('span', { class: 'kit circle', style: `background:${opts.playerColor}` }), opts.playerName),
        this.scoreEl,
        h('span', { class: 'team-name away' }, team.name, h('span', { class: 'kit diamond', style: `background:${team.colors.primary}` })),
        this.clockEl,
        h('button', { class: 'btn small ghost pause-btn', onclick: () => this.pause(), 'aria-label': 'Pause match' }, 'Pause'),
      ),
      h('div', { class: 'pitch-wrap' }, this.canvas, this.overlay),
      this.possEl,
      this.commentaryEl,
      this.panel,
    );

    this.pitch = new PitchRenderer(this.canvas, {
      ourColor: opts.playerColor,
      theirColor: team.colors.primary,
      theirTrim: team.colors.secondary,
      style: team.style,
      highContrast: opts.settings.highContrast,
      reducedMotion: opts.settings.reducedMotion,
    });
  }

  mount(root: HTMLElement): void {
    root.appendChild(this.el);
    this.pitch.resize();
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.onResize);
    this.say(`Kick-off! You attack from left to right against ${this.engine.team.name}.`);
    audio.play('whistle');
    this.render();
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onResize);
    this.el.remove();
  }

  // ---- Main loop --------------------------------------------------------------

  private loop(now: number): void {
    if (this.destroyed) return;
    const dt = Math.min(100, now - this.last);
    this.last = now;
    if (!this.blocked && !this.paused) {
      const events = this.engine.tick(dt);
      if (events.length) void this.handle(events);
      else if (this.engine.phase === 'question') this.checkTimeout(now);
    }
    this.updateHud(now);
    this.pitch.setState(this.engine.possession, this.engine.zone);
    this.pitch.frame(dt);
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  private checkTimeout(now: number): void {
    const limit = this.engine.currentLimitMs;
    if (limit === null) return;
    if (now - this.questionShownAt >= limit) this.submit(true);
  }

  // ---- Input --------------------------------------------------------------------

  private handleKey(e: KeyboardEvent): void {
    if (this.paused) {
      if (e.key === 'Escape') this.resume();
      return;
    }
    if (this.blocked) return;
    if (e.key === 'Escape') {
      this.pause();
      return;
    }
    if (this.engine.phase === 'question') {
      if (/^[0-9]$/.test(e.key)) {
        this.typeDigit(e.key);
        e.preventDefault();
      } else if (e.key === 'Backspace') {
        this.backspace();
        e.preventDefault();
      } else if (e.key === 'Enter') {
        this.submit(false);
        e.preventDefault();
      }
      return;
    }
    if (this.engine.phase === 'attack' || this.engine.phase === 'defend') {
      const key = e.key.toUpperCase();
      const opt = this.engine.availableActions().find((o) => ACTION_KEYS[o.id] === key && o.enabled);
      if (opt && !(e.target instanceof HTMLButtonElement && e.key === 'Enter')) {
        this.choose(opt.id);
        e.preventDefault();
      }
    }
  }

  private typeDigit(d: string): void {
    if (this.input.length >= 3) return;
    this.input += d;
    audio.play('click');
    this.updateAnswer();
  }

  private backspace(): void {
    this.input = this.input.slice(0, -1);
    this.updateAnswer();
  }

  private updateAnswer(): void {
    if (this.answerEl) {
      this.answerEl.textContent = this.input || '?';
      this.answerEl.classList.toggle('empty', !this.input);
    }
  }

  private choose(id: ActionId): void {
    if (this.blocked || this.paused) return;
    this.engine.chooseAction(id);
    this.input = '';
    void this.showQuestion();
  }

  /** Show the current fact, with a teaching card first if it is new to the learner. */
  private async showQuestion(): Promise<void> {
    const fact = this.engine.currentFact;
    if (!fact) return;
    if (fact.isNew) {
      this.blocked = true;
      audio.play('newFact');
      await this.flash(
        h(
          'div',
          { class: 'card new-fact' },
          h('p', { class: 'overlay-kicker' }, 'New fact!'),
          h('p', { class: 'overlay-big' }, `${formatFact(fact.a, fact.b)} = ${fact.answer}`),
          h('p', {}, 'Remember it. It is coming up next.'),
        ),
        NEW_FACT_MS,
      );
      this.blocked = false;
    }
    this.questionShownAt = performance.now();
    this.render();
  }

  private submit(timedOut: boolean): void {
    if (this.engine.phase !== 'question' || this.blocked) return;
    if (!timedOut && this.input === '') return;
    const elapsed = performance.now() - this.questionShownAt;
    const events = timedOut ? this.engine.timeout() : this.engine.answer(Number(this.input), elapsed);
    this.input = '';
    void this.handle(events);
  }

  // ---- Event presentation -----------------------------------------------------

  private async handle(events: MatchEvent[]): Promise<void> {
    this.blocked = true;
    const lines: string[] = [];
    const theirName = this.engine.team.name;
    for (const e of events) {
      switch (e.type) {
        case 'correct':
          audio.play('correct');
          break;
        case 'incorrect': {
          audio.play('wrong');
          await this.flash(
            h(
              'div',
              { class: 'card correction' },
              h('p', { class: 'overlay-kicker' }, e.timedOut ? "Time's up!" : 'Not quite'),
              h('p', { class: 'overlay-big' }, `${formatFact(e.fact.a, e.fact.b)} = ${e.fact.answer}`),
              e.given !== null && !e.timedOut ? h('p', {}, `You said ${e.given}.`) : null,
            ),
            this.engine.rules.correctionDisplayMs,
          );
          break;
        }
        case 'advance':
          lines.push(
            `${ACTION_LABELS[e.action]} complete! Into the ${ZONE_NAMES[e.to]}.`,
          );
          break;
        case 'beat-defender':
          lines.push('You beat a defender!');
          break;
        case 'pressed':
          lines.push(`${theirName} are pressing! Short passes are harder now. Try a dribble or long ball.`);
          break;
        case 'turnover':
          if (e.reason === 'possession-clock') lines.push('Too slow! The possession clock ran out.');
          else if (e.reason === 'shot-saved') lines.push('The keeper has it.');
          else if (e.breakaway) lines.push(`Caught by the offside trap! ${theirName} break away!`);
          else lines.push(`${theirName} win the ball.`);
          break;
        case 'shot':
          lines.push(
            e.goal ? 'What a strike!' : `Saved! (${Math.round(e.probability * 100)}% chance)`,
          );
          if (!e.goal) audio.play('save');
          break;
        case 'goal':
          if (e.side === 'player') {
            audio.play('goal');
            this.pitch.pulse();
            await this.flash(h('div', { class: 'card goal' }, h('p', { class: 'overlay-big' }, 'GOAL!'), h('p', {}, this.scoreText())), 1700);
          } else {
            audio.play('conceded');
            await this.flash(h('div', { class: 'card conceded' }, h('p', { class: 'overlay-big' }, `${theirName} score`), h('p', {}, this.scoreText())), 1700);
          }
          break;
        case 'tackle-progress':
          lines.push(`Good tackle! ${e.made} of ${e.needed}. They still have it.`);
          break;
        case 'won-ball':
          lines.push(e.action === 'intercept' ? 'Intercepted! Counter-attack!' : 'Tackle won! Your ball.');
          break;
        case 'opponent-advance':
          lines.push(
            e.zone === 3 ? `${theirName} are through on goal! Make a save!` : `${theirName} move forward.`,
          );
          break;
        case 'save':
          audio.play('save');
          lines.push('Great save!');
          break;
        case 'kickoff':
          if (e.side === 'opponent') lines.push(`${theirName} kick off.`);
          else lines.push('You kick off.');
          break;
        case 'halftime':
          audio.play('whistle');
          await this.halftime();
          if (this.destroyed) return;
          lines.length = 0;
          lines.push(`Second half! ${theirName} kick off.`);
          break;
        case 'fulltime':
          audio.play('whistle');
          await this.flash(h('div', { class: 'card' }, h('p', { class: 'overlay-big' }, 'Full time!'), h('p', {}, this.scoreText())), 1500);
          if (!this.destroyed) this.opts.onFinish(this.engine.report());
          return;
        case 'new-fact':
          break;
      }
    }
    if (lines.length) this.say(lines.join(' '));
    this.blocked = false;
    if (this.engine.phase === 'question') {
      // Next fact in a dribble chain.
      void this.showQuestion();
    } else {
      this.render();
    }
  }

  private flash(content: HTMLElement, ms: number): Promise<void> {
    clear(this.overlay);
    this.overlay.appendChild(content);
    this.overlay.classList.remove('hidden');
    return new Promise((resolve) =>
      setTimeout(() => {
        this.overlay.classList.add('hidden');
        clear(this.overlay);
        resolve();
      }, ms),
    );
  }

  private halftime(): Promise<void> {
    return new Promise((resolve) => {
      clear(this.overlay);
      const btn = h(
        'button',
        {
          class: 'btn primary big',
          onclick: () => {
            this.overlay.classList.add('hidden');
            clear(this.overlay);
            const events = this.engine.startSecondHalf();
            void events; // Kick-off events are narrated by the caller.
            resolve();
          },
        },
        'Start second half',
      );
      this.overlay.appendChild(
        h('div', { class: 'card' }, h('p', { class: 'overlay-big' }, 'Half time'), h('p', {}, this.scoreText()), btn),
      );
      this.overlay.classList.remove('hidden');
      btn.focus();
    });
  }

  private pause(): void {
    if (this.paused || this.engine.isOver) return;
    this.paused = true;
    this.pausedAt = performance.now();
    const resumeBtn = h('button', { class: 'btn primary big', onclick: () => this.resume() }, 'Resume');
    clear(this.overlay);
    this.overlay.appendChild(
      h(
        'div',
        { class: 'card' },
        h('p', { class: 'overlay-big' }, 'Paused'),
        resumeBtn,
        h('button', { class: 'btn ghost', onclick: () => this.opts.onQuit() }, 'Quit match (result not saved)'),
      ),
    );
    this.overlay.classList.remove('hidden');
    resumeBtn.focus();
  }

  private resume(): void {
    if (!this.paused) return;
    this.paused = false;
    // Don't count paused time against the answer timer.
    this.questionShownAt += performance.now() - this.pausedAt;
    this.overlay.classList.add('hidden');
    clear(this.overlay);
    this.last = performance.now();
  }

  private say(text: string): void {
    this.commentaryEl.textContent = text;
  }

  private scoreText(): string {
    const s = this.engine.score;
    return `${this.opts.playerName} ${s.player} - ${s.opponent} ${this.engine.team.name}`;
  }

  // ---- Rendering --------------------------------------------------------------

  private updateHud(now: number): void {
    const e = this.engine;
    this.scoreEl.textContent = `${e.score.player} - ${e.score.opponent}`;
    const half = e.half === 1 ? '1st half' : '2nd half';
    if (e.lengthMode === 'time') {
      const left = Math.max(0, e.halfLengthMs - e.clockMs);
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      this.clockEl.textContent = `${half} ${m}:${String(s).padStart(2, '0')}`;
    } else {
      this.clockEl.textContent = `${half} - possession ${Math.min(e.playerPossessions, e.possessionsPerHalf)}/${e.possessionsPerHalf}`;
    }
    if (e.possession === 'player' && (e.phase === 'attack' || e.phase === 'question')) {
      const left = Math.max(0, e.possessionClockLimitMs - e.possessionClockMs);
      const pct = (left / e.possessionClockLimitMs) * 100;
      this.possEl.innerHTML = '';
      this.possEl.append(
        h('span', {}, `Possession clock: ${Math.ceil(left / 1000)}s`),
        h('span', { class: 'bar' }, h('span', { class: 'fill', style: `width:${pct}%` })),
      );
      this.possEl.classList.toggle('low', pct < 30);
    } else {
      this.possEl.textContent = e.possession === 'opponent' ? `${e.team.name} have the ball` : '';
    }
    if (this.timerFill && this.timerText && e.phase === 'question' && !this.blocked) {
      const limit = e.currentLimitMs;
      if (limit === null) {
        this.timerText.textContent = 'No time limit';
        this.timerFill.style.width = '100%';
      } else {
        const left = Math.max(0, limit - (now - this.questionShownAt));
        this.timerFill.style.width = `${(left / limit) * 100}%`;
        this.timerText.textContent = `${Math.ceil(left / 1000)}s`;
        this.timerFill.parentElement?.classList.toggle('low', left / limit < 0.3);
      }
    }
  }

  private render(): void {
    const e = this.engine;
    clear(this.panel);
    this.timerFill = null;
    this.timerText = null;
    this.answerEl = null;

    if (e.phase === 'question' && e.question) {
      const q = e.question;
      const fact = q.facts[q.index];
      const key = `${fact.id}:${q.index}:${q.action}`;
      if (key !== this.renderedFactKey) this.input = '';
      this.renderedFactKey = key;
      this.timerFill = h('span', { class: 'fill' });
      this.timerText = h('span', { class: 'timer-text' });
      this.answerEl = h('span', { class: 'answer empty', 'aria-live': 'polite' }, '?');
      const tags: string[] = [ACTION_LABELS[q.action]];
      if (q.facts.length > 1) tags.push(`fact ${q.index + 1} of ${q.facts.length}`);
      if (q.pressed) tags.push('PRESSED');
      if (q.longRange) tags.push('long range');
      this.panel.append(
        h('div', { class: 'question' },
          h('p', { class: 'question-tag' }, tags.join(' - ')),
          h('p', { class: 'question-text', 'aria-label': `What is ${fact.a} times ${fact.b}?` },
            h('span', {}, `${fact.a} ${times} ${fact.b} = `), this.answerEl),
          h('div', { class: 'timer', role: 'timer' }, h('span', { class: 'bar' }, this.timerFill), this.timerText),
        ),
        this.numpad(),
      );
      this.updateAnswer();
      return;
    }

    if (e.phase === 'attack' || e.phase === 'defend') {
      const attacking = e.phase === 'attack';
      const where = attacking
        ? `Your ball in the ${ZONE_NAMES[e.zone]}.`
        : e.zone === 3
          ? `${e.team.name} are shooting!`
          : `${e.team.name} have the ball in their ${ZONE_NAMES[e.zone]}.`;
      const options = e.availableActions();
      this.panel.append(
        h('p', { class: 'prompt' }, where, ' ', attacking ? 'Choose a move:' : 'Defend:'),
        h(
          'div',
          { class: `actions count-${options.length}` },
          options.map((o) =>
            h(
              'button',
              {
                class: `btn action ${o.enabled ? '' : 'disabled'} ${o.pressed ? 'pressed' : ''}`,
                disabled: !o.enabled,
                'aria-disabled': String(!o.enabled),
                onclick: () => this.choose(o.id),
              },
              h('span', { class: 'action-label' }, ACTION_LABELS[o.id], h('kbd', {}, ACTION_KEYS[o.id])),
              h('span', { class: 'action-hint' }, o.enabled ? ACTION_HINTS[o.id] : 'Not available'),
              o.note ? h('span', { class: 'action-note' }, o.enabled ? o.note : `✖ ${o.note}`) : null,
            ),
          ),
        ),
      );
    }
  }

  private numpad(): HTMLElement {
    const key = (label: string, onClick: () => void, cls = '', aria?: string) =>
      h('button', { class: `btn key ${cls}`, onclick: onClick, 'aria-label': aria ?? label }, label);
    const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, () => this.typeDigit(d)));
    return h(
      'div',
      { class: 'numpad', role: 'group', 'aria-label': 'Number pad' },
      digits,
      key('⌫', () => this.backspace(), 'back', 'Delete'),
      key('0', () => this.typeDigit('0')),
      key('✓', () => this.submit(false), 'enter', 'Submit answer'),
    );
  }
}
