/**
 * Scaffold UI: join a room, see the synced authoritative state, and dispatch the
 * two placeholder actions (end turn / ping). This exists to prove the networked
 * deterministic loop end-to-end. The real board renderer replaces it next.
 */

import type { RoomPlayer } from '@friedrich/engine';
import { NATION_ORDER, type FriedrichState } from '@friedrich/game';
import { GameConnection } from './net.js';

const app = document.getElementById('app')!;

let playerId: string | null = null;
let seat = -1;
let players: RoomPlayer[] = [];
let state: FriedrichState | null = null;
let connected = false;

const conn = new GameConnection(undefined, (msg) => {
  switch (msg.t) {
    case 'joined':
      playerId = msg.playerId;
      seat = msg.seat;
      break;
    case 'players':
      players = [...msg.players];
      break;
    case 'state':
      state = msg.view as FriedrichState;
      break;
    case 'error':
      alert(`Server: ${msg.message}`);
      break;
  }
  render();
}, (open) => {
  connected = open;
  render();
});
conn.connect();

function renderJoin(): string {
  const savedName = localStorage.getItem('friedrich.name') ?? '';
  const savedRoom = localStorage.getItem('friedrich.room') ?? 'test';
  return `
    <div class="card">
      <div class="row">
        <input id="name" placeholder="Your name" value="${savedName}" />
        <input id="room" placeholder="Room code" value="${savedRoom}" />
        <button id="join">Join room</button>
        <span class="muted">${connected ? 'connected' : 'connecting…'}</span>
      </div>
      <p class="muted">Open this page in two tabs, join the same room code with different
      names, and watch state stay in sync. Need 3+ players to start.</p>
    </div>`;
}

function renderGame(s: FriedrichState): string {
  const activeNation = NATION_ORDER[s.activeNationIndex];
  const seatRows = players
    .map((p) => {
      const roles = (s.seats[p.playerId] ?? []).join(' + ') || '—';
      const you = p.playerId === playerId ? ' <span class="you">(you)</span>' : '';
      const dot = p.connected ? '🟢' : '⚪';
      return `<li>${dot} seat ${p.seat}: <b>${p.name}</b> — ${roles}${you}</li>`;
    })
    .join('');

  return `
    <div class="card">
      <div class="row">
        <b>Room started</b>
        <span class="muted">turn ${s.turn} · ${activeNation} to act · version ${s.version}</span>
      </div>
      <ul>${seatRows}</ul>
      <p class="muted">The board UI is the <a href="/board.html" style="color:#8fb3ff">local board demo</a> for now;
      this room proves the synced authoritative state. Board actions get wired to the server next.</p>
      <div class="row">
        <button id="endTurn">End ${activeNation}'s stage</button>
        <button id="ping">Ping</button>
      </div>
    </div>
    <div class="card">
      <b>Log</b>
      <ul>${s.log.slice(-12).map((l) => `<li>${l}</li>`).join('')}</ul>
    </div>`;
}

function render(): void {
  if (!playerId) {
    app.innerHTML = renderJoin();
    document.getElementById('join')?.addEventListener('click', () => {
      const name = (document.getElementById('name') as HTMLInputElement).value.trim() || 'Player';
      const room = (document.getElementById('room') as HTMLInputElement).value.trim() || 'test';
      localStorage.setItem('friedrich.name', name);
      localStorage.setItem('friedrich.room', room);
      conn.send({ t: 'join', room, name });
    });
    return;
  }

  if (!state) {
    app.innerHTML = `<div class="card">Joined as seat ${seat}. Waiting for enough players…
      <ul>${players.map((p) => `<li>${p.name}</li>`).join('')}</ul></div>`;
    return;
  }

  app.innerHTML = renderGame(state);
  document.getElementById('endTurn')?.addEventListener('click', () => {
    conn.send({ t: 'action', action: { type: 'endNationTurn', by: playerId! } });
  });
  document.getElementById('ping')?.addEventListener('click', () => {
    conn.send({ t: 'action', action: { type: 'ping', by: playerId!, note: 'hello' } as never });
  });
}

render();
