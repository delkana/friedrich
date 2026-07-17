/**
 * Networked end-to-end check: start the real server, connect 3 clients, join a
 * room, take every nation through the set-up allotment, and verify
 * hidden-information redaction + turn authorization over ws.
 */
process.env.PORT = '8899';
await import('../apps/server/dist/index.js'); // starts http+ws on 8899

import { WebSocket } from 'ws';
import { suggestAllotment, NATION_OF_ROLE, NATION_ORDER } from '../packages/friedrich/dist/index.js';

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

const clients = [client('Fred'), client('Theresa'), client('Liz')];
await Promise.all(clients.map((c) => c.ready));
for (const c of clients) c.send({ t: 'join', room: 'test', name: c.st.name });
await wait(200);

assert(clients.every((c) => c.st.view), 'all three received state');
assert(clients[0].st.view.version === 0, 'game started');
assert(clients[0].st.view.phase === 'setup', 'a new game opens with the armies unraised');

/** The nations a client controls, per the raffled seating the server dealt. */
const nationsOf = (c) => (c.st.view.seats[c.st.playerId] ?? []).flatMap((r) => NATION_OF_ROLE[r]);
const owner = (nation) => clients.find((c) => nationsOf(c).includes(nation));

assert(
  NATION_ORDER.every((n) => owner(n)),
  'the raffle dealt every nation to a seat',
);

// set-up: each player secretly allots their nations' establishments
for (const c of clients) {
  for (const nation of nationsOf(c)) {
    c.send({ t: 'action', action: { type: 'allotTroops', nation, alloc: suggestAllotment(c.st.view, nation) } });
    await wait(40);
  }
}
await wait(150);
assert(clients[0].st.view.phase === 'war', 'the war begins once every nation is raised');

const fred = owner('prussia');
const theresa = owner('austria');
const other = clients.find((c) => c !== fred && c !== theresa);

// redaction: each player sees their OWN troops, enemies are hidden (-1)
assert(troopsOf(fred.st.view, 'friedrich') > 0, 'Prussia\'s player sees his own troops');
assert(troopsOf(theresa.st.view, 'friedrich') === -1, "Austria's player cannot see Prussia's troops");
assert(troopsOf(theresa.st.view, 'daun') > 0, 'Austria\'s player sees her own troops');
assert(troopsOf(fred.st.view, 'daun') === -1, "Prussia's player cannot see Austria's troops");
assert(
  fred.st.view.hands.prussia.length === 7 && fred.st.view.hands.austria.length === 0,
  "Prussia sees its own drawn hand, not Austria's",
);
assert(
  theresa.st.view.hands.austria.length === 0 && theresa.st.view.hands.prussia.length === 0,
  'Austria sees no hidden hands (it draws on its own stage)',
);

// authorization: it is Prussia's stage (index 0)
theresa.send({ t: 'action', action: { type: 'move', pieceId: 'friedrich', to: 'torgau' } });
await wait(120);
assert(theresa.st.errors.some((e) => /not your turn/i.test(e)), "Austria is refused acting on Prussia's turn");
assert(fred.st.view.pieces['friedrich'].node === 'oschatz', 'board unchanged by the refused action');

const before = fred.st.view.version;
fred.send({ t: 'action', action: { type: 'move', pieceId: 'friedrich', to: 'torgau' } });
await wait(120);
assert(fred.st.view.pieces['friedrich'].node === 'torgau', 'Prussia moved Friedrich');
assert(other.st.view.pieces['friedrich'].node === 'torgau', 'the third player received the synced board update');
assert(fred.st.view.version === before + 1, 'version advanced');

for (const c of clients) c.ws.close();
await wait(50);
console.log(failed ? '\nNET SMOKE FAILED' : '\nNET SMOKE OK');
process.exit(failed ? 1 : 0);
