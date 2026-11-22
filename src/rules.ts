import { DETECT, STAMINA } from './config';

export type Mode = 'standing' | 'walking' | 'running' | 'bent' | 'digging';

export const MODE_LABEL: Record<Mode, string> = {
  standing: 'Standing',
  walking: 'Walking',
  running: 'Running',
  bent: 'Bent over',
  digging: 'Digging',
};

export interface StaminaState {
  value: number; // 0..100
  exhausted: boolean;
}

export function canRun(s: StaminaState): boolean {
  return !s.exhausted && s.value > 0;
}

export function stepStamina(s: StaminaState, mode: Mode, dt: number): StaminaState {
  let value = s.value;
  let exhausted = s.exhausted;
  if (mode === 'running') {
    value = Math.max(0, value - STAMINA.drain * dt);
    if (value <= 0) exhausted = true;
  } else {
    const rate = mode === 'walking' ? STAMINA.refillWalk : STAMINA.refillRest;
    value = Math.min(100, value + rate * dt);
    if (exhausted && value >= STAMINA.recoverAt) exhausted = false;
  }
  return { value, exhausted };
}

export interface Reading {
  bars: number; // 0..4
  message: string;
  /** Arrow angle relative to the facing direction, degrees clockwise; null = no arrow. */
  arrow: number | null;
  /** Close enough to dig while bent over. */
  onTarget: boolean;
}

const BAR_TEXT = ['', 'Faint signal', 'Getting warmer', 'Hot', 'Very hot. Bend over to pinpoint it.'];

/**
 * @param d straight-line distance to the nearest unfound cache (Infinity if none)
 * @param relBearing bearing to that cache minus the character's heading
 */
export function readDetector(mode: Mode, d: number, relBearing: number): Reading {
  if (mode === 'running') {
    return { bars: 0, message: 'Running. Slow down to read the detector.', arrow: null, onTarget: false };
  }
  let bars = 0;
  for (const limit of DETECT.bars) if (d <= limit) bars++;

  if (mode === 'bent' || mode === 'digging') {
    if (d <= DETECT.digRange) {
      return { bars, message: 'Right under your feet. Dig!', arrow: relBearing, onTarget: true };
    }
    if (d <= DETECT.bentRange) {
      return { bars, message: `${Math.round(d)} m`, arrow: relBearing, onTarget: false };
    }
    return {
      bars,
      message: 'Nothing within 90 m. Stand up and walk to find a signal.',
      arrow: null,
      onTarget: false,
    };
  }
  return {
    bars,
    message: bars ? BAR_TEXT[bars] : 'No signal. Keep exploring.',
    arrow: null,
    onTarget: false,
  };
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
