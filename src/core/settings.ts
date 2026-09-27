/** Per-profile settings. Plain data, shared by engine setup, storage and UI. */

export interface Settings {
  muted: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
  /** Multiplier on answer timers; null = timers off. */
  timerScale: number | null;
  lengthMode: 'time' | 'possessions';
  halfLengthSec: number;
  possessionsPerHalf: number;
  relegationEnabled: boolean;
}

export const TIMER_SCALES: { label: string; value: number | null }[] = [
  { label: 'Standard', value: 1 },
  { label: 'Relaxed (1.5x)', value: 1.5 },
  { label: 'Extra time (2x)', value: 2 },
  { label: 'No timer', value: null },
];

export function defaultSettings(prefersReducedMotion = false): Settings {
  return {
    muted: false,
    highContrast: false,
    reducedMotion: prefersReducedMotion,
    timerScale: 1,
    lengthMode: 'time',
    halfLengthSec: 180,
    possessionsPerHalf: 6,
    relegationEnabled: false,
  };
}
