import { Peer, type DataConnection } from 'peerjs';
import { LANDMARKS } from './config';
import {
  claim,
  cleanName,
  join,
  leave,
  newRace,
  setScore,
  type RacePlayer,
  type RaceState,
} from './race';
import type { Mode } from './rules';

/**
 * Peer-to-peer rooms over WebRTC. The public PeerJS broker only introduces
 * the browsers; game traffic then flows directly between them. One player
 * hosts and acts as referee; everyone else connects to the host.
 */

const ID_PREFIX = 'grachtengoud-room-';
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const TICK = 100; // ms between position updates
const TIMEOUT = 9000; // ms of silence before a peer counts as gone

export interface PlayerPos {
  id: string;
  x: number;
  y: number;
  h: number;
  m: Mode;
  d: number;
}

type ClientMsg =
  | { t: 'hello'; name: string }
  | { t: 'pos'; x: number; y: number; h: number; m: Mode; d: number; s: number }
  | { t: 'claim'; i: number }
  | { t: 'bye' };

type HostMsg =
  | { t: 'lobby'; you: string; players: RacePlayer[]; started: boolean }
  | { t: 'start'; seed: number }
  | { t: 'pos'; list: PlayerPos[] }
  | { t: 'found'; i: number; by: string; players: RacePlayer[] }
  | { t: 'refused'; reason: string }
  | { t: 'bye' };

export interface SessionEvents {
  onLobby(players: RacePlayer[]): void;
  onStart(seed: number): void;
  onPositions(list: PlayerPos[]): void;
  onFound(index: number, by: string): void;
  onClosed(reason: string): void;
}

function roomCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  return s;
}

export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
}

function describe(err: unknown): string {
  const type = (err as { type?: string } | null)?.type;
  if (type === 'peer-unavailable') return 'No room with that code. Check the code and try again.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed')
    return 'Could not reach the matchmaking service. Check your connection.';
  if (type === 'browser-incompatible') return 'This browser does not support peer-to-peer play.';
  return `Connection problem (${type ?? (err as Error | null)?.message ?? 'unknown'}).`;
}

export class Session {
  code = '';
  selfId = '';
  isHost = false;
  players: RacePlayer[] = [];
  started = false;

  private peer: Peer | null = null;
  private closed = false;
  private timer = 0;
  private lastSend = 0;
  private me: PlayerPos = { id: '', x: 0, y: 0, h: 0, m: 'standing', d: 0 };
  private myScore = 0;

  // host side
  private race: RaceState = newRace(LANDMARKS.length);
  private conns = new Map<string, DataConnection>();
  private positions = new Map<string, PlayerPos>();
  private lastSeen = new Map<string, number>();
  private lastLobby = 0;

  // client side
  private hostConn: DataConnection | null = null;
  private lastHostMsg = 0;

  private constructor(private ev: SessionEvents) {}

