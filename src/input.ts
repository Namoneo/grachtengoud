import { clamp } from './geo';

export type Action = 'bend' | 'dig' | 'map' | 'logbook' | 'camera' | 'keys' | 'close';

const GAME_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
  'Space',
  'KeyC',
  'KeyE',
  'KeyM',
  'KeyL',
  'KeyV',
  'KeyK',
  'Escape',
]);
const ACTIONS: Record<string, Action> = {
  KeyC: 'bend',
  Space: 'dig',
  KeyE: 'dig',
  KeyM: 'map',
  KeyL: 'logbook',
  KeyV: 'camera',
  KeyK: 'keys',
  Escape: 'close',
};

export class Input {
  private keys = new Set<string>();
  private stick = { x: 0, y: 0 };
  private runHeld = false;

  constructor(private onAction: (a: Action) => void) {
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !GAME_KEYS.has(e.code)) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      e.preventDefault(); // arrows and space must not scroll the page or click focused buttons
      if (!e.repeat) {
        this.keys.add(e.code);
        const action = ACTIONS[e.code];
        if (action) this.onAction(action);
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (GAME_KEYS.has(e.code)) e.preventDefault();
    });
    const clear = () => {
      this.keys.clear();
      this.runHeld = false;
    };
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** -1..1, positive = forward. */
  get forward(): number {
    const k = (this.down('KeyW', 'ArrowUp') ? 1 : 0) - (this.down('KeyS', 'ArrowDown') ? 1 : 0);
    return clamp(k - this.stick.y, -1, 1);
  }

  /** -1..1, positive = clockwise (right). */
  get turn(): number {
    const k = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    return clamp(k + this.stick.x, -1, 1);
  }

  get run(): boolean {
    return this.runHeld || this.down('ShiftLeft', 'ShiftRight');
  }

  /** Wire the on-screen joystick and buttons. */
  bindTouch(base: HTMLElement, knob: HTMLElement, runBtn: HTMLElement): void {
    let id: number | null = null;
    const R = 46;
    const move = (e: PointerEvent) => {
      const r = base.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const dead = (v: number) => (Math.abs(v) < 0.2 ? 0 : (v - Math.sign(v) * 0.2) / 0.8);
      this.stick.x = dead(dx / R);
      this.stick.y = dead(dy / R);
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      this.stick.x = this.stick.y = 0;
      knob.style.transform = '';
    };
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId;
      base.setPointerCapture(id);
      move(e);
    });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) move(e);
    });
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);

    const hold = (on: boolean) => (e: PointerEvent) => {
      e.preventDefault();
      this.runHeld = on;
      runBtn.classList.toggle('held', on);
    };
    runBtn.addEventListener('pointerdown', hold(true));
    runBtn.addEventListener('pointerup', hold(false));
    runBtn.addEventListener('pointercancel', hold(false));
    runBtn.addEventListener('pointerleave', hold(false));
  }
}
