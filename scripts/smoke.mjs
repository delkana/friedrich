/**
 * Headless end-to-end check: start the server, connect two clients, join the
 * same room, dispatch an action, and assert both clients receive synced state.
 */
import '../apps/server/dist/index.js'; // side-effect: starts the ws server
import { WebSocket } from 'ws';
import { DEFAULT_PORT } from '../packages/engine/dist/index.js';

const URL = `ws://localhost:${DEFAULT_PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  const ws = new WebSocket(URL);
  const state = { name, playerId: null, last: null };
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.t === 'joined') state.playerId = msg.playerId;
    if (msg.t === 'state') state.last = msg.view;
  });
  const ready = new Promise((res) => ws.on('open', res));
  return { ws, state, ready, send: (m) => ws.send(JSON.stringify(m)) };
}

let failed = false;
const assert = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failed = true;
};

const a = client('Alice');
const b = client('Bob');
const c = client('Carol');
await Promise.all([a.ready, b.ready, c.ready]);

a.send({ t: 'join', room: 'smoke', name: 'Alice' });
b.send({ t: 'join', room: 'smoke', name: 'Bob' });
c.send({ t: 'join', room: 'smoke', name: 'Carol' });
await wait(200);

assert(a.state.playerId !== null && c.state.playerId !== null, 'all clients joined');
assert(a.state.last?.version === 0, 'game started at version 0');
assert(a.state.last?.players?.length === 3, 'server seated 3 players');

// Alice is seat 0 → her turn. End it.
a.send({ t: 'action', action: { type: 'endTurn', by: a.state.playerId } });
await wait(150);

assert(a.state.last?.version === 1, 'version advanced after endTurn');
assert(b.state.last?.version === 1, "Bob's client received the synced update");
assert(c.state.last?.version === 1, "Carol's client received the synced update");
assert(a.state.last?.activeSeat === 1, 'turn passed to seat 1');

a.ws.close();
b.ws.close();
c.ws.close();
await wait(50);
console.log(failed ? '\nSMOKE FAILED' : '\nSMOKE OK');
process.exit(failed ? 1 : 0);