  /** Create a room. Resolves once the room code is registered. */
  static host(name: string, ev: SessionEvents): Promise<Session> {
    const s = new Session(ev);
    s.isHost = true;
    s.selfId = 'host';
    s.me.id = 'host';
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const tryOpen = () => {
        const code = roomCode();
        const peer = new Peer(ID_PREFIX + code);
        let opened = false;
        peer.on('open', () => {
          opened = true;
          s.peer = peer;
          s.code = code;
          const r = join(s.race, 'host', name);
          if (r.ok) s.race = r.state;
          s.players = s.race.players;
          peer.on('connection', (conn) => s.accept(conn));
          s.timer = window.setInterval(() => s.hostTick(), TICK);
          resolve(s);
          ev.onLobby(s.players);
        });
        peer.on('error', (err) => {
          if (opened) {
            // Losing the broker after start-up does not break open connections.
            return;
          }
          peer.destroy();
          if ((err as { type?: string }).type === 'unavailable-id' && ++attempts < 5) tryOpen();
          else reject(new Error(describe(err)));
        });
      };
      tryOpen();
    });
  }

  /** Join a room by code. Resolves once the host has let us in. */
  static join(rawCode: string, name: string, ev: SessionEvents): Promise<Session> {
    const s = new Session(ev);
    s.code = normaliseCode(rawCode);
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        s.shutdown();
        reject(new Error(msg));
      };
      const peer = new Peer();
      s.peer = peer;
      const giveUp = window.setTimeout(() => fail('The room did not answer. Check the code.'), 15000);
      peer.on('error', (err) => fail(describe(err)));
      peer.on('open', (id) => {
        s.selfId = id;
        s.me.id = id;
        const conn = peer.connect(ID_PREFIX + s.code, { reliable: true, serialization: 'json' });
        s.hostConn = conn;
        conn.on('open', () => conn.send({ t: 'hello', name: cleanName(name) } satisfies ClientMsg));
        conn.on('data', (raw) => {
          const msg = raw as HostMsg;
          s.lastHostMsg = performance.now();
          if (!settled) {
            if (msg.t === 'refused') return fail(msg.reason);
            if (msg.t === 'lobby') {
              settled = true;
              window.clearTimeout(giveUp);
              s.timer = window.setInterval(() => s.clientTick(), 1000);
              resolve(s);
            }
          }
          s.fromHost(msg);
        });
        conn.on('close', () => {
          if (!settled) fail('The room closed.');
          else s.end('The host left. The room is closed.');
        });
        conn.on('error', (err) => fail(describe(err)));
      });
    });
  }

  // ---------- host ----------

  private accept(conn: DataConnection): void {
    const id = conn.peer;
    conn.on('data', (raw) => {
      const msg = raw as ClientMsg;
      this.lastSeen.set(id, performance.now());
      if (msg.t === 'hello') {
        const r = join(this.race, id, String(msg.name ?? ''));
        if (!r.ok) {
          conn.send({ t: 'refused', reason: r.reason } satisfies HostMsg);
          window.setTimeout(() => conn.close(), 300);
          return;
        }
        this.race = r.state;
        this.conns.set(id, conn);
        this.sendLobby();
      } else if (!this.conns.has(id)) {
        return;
      } else if (msg.t === 'pos') {
        this.positions.set(id, {
          id,
          x: Number(msg.x) || 0,
          y: Number(msg.y) || 0,
          h: Number(msg.h) || 0,
          m: msg.m,
          d: Number(msg.d) || 0,
        });
        this.race = setScore(this.race, id, Number(msg.s));
      } else if (msg.t === 'claim') {
        this.handleClaim(id, Number(msg.i));
      } else if (msg.t === 'bye') {
        this.drop(id);
      }
    });
    conn.on('close', () => this.drop(id));
  }

  private drop(id: string): void {
    if (!this.conns.has(id)) return;
    this.conns.get(id)?.close();
    this.conns.delete(id);
    this.positions.delete(id);
    this.lastSeen.delete(id);
    this.race = leave(this.race, id);
    this.sendLobby();
  }

  private broadcast(msg: HostMsg): void {
    for (const conn of this.conns.values()) if (conn.open) conn.send(msg);
  }

  private sendLobby(): void {
    this.players = this.race.players;
    this.lastLobby = performance.now();
    for (const [id, conn] of this.conns) {
      if (conn.open)
        conn.send({ t: 'lobby', you: id, players: this.players, started: this.race.started } satisfies HostMsg);
    }
    this.ev.onLobby(this.players);
  }

  private handleClaim(id: string, index: number): void {
    const r = claim(this.race, id, index);
    if (!r.accepted) return;
    this.race = r.state;
    this.players = this.race.players;
    this.broadcast({ t: 'found', i: index, by: id, players: this.players });
    this.ev.onLobby(this.players);
    this.ev.onFound(index, id);
  }

  private hostTick(): void {
    if (this.closed) return;
    const now = performance.now();
    for (const [id, seen] of this.lastSeen) if (now - seen > TIMEOUT) this.drop(id);
    if (this.started) {
      this.race = setScore(this.race, 'host', this.myScore);
      const list = [this.me, ...this.positions.values()];
      this.broadcast({ t: 'pos', list });
      this.ev.onPositions(list.filter((p) => p.id !== this.selfId));
    }
    if (now - this.lastLobby > 1000) this.sendLobby(); // also serves as a heartbeat
  }

  /** Host only: begin the race for everyone. */
  start(seed: number): void {
    if (!this.isHost || this.started) return;
    this.started = true;
    this.race = { ...this.race, started: true };
    this.broadcast({ t: 'start', seed });
    this.ev.onStart(seed);
  }

  // ---------- client ----------

  private fromHost(msg: HostMsg): void {
    if (this.closed) return;
    switch (msg.t) {
      case 'lobby':
        this.selfId = msg.you;
        this.me.id = msg.you;
        this.players = msg.players;
        this.ev.onLobby(this.players);
        break;
      case 'start':
        this.started = true;
        this.ev.onStart(msg.seed);
        break;
      case 'pos':
        this.ev.onPositions(msg.list.filter((p) => p.id !== this.selfId));
        break;
      case 'found':
        this.players = msg.players;
        this.ev.onLobby(this.players);
        this.ev.onFound(msg.i, msg.by);
        break;
      case 'bye':
        this.end('The host left. The room is closed.');
        break;
      default:
        break;
    }
  }

  private clientTick(): void {
    if (!this.closed && performance.now() - this.lastHostMsg > TIMEOUT) {
      this.end('Lost the connection to the host.');
    }
  }

  // ---------- both ----------

  /** Call every frame; sends at most ten updates a second. */
  update(x: number, y: number, h: number, m: Mode, d: number, score: number): void {
    this.me = { id: this.selfId, x, y, h, m, d };
    this.myScore = score;
    if (this.isHost || !this.started) return;
    const now = performance.now();
    if (now - this.lastSend < TICK) return;
    this.lastSend = now;
    if (this.hostConn?.open) {
      this.hostConn.send({ t: 'pos', x, y, h, m, d, s: score } satisfies ClientMsg);
    }
  }

  /** Ask the referee for a cache. The answer arrives through onFound. */
  claim(index: number): void {
    if (this.isHost) this.handleClaim('host', index);
    else if (this.hostConn?.open) this.hostConn.send({ t: 'claim', i: index } satisfies ClientMsg);
  }

  nameOf(id: string): string {
    return this.players.find((p) => p.id === id)?.name ?? 'A rival';
  }

  private shutdown(): void {
    this.closed = true;
    window.clearInterval(this.timer);
    try {
      this.peer?.destroy();
    } catch {
      /* already gone */
    }
    this.peer = null;
  }

  private end(reason: string): void {
    if (this.closed) return;
    this.shutdown();
    this.ev.onClosed(reason);
  }

  /** Leave on purpose (no onClosed callback). */
  close(): void {
    if (this.closed) return;
    try {
      if (this.isHost) this.broadcast({ t: 'bye' });
      else if (this.hostConn?.open) this.hostConn.send({ t: 'bye' } satisfies ClientMsg);
    } catch {
      /* best effort */
    }
    this.shutdown();
  }
}
