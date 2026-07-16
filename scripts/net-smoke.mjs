/**
 * Networked end-to-end check: start the real server, connect 3 clients, join a
 * room, and verify hidden-information redaction + turn authorization over ws.
 */
process.env.PORT = '8899';
await import('../apps/server/dist/index.js'); // starts http+ws on 8899

import { WebSocket } from 'ws';
const URL = 'ws://localhost:8899';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  const ws = new WebSocket(URL);
  const st = { name, playerId: null, view: null, errors: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.t === 'joined') st.playerId = m.playerId;
    if (m.t === 'state') st.view = m.view;
    if (m.t === 'error') st.errors.push(m.message);
  });
  return { ws, st, ready: new Promise((res) => ws.on('open', res)), send: (m) => ws.send(JSON.stringify(m)) };
}

let failed = false;
const assert = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failed = true; };
const troopsOf = (view, id) => view?.pieces?.[id]?.troops;

const a = client('Fred');   // seat 0 → Frederick (Prussia+Hanover)
const b = client('Theresa');// seat 1 → Maria Theresa (Austria+Imperial)
const c = client('Liz');    // seat 2 → Elisabeth+Pompadour (Russia+Sweden+France)
await Promise.all([a.ready, b.ready, c.ready]);

a.send({ t: 'join', room: 'test', name: 'Fred' });
b.send({ t: 'join', room: 'test', name: 'Theresa' });
c.send({ t: 'join', room: 'test', name: 'Liz' });
await wait(200);

assert(a.st.view && b.st.view && c.st.view, 'all three received state');
assert(a.st.view.version === 0, 'game started');

// redaction: each player sees their OWN troops, enemies are hidden (-1)
assert(troopsOf(a.st.view, 'friedrich') > 0, 'Fred sees his own Prussian troops');
assert(troopsOf(b.st.view, 'friedrich') === -1, "Theresa cannot see Prussia's troops");
assert(troopsOf(b.st.view, 'daun') > 0, 'Theresa sees her own Austrian troops');
assert(troopsOf(a.st.view, 'daun') === -1, "Fred cannot see Austria's troops");
assert(a.st.view.hands.prussia.length === 7 && a.st.view.hands.austria.length === 0, "Fred sees his own drawn hand, not Austria's");
assert(b.st.view.hands.austria.length === 0 && b.st.view.hands.prussia.length === 0, "Theresa sees no hidden hands (Austria draws on its own stage)");

// authorization: it is Prussia's stage (index 0)
b.send({ t: 'action', action: { type: 'move', pieceId: 'keith', to: 'meissen' } }); // Theresa can't move Prussia
await wait(120);
assert(b.st.errors.some((e) => /not your turn/i.test(e)), 'Theresa is refused acting on Prussia\'s turn');
assert(a.st.view.pieces['keith'].node === 'dresden', 'board unchanged by the refused action');

a.send({ t: 'action', action: { type: 'move', pieceId: 'keith', to: 'meissen' } }); // Fred may
await wait(120);
assert(a.st.view.pieces['keith'].node === 'meissen', 'Fred moved Keith');
assert(c.st.view.pieces['keith'].node === 'meissen', 'Liz received the synced board update');
assert(a.st.view.version === 1, 'version advanced');

a.ws.close(); b.ws.close(); c.ws.close();
await wait(50);
console.log(failed ? '\nNET SMOKE FAILED' : '\nNET SMOKE OK');
process.exit(failed ? 1 : 0);
