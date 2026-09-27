/**
 * Canvas pitch renderer. Draws the four zones, both teams and the ball.
 * The player always attacks left to right. Team shapes reflect the
 * opponent's style so tactics are visible (e.g. a Low Block sits deep).
 * Teams are distinguished by shape (circles vs diamonds), not only colour.
 */
import type { Side, Zone } from '../core/match';
import type { TeamStyle } from '../core/teams';

export interface PitchOptions {
  ourColor: string;
  theirColor: string;
  theirTrim: string;
  style: TeamStyle;
  highContrast: boolean;
  reducedMotion: boolean;
}

interface Pt {
  x: number;
  y: number;
}

const ZONE_LABELS = ['DEFENCE', 'MIDFIELD', 'ATTACKING THIRD', 'PENALTY AREA'];
const ZONE_LABELS_SHORT = ['DEFENCE', 'MIDFIELD', 'ATTACK', 'BOX'];

export class PitchRenderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private possession: Side = 'player';
  private zone: Zone = 1;
  private ball: Pt = { x: 0.375, y: 0.5 };
  private ours: Pt[] = [];
  private theirs: Pt[] = [];
  private flash = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private opts: PitchOptions,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    const t = this.targets();
    this.ours = t.ours;
    this.theirs = t.theirs;
    this.ball = t.ball;
    this.resize();
  }

  setOptions(opts: Partial<PitchOptions>): void {
    this.opts = { ...this.opts, ...opts };
  }

  setState(possession: Side, zone: Zone): void {
    this.possession = possession;
    this.zone = zone;
  }

  /** Brief highlight of the ball's zone (e.g. on a goal). */
  pulse(): void {
    this.flash = 1;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.max(200, rect.width);
    this.h = Math.max(100, rect.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Column (0..3, left to right) of the ball on screen. */
  private column(): number {
    return this.possession === 'player' ? this.zone : 3 - this.zone;
  }

  private targets(): { ours: Pt[]; theirs: Pt[]; ball: Pt } {
    const col = this.column();
    const bx = (col + 0.5) / 4;
    const ball: Pt = { x: bx, y: 0.5 };
    const clampX = (x: number) => Math.min(0.95, Math.max(0.05, x));
    const attacking = this.possession === 'player';

    // Our five: keeper plus four outfielders around the ball.
    const ourOffsets = attacking ? [-0.2, -0.1, 0, 0.08] : [-0.16, -0.08, -0.04, 0.06];
    const ourYs = [0.22, 0.75, 0.5, 0.32];
    const ours: Pt[] = [{ x: 0.035, y: 0.5 }];
    ourOffsets.forEach((o, i) => ours.push({ x: clampX(bx + o), y: ourYs[i] }));
    if (attacking) ours[3] = { x: bx - 0.02, y: 0.5 }; // Ball carrier.

    const theirs: Pt[] = [{ x: 0.965, y: 0.5 }];
    const ys = [0.2, 0.4, 0.6, 0.8];
    if (!attacking) {
      [-0.08, 0, 0.1, 0.2].forEach((o, i) => theirs.push({ x: clampX(bx + o + 0.02), y: [0.3, 0.5, 0.72, 0.4][i] }));
      theirs[2] = { x: bx + 0.02, y: 0.5 };
    } else {
      switch (this.opts.style) {
        case 'Low Block':
          ys.forEach((y, i) => theirs.push({ x: [0.8, 0.84, 0.84, 0.8][i], y }));
          break;
        case 'High Press':
          [0.05, 0.09, 0.12, 0.2].forEach((o, i) => theirs.push({ x: clampX(bx + o), y: [0.42, 0.6, 0.3, 0.72][i] }));
          break;
        case 'Offside Trap': {
          const line = Math.max(0.55, Math.min(0.85, bx + 0.16));
          ys.forEach((y) => theirs.push({ x: line, y }));
          break;
        }
        default:
          [0.1, 0.15, 0.2, 0.3].forEach((o, i) => theirs.push({ x: clampX(bx + o), y: [0.35, 0.65, 0.5, 0.25][i] }));
      }
    }
    return { ours, theirs, ball };
  }

  frame(dtMs: number): void {
    const t = this.targets();
    const k = this.opts.reducedMotion ? 1 : 1 - Math.exp(-dtMs / 140);
    const lerp = (a: Pt, b: Pt) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
    this.ours = this.ours.map((p, i) => lerp(p, t.ours[i]));
    this.theirs = this.theirs.map((p, i) => lerp(p, t.theirs[i]));
    this.ball = lerp(this.ball, t.ball);
    this.flash = Math.max(0, this.flash - dtMs / 900);
    this.draw();
  }

  private draw(): void {
    const { ctx, w, h } = this;
    const hc = this.opts.highContrast;
    const line = hc ? '#ffffff' : 'rgba(255,255,255,0.85)';

    // Grass stripes per zone.
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = hc ? (i % 2 ? '#0b3d0b' : '#0e4a0e') : i % 2 ? '#2f8f3a' : '#37a042';
      ctx.fillRect((i * w) / 8, 0, w / 8 + 1, h);
    }

    // Active zone highlight (dashed outline + tint, not colour alone).
    const col = this.column();
    ctx.fillStyle = `rgba(255,255,255,${0.1 + this.flash * 0.25})`;
    ctx.fillRect((col * w) / 4, 0, w / 4, h);
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = hc ? '#ffff00' : 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    ctx.strokeRect((col * w) / 4 + 3, 3, w / 4 - 6, h - 6);
    ctx.restore();

    // Markings.
    const pad = 6;
    ctx.strokeStyle = line;
    ctx.lineWidth = hc ? 3 : 2;
    ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);
    ctx.beginPath();
    ctx.moveTo(w / 2, pad);
    ctx.lineTo(w / 2, h - pad);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, h * 0.16, 0, Math.PI * 2);
    ctx.stroke();
    const boxW = w * 0.1;
    const boxH = h * 0.56;
    ctx.strokeRect(pad, (h - boxH) / 2, boxW, boxH);
    ctx.strokeRect(w - pad - boxW, (h - boxH) / 2, boxW, boxH);
    // Goals.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, h * 0.4, pad, h * 0.2);
    ctx.fillRect(w - pad, h * 0.4, pad, h * 0.2);

    // Zone dividers and labels.
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    for (let i = 1; i < 4; i++) {
      if (i === 2) continue;
      ctx.beginPath();
      ctx.moveTo((i * w) / 4, pad);
      ctx.lineTo((i * w) / 4, h - pad);
      ctx.stroke();
    }
    ctx.restore();
    const fontSize = Math.max(10, Math.min(15, w / 55));
    ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labels = w < 560 ? ZONE_LABELS_SHORT : ZONE_LABELS;
    labels.forEach((label, i) => {
      ctx.fillStyle = i === col ? '#ffffff' : 'rgba(255,255,255,0.7)';
      ctx.fillText(label, ((i + 0.5) * w) / 4, pad + 6);
    });

    // Players.
    const r = Math.max(7, Math.min(14, h / 22));
    const oppR = this.opts.style === 'Physical Defence' ? r * 1.3 : r;
    for (const p of this.theirs) this.diamond(p.x * w, p.y * h, oppR, this.opts.theirColor, this.opts.theirTrim);
    for (const p of this.ours) this.circle(p.x * w, p.y * h, r, this.opts.ourColor, '#ffffff');

    // Ball with an arrow showing the direction of attack.
    const bx = this.ball.x * w;
    const by = this.ball.y * h + r * 1.4;
    const dir = this.possession === 'player' ? 1 : -1;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, by, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx + dir * r * 1.1, by);
    ctx.lineTo(bx + dir * r * 2.1, by);
    ctx.lineTo(bx + dir * r * 1.7, by - r * 0.4);
    ctx.moveTo(bx + dir * r * 2.1, by);
    ctx.lineTo(bx + dir * r * 1.7, by + r * 0.4);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  private circle(x: number, y: number, r: number, fill: string, stroke: string): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }

  private diamond(x: number, y: number, r: number, fill: string, stroke: string): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 1.15);
    ctx.lineTo(x + r * 1.15, y);
    ctx.lineTo(x, y + r * 1.15);
    ctx.lineTo(x - r * 1.15, y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}
