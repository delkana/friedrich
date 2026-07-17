/**
 * Grand-strategy board client. The map fills the viewport and is pan/zoomable;
 * the turn tracker, command bar, log and battle dialog float as HUD chrome. It
 * drives the Friedrich reducer directly (local hotseat); networking is a later
 * step (send actions to the server instead of applying them here).
 */

import {
  reachableNodes,
  areAdjacent,
  mustPlay,
  legalCardIds,
  type Suit,
  type TacticalCard,
} from '@friedrich/engine';
import type { RoomPlayer, ServerMessage } from '@friedrich/engine';
import {
  Friedrich,
  friedrichMap,
  SUIT_STAMPS,
  SECTOR_LINES,
  NATION_ORDER,
  NATION_OF_ROLE,
  HIDDEN_TROOPS,
  ATTACKER_NATIONS,
  reentrySites,
  objectiveProgress,
  isEased,
  areEnemies,
  MAX_STACK,
  suggestAllotment,
  CARD_SETS,
  ALL_GENERALS,
  TROOP_MAX,
  TROOP_PER_GENERAL_MAX,
  TROOP_PER_GENERAL_MIN,
  ROLE_INFO,
  type FriedrichState,
  type FriedrichAction,
  type Nation,
  type Role,
} from '@friedrich/game';
import { GameConnection } from './net.js';

// ---- palette -------------------------------------------------------------

const SUIT_SYMBOL: Record<Suit, string> = { clubs: '♣', spades: '♠', hearts: '♥', diamonds: '♦' };
const SUIT_COLOR: Record<Suit, string> = { clubs: '#3e5c34', spades: '#2f3a55', hearts: '#8e3a30', diamonds: '#8a6a25' };
const isRed = (s: Suit) => s === 'hearts' || s === 'diamonds';
const NATION_COLOR: Record<Nation, string> = {
  prussia: '#2f4a7a', hanover: '#5b82b8', austria: '#9e9e94',
  russia: '#2f6e3e', france: '#5b3f7d', imperial: '#a8842c', sweden: '#2c7a7a',
};
const WASH_COLOR: Record<string, string> = {
  prussia: '#7f9fc9', hanover: '#c9d9a8', austria: '#e3e0d5',
  imperial: '#e0c268', sweden: '#8fbf9a',
};
const NATION_LABEL: Record<Nation, string> = {
  prussia: 'Prussia', hanover: 'Hanover', austria: 'Austria',
  russia: 'Russia', france: 'France', imperial: 'Imperial Army', sweden: 'Sweden',
};

const BOARD_W = 6000;
const BOARD_H = 4000;

// ---- state ---------------------------------------------------------------

let state: FriedrichState = Friedrich.setup('board-demo', ['A', 'B', 'C', 'D']);
let selected: string | null = null;
let selectedTrain: string | null = null;
let hovered: string | null = null; // inspect a stack without selecting it
let pendingReserve: string | null = null;
let helpOpen = false;
let recruitOpen = false;
const recruit = { troops: 0, trains: 0, cards: new Set<string>() };
/** Set-up: the allotment the player is composing, per nation (before confirming). */
const allotDraft: Partial<Record<Nation, Record<string, number>>> = {};
/** Which of your nations the set-up screen is currently showing. */
let allotNation: Nation | null = null;
/** The general whose row the cursor is over during set-up — picked out on the map. */
let allotHover: string | null = null;
/** The army the map is currently framed on, so we only re-frame on a change. */
let allotFramed: Nation | null = null;
const view = { x: 0, y: 0, w: BOARD_W, h: BOARD_H }; // viewBox

// networking
let mode: 'local' | 'net' = 'local';
let conn: GameConnection | null = null;
let myPlayerId: string | null = null;
let players: RoomPlayer[] = [];
let roomCode = '';
let started = false; // server has enough players and sent state

/** Nations the local player may act as (all of them in hotseat). */
function myNations(): Set<Nation> | null {
  if (mode === 'local') return null; // controls everything
  const roles = (myPlayerId ? state.seats[myPlayerId] : undefined) ?? [];
  const set = new Set<Nation>();
  for (const r of roles) for (const n of NATION_OF_ROLE[r as Role]) set.add(n);
  return set;
}
const canControl = (nation: Nation): boolean => {
  const mine = myNations();
  return mine === null || mine.has(nation);
};

const activeNation = (): Nation => NATION_ORDER[state.activeNationIndex]!;
const occupied = (): Set<string> => new Set(Object.values(state.pieces).map((p) => p.node));
const piecesAt = (node: string) => Object.values(state.pieces).filter((p) => p.node === node);

type WithoutBy<T> = T extends unknown ? Omit<T, 'by'> : never;
function dispatch(action: WithoutBy<FriedrichAction>): void {
  if (mode === 'net') {
    conn?.send({ t: 'action', action: { ...action, by: myPlayerId ?? '' } as FriedrichAction });
    return; // authoritative server replies with new state
  }
  try {
    state = Friedrich.reducer(state, { ...action, by: 'local' } as FriedrichAction);
  } catch (e) {
    flashStatus(e instanceof Error ? e.message : String(e));
  }
  renderMap();
  renderChrome();
}

// ---- map geometry --------------------------------------------------------

function moveTargets(): Set<string> {
  const targets = new Set<string>();
  if (state.combat) return targets;

  // the winner is picking where it drives the beaten stack: those are the only
  // legal clicks on the board right now
  if (state.pendingRetreat) {
    if (canControl(state.pendingRetreat.chooser)) for (const n of state.pendingRetreat.options) targets.add(n);
    return targets;
  }

  // a selected supply train: range 2 cities (3 all-main), no enemy destinations
  if (selectedTrain) {
    const t = state.trains[selectedTrain];
    if (!t) return targets;
    const occ = new Set<string>([...occupied(), ...Object.values(state.trains).map((x) => x.node)]);
    const reach = reachableNodes(friedrichMap, t.node, occ, { maxSteps: 2, maxStepsMainRoad: 3 });
    for (const node of reach.keys()) {
      const side = sideOfNation(t.nation);
      const enemy = piecesAt(node).some((p) => sideOfNation(p.nation) !== side) ||
        Object.values(state.trains).some((x) => x.node === node && sideOfNation(x.nation) !== side);
      if (!enemy) targets.add(node);
    }
    return targets;
  }

  if (!selected) return targets;
  const sel = state.pieces[selected];
  if (!sel) return targets;
  if (state.stageMoves[selected] !== undefined) return targets; // already moved this stage
  const reach = reachableNodes(friedrichMap, sel.node, occupied());
  for (const node of reach.keys()) {
    const here = piecesAt(node);
    if (here.length === 0) targets.add(node);
    else if (here.every((p) => p.nation === sel.nation) && here.length < MAX_STACK) targets.add(node);
  }
  return targets;
}

const sideOfNation = (n: Nation): 'defender' | 'attacker' =>
  n === 'prussia' || n === 'hanover' ? 'defender' : 'attacker';

function boardInner(): string {
  const targets = moveTargets();
  const sel = selected ? state.pieces[selected] : null;

  const defs =
    `<defs>${Object.entries(WASH_COLOR)
      .map(([n, c]) => `<radialGradient id="wash-${n}"><stop offset="35%" stop-color="${c}"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/></radialGradient>`)
      .join('')}</defs>`;

  // parchment ground
  const ground = `<rect x="-400" y="-400" width="${BOARD_W + 800}" height="${BOARD_H + 800}" fill="#e7d9b8"/>`;

  // territory washes (bucketed so we draw ~100 blobs, not 600)
  const buckets = new Map<string, { x: number; y: number; n: number; home: string }>();
  for (const node of friedrichMap.nodes.values()) {
    if (!node.home || !WASH_COLOR[node.home]) continue;
    const key = `${node.home}:${Math.round(node.x / 380)}:${Math.round(node.y / 380)}`;
    const b = buckets.get(key) ?? { x: 0, y: 0, n: 0, home: node.home };
    b.x += node.x; b.y += node.y; b.n++; buckets.set(key, b);
  }
  const washes = `<g opacity="0.33">${[...buckets.values()]
    .map((b) => `<circle cx="${Math.round(b.x / b.n)}" cy="${Math.round(b.y / b.n)}" r="${230 + b.n * 14}" fill="url(#wash-${b.home})"/>`)
    .join('')}</g>`;

  // printed sector-grid lines (Voronoi boundaries of the suit stamps)
  const sectors =
    '<g class="sector-line">' +
    SECTOR_LINES.map((l) => `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}"/>`).join('') +
    '</g>';

  const stamps = SUIT_STAMPS
    .map((s) => `<text class="stamp" x="${s.x}" y="${s.y}" fill="${SUIT_COLOR[s.suit]}">${SUIT_SYMBOL[s.suit]}</text>`)
    .join('');

  const edges = friedrichMap.edges
    .map((e) => {
      const a = friedrichMap.nodes.get(e.a)!;
      const b = friedrichMap.nodes.get(e.b)!;
      const line = (cls: string) => `<line class="${cls}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
      return e.mainRoad ? line('edge main') + line('edge main-inner') : line('edge');
    })
    .join('');

  const nodes = [...friedrichMap.nodes.values()]
    .map((n) => {
      const reach = targets.has(n.id) ? 'reach' : '';
      // objective banner: solid = held by its attacker, hollow = still the defender's
      const objCol = n.objectiveFor ? (NATION_COLOR[n.objectiveFor as Nation] ?? '#888') : '';
      const held = n.objectiveFor ? state.conquered[n.id] === n.objectiveFor : false;
      const obj = n.objectiveFor
        ? `<rect x="${n.x + 22}" y="${n.y - 54}" width="30" height="30" fill="${held ? objCol : '#e7d9b8'}" stroke="${objCol}" stroke-width="${held ? 3 : 5}"/>` +
          (n.objectiveOrder === 2 ? `<line x1="${n.x + 24}" y1="${n.y - 26}" x2="${n.x + 50}" y2="${n.y - 52}" stroke="${held ? '#f2e7c8' : objCol}" stroke-width="4"/>` : '')
        : '';
      const depot = n.depot ? `<text x="${n.x - 32}" y="${n.y - 24}" font-size="42" fill="#9e2b25" text-anchor="middle">✳</text>` : '';
      return `<g><circle class="node ${reach}" data-node="${n.id}" cx="${n.x}" cy="${n.y}" r="${n.setup ? 30 : 24}" stroke="${SUIT_COLOR[n.suit]}"/>${obj}${depot}<text class="nlabel ${n.setup ? 'setuplbl' : ''}" x="${n.x}" y="${n.y + 60}">${n.name}</text></g>`;
    })
    .join('');

  // ghost markers: where each active-nation general began this stage, with a
  // dashed trail to where it stands now (only while nothing is committed)
  const ghosts = state.combat ? '' : Object.entries(state.stageMoves)
    .map(([pieceId, origin]) => {
      const p = state.pieces[pieceId];
      const o = friedrichMap.nodes.get(origin);
      if (!p || !o || p.nation !== activeNation()) return '';
      const c = friedrichMap.nodes.get(p.node)!;
      return `<g class="ghost">
        <line class="ghost-trail" x1="${o.x + 54}" y1="${o.y - 30}" x2="${c.x + 54}" y2="${c.y - 30}"/>
        <circle cx="${o.x + 54}" cy="${o.y - 30}" r="25" fill="${NATION_COLOR[p.nation]}" fill-opacity="0.28" stroke="${NATION_COLOR[p.nation]}" stroke-dasharray="6 6" stroke-width="4"/>
      </g>`;
    })
    .join('');

  // supply trains (wagons): sit to the lower-left of a city
  const trains = Object.values(state.trains)
    .map((t) => {
      const n = friedrichMap.nodes.get(t.node);
      if (!n) return '';
      const canSelect = t.nation === activeNation() && canControl(t.nation) && !state.combat;
      const sc = t.id === selectedTrain ? ' sel' : '';
      return `<g class="train${sc}" data-train="${t.id}" style="${canSelect ? '' : 'cursor:default'}">
        <rect x="${n.x - 66}" y="${n.y + 12}" width="40" height="26" rx="4" fill="${NATION_COLOR[t.nation]}" stroke="#1c140a" stroke-width="4"/>
        <circle cx="${n.x - 58}" cy="${n.y + 40}" r="6" fill="#1c140a"/><circle cx="${n.x - 34}" cy="${n.y + 40}" r="6" fill="#1c140a"/></g>`;
    })
    .join('');

  // while raising an army, the board shows the troops you are assigning — the
  // counters count up and down with the steppers, so you can see the shape of
  // your line as you build it
  const allot = allotFocus();
  // set-up frames a whole army, which can span half of Europe, so the board is
  // zoomed well out — fatten the counters to keep the troop numbers readable
  const k = allot ? 2.2 : 1;

  const pieces = [...friedrichMap.nodes.values()]
    .flatMap((n) => piecesAt(n.id).map((p, i) => {
      const px = n.x + 54 * k;
      const py = n.y - 30 * k + i * 46 * k;
      const canSelect = p.nation === activeNation() && canControl(p.nation) && !state.combat;
      const isTarget = sel && areEnemies(sel.nation, p.nation) && areAdjacent(friedrichMap, sel.node, p.node);
      const raising = allot && p.nation === allot.nation;
      const cls = [
        p.id === selected ? 'sel' : '',
        isTarget ? 'target' : '',
        p.faceUp ? '' : 'facedown',
        raising ? 'raising' : '',
        p.id === allotHover ? 'allot-focus' : '',
      ].join(' ');
      const troops = raising
        ? String(allot.draft[p.id] ?? 0)
        : p.troops === HIDDEN_TROOPS ? '?' : String(p.troops);
      const cut = p.faceUp ? '' : `<circle cx="${px + 22 * k}" cy="${py - 22 * k}" r="${10 * k}" fill="#9e2b25" stroke="#1c140a" stroke-width="3"/>`;
      return `<g class="piece ${cls}" data-piece="${p.id}" style="${canSelect || isTarget ? '' : 'cursor:default'}">
        <circle cx="${px}" cy="${py}" r="${52 * k}" fill="none" pointer-events="all"/>
        <circle class="ring" cx="${px}" cy="${py}" r="${34 * k}"/>
        <circle cx="${px}" cy="${py}" r="${25 * k}" fill="${NATION_COLOR[p.nation]}"/>
        <text class="ptext" x="${px}" y="${py + 11 * k}" style="font-size:${30 * k}px">${troops}</text>${cut}</g>`;
    }))
    .join('');

  return defs + ground + washes + sectors + stamps + edges + ghosts + nodes + trains + pieces;
}

// ---- pan / zoom ----------------------------------------------------------

const mapView = () => document.getElementById('map-view')!;
const boardSvg = () => document.getElementById('board-svg') as unknown as SVGSVGElement;

function applyView(): void {
  // never write a non-finite viewBox — it silently blanks the whole map
  if (![view.x, view.y, view.w, view.h].every(Number.isFinite) || view.w <= 0 || view.h <= 0) {
    fitView();
    return;
  }
  boardSvg().setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
}

/**
 * Frame a set of cities, keeping them clear of a panel covering `leftInset`
 * pixels of the pane. Used at set-up so the army you are raising is actually on
 * screen instead of hiding behind the dialog.
 */
function focusCities(ids: readonly string[], leftInset: number): void {
  const pts = ids.map((id) => friedrichMap.nodes.get(id)).filter((n): n is NonNullable<typeof n> => !!n);
  if (!pts.length) return;
  const r = mapView().getBoundingClientRect();
  if (r.width < 1 || r.height < 1) { requestAnimationFrame(() => focusCities(ids, leftInset)); return; }

  const pad = 620; // board units — room for the counters and their labels
  const x0 = Math.min(...pts.map((p) => p.x)) - pad;
  const x1 = Math.max(...pts.map((p) => p.x)) + pad;
  const y0 = Math.min(...pts.map((p) => p.y)) - pad;
  const y1 = Math.max(...pts.map((p) => p.y)) + pad;

  // the cities have to land in the pane MINUS the panel, so they must fit across
  // only that fraction of the viewBox
  const freeFrac = Math.max(0.25, (r.width - leftInset) / r.width);
  const ar = r.width / r.height;
  let w = Math.max((x1 - x0) / freeFrac, (y1 - y0) * ar);
  // an army can span half of Europe (Prussia reaches from Saxony to East
  // Prussia); on a narrow pane framing it exactly would zoom out absurdly far,
  // so cap the zoom and accept that an edge may tuck under the panel
  w = Math.min(w, BOARD_W * 1.35);
  const h = w / ar;

  // put the cities in the middle of the free strip: screen-centre it at
  // (paneWidth + leftInset) / 2 rather than paneWidth / 2
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  view.w = w;
  view.h = h;
  view.x = cx - (w * (r.width + leftInset)) / (2 * r.width);
  view.y = cy - h / 2;
  applyView();
}

function fitView(): void {
  const r = mapView().getBoundingClientRect();
  // the pane may not be laid out yet (0x0) — an aspect ratio of 0/0 is NaN and
  // would poison the viewBox, so wait for a real size and try again
  if (r.width < 1 || r.height < 1) {
    requestAnimationFrame(fitView);
    return;
  }
  const ar = r.width / r.height;
  const pad = 40;
  if (ar > BOARD_W / BOARD_H) { view.h = BOARD_H + pad * 2; view.w = view.h * ar; }
  else { view.w = BOARD_W + pad * 2; view.h = view.w / ar; }
  view.x = (BOARD_W - view.w) / 2;
  view.y = (BOARD_H - view.h) / 2;
  applyView();
}

function zoomAt(clientX: number, clientY: number, factor: number): void {
  const r = mapView().getBoundingClientRect();
  const mx = (clientX - r.left) / r.width;
  const my = (clientY - r.top) / r.height;
  const bx = view.x + mx * view.w;
  const by = view.y + my * view.h;
  const minW = 900, maxW = BOARD_W * 2.4;
  let w = view.w * factor;
  w = Math.max(minW, Math.min(maxW, w));
  const scale = w / view.w;
  view.w = w;
  view.h *= scale;
  view.x = bx - mx * view.w;
  view.y = by - my * view.h;
  applyView();
}

function panByPx(dx: number, dy: number): void {
  const r = mapView().getBoundingClientRect();
  const scale = view.w / r.width;
  view.x -= dx * scale;
  view.y -= dy * scale;
  applyView();
}

const DRAG_THRESHOLD = 8; // px of movement before a press counts as a drag (not a click)

function setupPanZoom(): void {
  const el = mapView();
  const pts = new Map<number, { x: number; y: number }>(); // live pointers
  let dragId: number | null = null; // the pointer currently panning
  let start = { x: 0, y: 0 };        // its press position
  let last = { x: 0, y: 0 };         // its last position (for incremental pan)
  let didGesture = false;            // THIS gesture panned/pinched → suppress its click
  let pinchDist = 0;
  let pinchMid = { x: 0, y: 0 };

  /**
   * Take the pointer only once a pan/pinch is really under way.
   *
   * Capturing on pointerdown breaks every HUD button: the panels live INSIDE
   * the map pane, and a captured pointer retargets its pointerdown/pointerup —
   * and therefore the click — to the pane itself, so the click never propagates
   * down to #hud and the delegated handler never runs.
   */
  const grabPointer = (id: number) => {
    try { if (!el.hasPointerCapture(id)) el.setPointerCapture(id); } catch { /* ignore */ }
  };

  el.addEventListener('pointerdown', (e) => {
    // a press on the HUD belongs to the HUD — don't pan the map with it
    if ((e.target as Element).closest?.('#hud')) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    didGesture = false; // always start a fresh gesture — never inherit a prior drag's suppression
    if (pts.size === 1) {
      dragId = e.pointerId;
      start = { x: e.clientX, y: e.clientY };
      last = { ...start };
    }
    if (pts.size === 2) pinchDist = 0;
  });

  el.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const cur = { x: e.clientX, y: e.clientY };
    pts.set(e.pointerId, cur);

    if (pts.size >= 2) {
      const all = [...pts.values()];
      const a = all[0]!, b = all[1]!;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinchDist > 0) {
        didGesture = true;
        for (const id of pts.keys()) grabPointer(id); // the pinch owns the pointers now
        panByPx(mid.x - pinchMid.x, mid.y - pinchMid.y);      // follow the fingers
        if (dist > 0) zoomAt(mid.x, mid.y, pinchDist / dist);  // pinch = zoom
      }
      pinchDist = dist;
      pinchMid = mid;
      return;
    }

    if (e.pointerId !== dragId) return;
    // only start panning once the pointer has clearly moved (total, from the press)
    if (!didGesture && Math.hypot(cur.x - start.x, cur.y - start.y) < DRAG_THRESHOLD) return;
    didGesture = true;
    grabPointer(e.pointerId); // now the drag is real, follow it outside the pane
    el.classList.add('grabbing');
    panByPx(cur.x - last.x, cur.y - last.y);
    last = cur;
  });

  const release = (e: PointerEvent) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinchDist = 0;
    if (pts.size === 0) {
      el.classList.remove('grabbing');
      dragId = null;
    } else if (e.pointerId === dragId) {
      // the panning finger lifted but another remains — hand panning to it
      const [nextId] = [...pts.keys()];
      dragId = nextId!;
      last = { ...pts.get(nextId!)! };
    }
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('lostpointercapture', release);

  // suppress ONLY the click that ends a real drag/pinch; a stationary click
  // (didGesture === false) always reaches the board and selects/deselects
  el.addEventListener('click', (e) => { if (didGesture) e.stopPropagation(); }, true);

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 0.85 : 1 / 0.85);
  }, { passive: false });

  window.addEventListener('resize', () => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    view.h = view.w * (r.height / r.width); // keep the viewBox aspect == the pane's
    applyView();
  });
}

// ---- HUD chrome ----------------------------------------------------------

function flashStatus(msg: string): void {
  const el = document.getElementById('status-line');
  if (el) el.textContent = msg;
}

function scorebar(diff: number): string {
  const mag = Math.min(Math.abs(diff), 20);
  const pct = (mag / 20) * 50;
  const fill = diff === 0 ? '' :
    diff > 0 ? `<div class="fill" style="left:50%;width:${pct}%;background:#2f4a7a"></div>`
             : `<div class="fill" style="right:50%;width:${pct}%;background:#8e3a30"></div>`;
  return `<div class="scorebar">${fill}<div class="mid"></div></div>`;
}

function cardHtml(card: TacticalCard, playable: boolean): string {
  if (card.kind === 'reserve') return `<div class="tc reserve ${playable ? 'playable' : 'disabled'}" data-card="${card.id}">RES<br>1–10</div>`;
  const red = isRed(card.suit) ? 'red' : '';
  return `<div class="tc ${red} ${playable ? 'playable' : 'disabled'}" data-card="${card.id}"><span class="sym">${SUIT_SYMBOL[card.suit]}</span><span class="val">${card.value}</span></div>`;
}

function combatBox(): string {
  const c = state.combat!;
  const d = c.duel;
  const mover = d.toMove;
  const moverNation = mover === 'attacker' ? c.attackerNation : c.defenderNation;
  const myTurn = canControl(moverNation);
  const legal = new Set(myTurn ? legalCardIds(d, mover) : []);
  const forced = myTurn && mustPlay(d, mover);
  const diff = d.attacker.total - d.defender.total;

  const side = (which: 'attacker' | 'defender') => {
    const p = which === 'attacker' ? d.attacker : d.defender;
    const nation = which === 'attacker' ? c.attackerNation : c.defenderNation;
    const active = d.toMove === which;
    const hand = p.hand.map((card) => cardHtml(card, active && legal.has(card.id))).join('') || '<span style="color:#9c8f74">— hidden —</span>';
    return `<div class="side ${active ? 'active' : ''}">
      <div class="nm" style="color:${NATION_COLOR[nation]}">${NATION_LABEL[nation]} ${active ? '⚔' : ''}</div>
      <div class="meta">${which} · sector ${SUIT_SYMBOL[p.sectorSuit]} · strength ${p.total} <span style="opacity:.6">(${p.troops}+${p.total - p.troops})</span></div>
      <div class="hand">${hand}</div></div>`;
  };

  const picker = pendingReserve
    ? `<div style="text-align:center;margin-top:8px">Declare Reserve value: ${Array.from({ length: 10 }, (_, i) => i + 1).map((v) => `<button class="gb" data-resval="${v}">${v}</button>`).join(' ')} <button class="gb" data-resval="cancel">cancel</button></div>`
    : '';

  const note = !myTurn
    ? `Waiting for ${NATION_LABEL[moverNation]}…`
    : forced
      ? `${NATION_LABEL[moverNation]} must play a matching card`
      : `${NATION_LABEL[moverNation]} to play`;
  const controls = `<div class="duel-controls">
      <button class="gb primary" id="cpass" ${forced || !myTurn ? 'disabled' : ''}>${diff === 0 ? 'Offer tie' : 'Accept defeat'}</button>
      <span style="color:#9c8f74;font-style:italic">${note}</span>
    </div>`;

  const battleCity = friedrichMap.nodes.get(c.defenderNode)?.name ?? c.defenderNode;
  return `<div id="combat-box">
    <h3>Battle of ${battleCity}</h3>
    ${scorebar(diff)}
    <div class="duel-sides">${side('attacker')}${side('defender')}</div>
    ${picker}${controls}</div>`;
}

// ---- player-knowledge panels ---------------------------------------------

/** Whose hand to show: the active nation if you control it, else your own. */
function handNation(): Nation | null {
  const active = activeNation();
  if (mode === 'local') return active;
  const mine = myNations();
  if (!mine || mine.size === 0) return null;
  return mine.has(active) ? active : ([...mine][0] ?? null);
}

function handCardHtml(card: TacticalCard, usable: boolean): string {
  const dim = usable ? '' : 'dim';
  if (card.kind === 'reserve') return `<div class="tc sm reserve ${dim}">RES</div>`;
  const red = isRed(card.suit) ? 'red' : '';
  return `<div class="tc sm ${red} ${dim}"><span class="sym">${SUIT_SYMBOL[card.suit]}</span><span class="val">${card.value}</span></div>`;
}

/** Your tactical cards, sorted, with the selected general's sector highlighted. */
function handPanel(): string {
  const nat = handNation();
  if (!nat) return '';
  const hand = [...(state.hands[nat] ?? [])].sort((a, b) => {
    const ak = a.kind === 'reserve' ? 'zz' : a.suit;
    const bk = b.kind === 'reserve' ? 'zz' : b.suit;
    if (ak !== bk) return ak < bk ? -1 : 1;
    return (a.kind === 'reserve' ? 0 : a.value) - (b.kind === 'reserve' ? 0 : b.value);
  });
  const sel = selected ? state.pieces[selected] : null;
  const sectorSuit = sel ? friedrichMap.nodes.get(sel.node)?.suit : undefined;
  const cards =
    hand.map((c) => handCardHtml(c, !sectorSuit || c.kind === 'reserve' || c.suit === sectorSuit)).join('') ||
    '<span style="color:#9c8f74">— no cards —</span>';
  const hint = sectorSuit && sel
    ? `Bright cards are playable in ${SUIT_SYMBOL[sectorSuit]} ${sectorSuit} — ${sel.id}'s sector (Reserves are wild)`
    : 'Select a general to see which cards its sector allows';
  return `<h4>${NATION_LABEL[nat]} — hand (${hand.length})</h4><div class="hand-cards">${cards}</div><div class="hint">${hint}</div>`;
}

/** The selected general's stack: who's there, ranks, troops, supply. */
function armyPanel(): string {
  const focus = hovered ?? selected; // hover to inspect any stack, incl. the enemy's
  if (!focus) return '';
  const p = state.pieces[focus];
  if (!p) return '';
  const node = friedrichMap.nodes.get(p.node)!;
  const stack = piecesAt(p.node).filter((x) => x.nation === p.nation).sort((a, b) => a.rank - b.rank);
  const known = stack.filter((g) => g.troops !== HIDDEN_TROOPS);
  const total = known.reduce((n, g) => n + g.troops, 0);
  const rows = stack
    .map((g) => `<div class="gen ${g.faceUp ? '' : 'cut'}">
        <span>${g.id === focus ? '▸ ' : ''}${g.id} <span style="opacity:.55">rank ${g.rank}</span></span>
        <span>${g.troops === HIDDEN_TROOPS ? '?' : g.troops}${g.faceUp ? '' : ' ✳'}</span></div>`)
    .join('');
  const cut = stack.some((g) => !g.faceUp)
    ? '<div style="color:#d98a84;font-size:11.5px;margin-top:6px">✳ out of supply — destroyed at its next supply phase unless resupplied</div>'
    : '';
  const obj = node.objectiveFor ? ` · objective of ${NATION_LABEL[node.objectiveFor as Nation]}` : '';
  return `<h4>${NATION_LABEL[p.nation]}${hovered && hovered !== selected ? ' (inspecting)' : ''}</h4>
    <div class="where">${node.name} · ${SUIT_SYMBOL[node.suit]} ${node.suit}${obj}</div>
    <div class="rows">${rows}<div class="tot">Strength ${total}${known.length < stack.length ? '+?' : ''} troops${stack.length > 1 ? ` · ${stack.length} generals` : ''}</div>${cut}</div>`;
}

/** Who is close to winning: each attacker's objectives, and Prussia's survival. */
function statusPanel(): string {
  const rows = ATTACKER_NATIONS.map((n) => {
    if (state.eliminated.includes(n)) {
      return `<div class="stat-row out"><span class="nm"><span class="sw" style="background:${NATION_COLOR[n]}"></span>${NATION_LABEL[n]}</span><span>withdrawn</span></div>`;
    }
    const { held, total } = objectiveProgress(state, n);
    const pct = total ? Math.round((held / total) * 100) : 0;
    const eased = isEased(state, n) ? ' <span class="eased">EASED</span>' : '';
    return `<div class="stat-row"><span class="nm"><span class="sw" style="background:${NATION_COLOR[n]}"></span>${NATION_LABEL[n]}${eased}</span><span>${held}/${total}</span></div>
      <div class="bar"><i style="width:${pct}%;background:${NATION_COLOR[n]}"></i></div>`;
  }).join('');
  const outCount = (['russia', 'sweden', 'france'] as Nation[]).filter((n) => state.eliminated.includes(n)).length;
  const prussia = `<div class="stat-row"><span class="nm"><span class="sw" style="background:${NATION_COLOR.prussia}"></span>Prussia <span style="opacity:.6">survival</span></span><span>${outCount}/3</span></div>
    <div class="bar"><i style="width:${(outCount / 3) * 100}%;background:${NATION_COLOR.prussia}"></i></div>`;
  // the draw deck is shared by every nation, so its size is news for all of them
  const left = state.deckCount ?? state.drawDeck.length;
  const deck = `<div class="stat-row deck"><span class="nm">Tactical Cards <span style="opacity:.6">deck ${state.setsUsed} of ${CARD_SETS}</span></span><span>${left} left</span></div>`;
  return `<h4>Victory progress</h4><div class="rows">${rows}${prussia}${deck}</div>`;
}

/** Recruitment dialog (§10): Tactical Cards spent as money at a depot. */
function recruitBox(): string {
  const nation = activeNation();
  const hand = (state.hands[nation] ?? []).filter((c) => c.kind === 'suit');
  const paid = hand.filter((c) => recruit.cards.has(c.id)).reduce((n, c) => n + (c.kind === 'suit' ? c.value : 0), 0);
  // every depot blocked → re-enter in the substitute region, at 8 instead of 6
  const { sites, cost: unitCost } = reentrySites(state, nation);
  const substituting = unitCost > 6;
  const cost = (recruit.troops + recruit.trains) * unitCost;
  const lost = Object.values(state.offMap).filter((g) => g.nation === nation);
  const onMap = Object.values(state.pieces).filter((p) => p.nation === nation).sort((a, b) => a.rank - b.rank);
  const trainsLost = state.offMapTrains[nation] ?? 0;
  const depots = sites;

  const targets = [
    ...onMap.map((p) => `<option value="reinforce:${p.id}">Reinforce ${p.id} (${p.troops === HIDDEN_TROOPS ? '?' : p.troops}) at ${friedrichMap.nodes.get(p.node)?.name}</option>`),
    ...lost.map((g) => `<option value="return:${g.id}">Bring back ${g.id} (rank ${g.rank}) — needs ≥1 troop</option>`),
  ].join('');

  const cards = hand
    .map((c) => {
      const sel = recruit.cards.has(c.id) ? 'sel' : '';
      const red = c.kind === 'suit' && isRed(c.suit) ? 'red' : '';
      return `<div class="tc sm ${red} ${sel} playable" data-rec="card:${c.id}"><span class="sym">${c.kind === 'suit' ? SUIT_SYMBOL[c.suit] : ''}</span><span class="val">${c.kind === 'suit' ? c.value : ''}</span></div>`;
    })
    .join('') || '<span style="color:#9c8f74">— no cards to spend —</span>';

  return `<div id="recruit-box">
    <h3>Recruitment</h3>
    <p class="sub">Tactical Cards are spent as money — <b>${unitCost} points</b> per troop and per supply train.
    A returning general is free but must receive at least one troop. No change is given for overpayment.</p>
    ${substituting ? `<p class="sub" style="color:#d9b26a">Every one of your depot cities is held by another
      player, so pieces must re-enter at a <b>substitute site</b> of your choice in your home sector — and
      everything costs <b>8</b> instead of 6 until your depots are free.</p>` : ''}
    <div class="rec-row"><span>Troops</span>
      <button class="gb" data-rec="t-">−</button><b class="rec-n">${recruit.troops}</b><button class="gb" data-rec="t+">+</button></div>
    <div class="rec-row"><span>Give to</span><select id="rec-target">${targets || '<option value="">— nobody available —</option>'}</select></div>
    ${trainsLost > 0 ? `<div class="rec-row"><span>Supply trains <small>(${trainsLost} lost)</small></span>
      <button class="gb" data-rec="s-">−</button><b class="rec-n">${recruit.trains}</b><button class="gb" data-rec="s+">+</button></div>` : ''}
    <div class="rec-row"><span>${substituting ? 'Substitute site' : 'Depot'} <small>(for returning pieces)</small></span>
      <select id="rec-depot">${depots.map((d) => `<option value="${d}">${friedrichMap.nodes.get(d)?.name ?? d}</option>`).join('')}</select></div>
    <div class="rec-cards"><div class="sub" style="margin:6px 0 4px">Click cards to spend them:</div><div class="hand-cards">${cards}</div></div>
    <div class="rec-total ${paid >= cost && cost > 0 ? 'ok' : ''}">Cost <b>${cost}</b> · Paying <b>${paid}</b>${paid > cost && cost > 0 ? ` <small>(${paid - cost} lost)</small>` : ''}</div>
    <div class="duel-controls">
      <button class="gb primary" data-rec="go" ${cost > 0 && paid >= cost ? '' : 'disabled'}>Recruit</button>
      <button class="gb" data-rec="cancel">Cancel</button>
    </div>
  </div>`;
}

// ---- set-up: secret troop allotment --------------------------------------

const GENERAL_NAME: Record<string, string> = Object.fromEntries(ALL_GENERALS.map((g) => [g.id, g.name]));

/** Your nations still waiting to be raised, in play order. */
function nationsToAllot(): Nation[] {
  const mine = myNations();
  return NATION_ORDER.filter((n) => !state.allocated.includes(n) && (mine === null || mine.has(n)));
}

function draftFor(nation: Nation): Record<string, number> {
  allotDraft[nation] ??= suggestAllotment(state, nation);
  return allotDraft[nation]!;
}

/**
 * The army currently being raised, and the troops being assigned to it. The map
 * and the set-up panel both read this, so the counters on the board always show
 * the same numbers as the steppers.
 */
function allotFocus(): { nation: Nation; draft: Record<string, number> } | null {
  if (state.phase !== 'setup' || state.winner) return null;
  const waiting = nationsToAllot();
  if (!waiting.length) return null;
  if (!allotNation || !waiting.includes(allotNation)) allotNation = waiting[0]!;
  return { nation: allotNation, draft: draftFor(allotNation) };
}

/** Nudge a general's troops, keeping the nation's total at its establishment. */
function bumpAllot(nation: Nation, id: string, delta: number): void {
  const draft = { ...draftFor(nation) };
  const max = TROOP_PER_GENERAL_MAX[nation];
  const next = (draft[id] ?? 0) + delta;
  if (next < TROOP_PER_GENERAL_MIN || next > max) return;
  draft[id] = next;
  allotDraft[nation] = draft;
  renderMap(); // the counters on the board track the steppers
  renderChrome();
}

function setupBox(): string {
  const waiting = nationsToAllot();
  if (waiting.length === 0) {
    const others = NATION_ORDER.filter((n) => !state.allocated.includes(n)).map((n) => NATION_LABEL[n]);
    return `<div id="setup-box">
      <h3>Raising the Armies</h3>
      <p class="sub">Your armies are ready. Waiting for ${others.join(', ')} to be raised…</p>
    </div>`;
  }
  const { nation, draft } = allotFocus()!;
  const generals = Object.values(state.pieces).filter((p) => p.nation === nation).sort((a, b) => a.rank - b.rank);
  const spent = Object.values(draft).reduce((a, b) => a + b, 0);
  const establishment = TROOP_MAX[nation];
  const left = establishment - spent;
  const max = TROOP_PER_GENERAL_MAX[nation];

  const roles = (myPlayerId ? state.seats[myPlayerId] : undefined) ?? [];
  const youAre = mode === 'net' && roles.length
    ? `<p class="sub">You play <b>${roles.map((r) => ROLE_INFO[r as Role].name).join(' and ')}</b>.</p>`
    : '';

  const tabs = waiting.length > 1
    ? `<div class="setup-tabs">${waiting
        .map((n) => `<button class="gb ${n === nation ? 'primary' : ''}" data-setup="tab:${n}">${NATION_LABEL[n]}</button>`)
        .join('')}</div>`
    : '';

  const rows = generals
    .map((g) => {
      const n = draft[g.id] ?? 0;
      return `<div class="setup-row ${g.id === allotHover ? 'hot' : ''}" data-general="${g.id}">
        <span class="nm">${GENERAL_NAME[g.id] ?? g.id} <small>· rank ${g.rank} · ${friedrichMap.nodes.get(g.node)?.name ?? g.node}</small></span>
        <button class="gb" data-setup="minus:${g.id}" ${n <= TROOP_PER_GENERAL_MIN ? 'disabled' : ''}>−</button>
        <b class="rec-n">${n}</b>
        <button class="gb" data-setup="plus:${g.id}" ${n >= max || left <= 0 ? 'disabled' : ''}>+</button>
      </div>`;
    })
    .join('');

  return `<div id="setup-box">
    <h3>Raise the Army of ${NATION_LABEL[nation]}</h3>
    ${youAre}
    <p class="sub">Split this nation's establishment of <b>${establishment} troops</b> among its generals —
      at least <b>1</b> each, at most <b>${max}</b>. The counters on the map count with you, so you can see
      which front you are massing on; hover a general to find him. Their strengths stay <b>secret</b> from
      your enemies, so a weak-looking flank may be a trap — or a real weakness.</p>
    ${tabs}
    ${rows}
    <div class="rec-total ${left === 0 ? 'ok' : ''}">Establishment <b>${establishment}</b> · Allotted <b>${spent}</b>${
      left !== 0 ? ` <small>(${left > 0 ? `${left} still to place` : `${-left} too many`})</small>` : ''
    }</div>
    <div class="duel-controls">
      <button class="gb primary" data-setup="go" ${left === 0 ? '' : 'disabled'}>Take the Field</button>
      <button class="gb" data-setup="even">Spread Evenly</button>
    </div>
  </div>`;
}

/** France's forced choice: which of the cards it just drew to throw away. */
function discardBox(): string {
  const pending = state.pendingDiscard!;
  const nation = pending.nation;
  const choices = (state.hands[nation] ?? []).filter((c) => pending.cardIds.includes(c.id));
  if (!choices.length) {
    return `<div id="setup-box">
      <h3>${NATION_LABEL[nation]}'s Discard</h3>
      <p class="sub">Waiting for ${NATION_LABEL[nation]} to discard one of the cards it drew…</p>
    </div>`;
  }
  const cards = choices
    .map((c) => {
      const face = c.kind === 'reserve'
        ? '<span class="val">RES</span>'
        : `<span class="sym">${SUIT_SYMBOL[c.suit]}</span><span class="val">${c.value}</span>`;
      const red = c.kind === 'suit' && isRed(c.suit) ? 'red' : '';
      const res = c.kind === 'reserve' ? 'reserve' : '';
      return `<div class="tc sm ${red} ${res} playable" data-discard="${c.id}">${face}</div>`;
    })
    .join('');
  return `<div id="setup-box">
    <h3>Discard One Card</h3>
    <p class="sub">France draws four Tactical Cards each stage and must <b>immediately discard one
      of its choice</b>, face-down. Pick the card you can spare — the other three are yours to keep.</p>
    <div class="hand-cards" style="justify-content:center;margin:14px 0">${cards}</div>
  </div>`;
}

const HELP_HTML = `<div id="help-box">
  <h3>How Friedrich works</h3>
  <div class="help-grid">
    <section><h5>The war</h5><p>You are one of the powers of the Seven Years' War. Prussia (Frederick) fights
      alone against everyone. Each <b>attacker</b> wins the moment it holds <b>all its objective cities</b>
      (the coloured banners on the map). <b>Prussia wins by surviving</b> — from turn 6 the Clock of Fate
      draws a card each turn, and once Russia, Sweden and France have all quit the war, Frederick has won.</p></section>
    <section><h5>The cards</h5><p>Every nation draws from <b>one shared deck</b> of 50 — so a card you take is
      one your enemy cannot. When it runs out the next of the box's four decks is opened; after all four,
      the two biggest piles of played cards are shuffled back. Cards are the game's real currency.
      France draws four each stage but must throw one away.</p></section>
    <section><h5>Your turn</h5><p>Nations act in a fixed order each turn. On your stage you draw cards,
      then move each general <b>once</b> (3 cities, 4 if entirely along a thick main road — you cannot move
      through another piece), then attack. Right-click or click empty ground to deselect; use <b>Undo Move</b>
      before you commit.</p></section>
    <section><h5>Battle</h5><p>Strength = a general's <b>secret troops</b> + the <b>Tactical Cards</b> it plays.
      You may only play cards matching the <b>suit of the sector your general stands in</b> (Reserves are wild) —
      that's why the same card is decisive in one province and useless in the next. The side that is behind plays;
      the instant it draws level the turn passes. Whoever cannot or will not play <b>loses</b>, taking casualties
      equal to the gap and retreating that many cities.</p></section>
    <section><h5>Retreat</h5><p>The loser retreats <b>exactly</b> as many cities as it lost troops, never twice
      through the same city and never through <b>any</b> piece — not even to take an undefended supply train.
      It must end up <b>as far from the winner as it can</b>, and the <b>winner</b> picks which of those cities.
      A stack that cannot go the full distance is <b>wiped out</b>, so being cornered is deadlier than being
      outnumbered.</p></section>
    <section><h5>Supply</h5><p>A general is in supply in its <b>home country</b>, or if it can trace ≤6 cities —
      never through an enemy — to one of its <b>supply trains</b>. Cut off, it flips face-down (red dot);
      if it is still cut off at its next supply phase it is <b>destroyed</b>. Russia and France have no home
      country: their trains are their lifeline, and taking one is a real blow.</p></section>
    <section><h5>Recruitment</h5><p>Cards are also <b>money</b>: 6 points per troop or supply train, spent at
      one of your <b>depot cities</b>. Every card you spend on logistics is one you cannot fight with.</p></section>
  </div>
  <div class="duel-controls"><button class="gb primary" data-help="close">Close</button></div>
</div>`;

function renderChrome(): void {
  const nation = activeNation();
  document.getElementById('turn-num')!.textContent = String(state.turn);
  const banner = document.getElementById('active-banner')!;
  banner.querySelector('.swatch')!.setAttribute('style', `background:${NATION_COLOR[nation]}`);
  banner.querySelector('.who')!.textContent = NATION_LABEL[nation];

  const youTag = document.getElementById('you-tag')!;
  const handCount = (nations: Nation[]) => nations.reduce((sum, nat) => sum + (state.hands[nat]?.length ?? 0), 0);
  if (mode === 'net') {
    const nats = [...(myNations() ?? new Set<Nation>())];
    const mine = nats.map((n) => NATION_LABEL[n]).join(', ');
    youTag.textContent = mine ? `You: ${mine} · ${handCount(nats)} cards` : 'Spectator';
  } else {
    youTag.textContent = `Hotseat · ${NATION_LABEL[nation]}: ${state.hands[nation]?.length ?? 0} cards`;
  }

  const log = document.getElementById('log-list')!;
  log.innerHTML = state.log.slice(-14).map((l) => `<li>${l}</li>`).join('');
  log.scrollTop = log.scrollHeight;

  const inSetup = state.phase === 'setup' && !state.winner;
  const myTurn = canControl(nation) && !inSetup && !state.pendingDiscard && !state.pendingRetreat;
  const selMoved = selected != null && state.stageMoves[selected] !== undefined;
  const retreat = state.pendingRetreat;
  const status = document.getElementById('status-line')!;
  status.textContent = inSetup
    ? 'The armies are being raised…'
    : state.pendingDiscard
    ? `${NATION_LABEL[state.pendingDiscard.nation]} must discard a card…`
    : retreat
    ? canControl(retreat.chooser)
      ? `You beat ${NATION_LABEL[retreat.nation]} — click a highlighted city to drive it back to`
      : `${NATION_LABEL[retreat.chooser]} is choosing where ${NATION_LABEL[retreat.nation]} retreats…`
    : state.combat
    ? 'Battle underway…'
    : !myTurn
      ? `Waiting for ${NATION_LABEL[nation]}…`
      : selectedTrain
        ? 'Supply train selected — choose a destination'
        : selMoved
          ? `${selected} has moved — undo, or choose another general`
          : selected
            ? `${selected} selected — choose a destination or foe`
            : `Your move — choose a ${NATION_LABEL[nation]} general`;
  (document.getElementById('btn-end') as HTMLButtonElement).disabled = !!state.combat || !myTurn;
  const undoBtn = document.getElementById('btn-undo') as HTMLButtonElement;
  undoBtn.hidden = !(selMoved && !state.combat);
  const resetBtn = document.getElementById('btn-reset') as HTMLButtonElement;
  resetBtn.hidden = mode === 'net'; // server owns the game online

  // player-knowledge panels (hidden behind the battle and set-up dialogs, which cover them)
  const covered = !!state.combat || inSetup;
  // the set-up panel docks over the left column; its own tabs already say which
  // armies are still to raise, so the log has nothing to add there
  (document.getElementById('left-col') as HTMLElement).hidden = inSetup;
  const handEl = document.getElementById('hand-panel') as HTMLElement;
  const handHtml = handPanel();
  handEl.innerHTML = handHtml;
  handEl.hidden = covered || !handHtml;
  const armyEl = document.getElementById('army-panel') as HTMLElement;
  const armyHtml = armyPanel();
  armyEl.innerHTML = armyHtml;
  armyEl.hidden = covered || !armyHtml;
  const statusEl = document.getElementById('status-panel') as HTMLElement;
  statusEl.innerHTML = statusPanel();
  statusEl.hidden = covered;

  (document.getElementById('btn-recruit') as HTMLButtonElement).disabled = !!state.combat || !myTurn;

  const overlay = document.getElementById('combat-overlay')!;
  if (state.combat) { overlay.classList.add('show'); overlay.innerHTML = combatBox(); }
  else { overlay.classList.remove('show'); overlay.innerHTML = ''; }

  const rec = document.getElementById('recruit-overlay')!;
  if (recruitOpen && !state.combat) { rec.classList.add('show'); rec.innerHTML = recruitBox(); }
  else { rec.classList.remove('show'); rec.innerHTML = ''; }

  // set-up docks to the side, leaving the board visible and pannable — you are
  // deciding where to mass troops, so you need to see the ground. The discard
  // is a plain modal; there is nothing on the map to consult.
  const setupEl = document.getElementById('setup-overlay')!;
  setupEl.classList.toggle('side', inSetup);
  if (inSetup) { setupEl.classList.add('show'); setupEl.innerHTML = setupBox(); }
  else if (state.pendingDiscard) { setupEl.classList.add('show'); setupEl.innerHTML = discardBox(); }
  else { setupEl.classList.remove('show'); setupEl.innerHTML = ''; }

  // swing the map onto the army being raised — otherwise it may sit behind the
  // panel, which rather defeats the point. Only on a change, so panning sticks.
  const raising = inSetup ? allotFocus() : null;
  if (raising?.nation !== allotFramed) {
    allotFramed = raising?.nation ?? null;
    if (raising) {
      const box = setupEl.querySelector('#setup-box')?.getBoundingClientRect();
      const cities = Object.values(state.pieces).filter((p) => p.nation === raising.nation).map((p) => p.node);
      focusCities(cities, (box?.right ?? 0) - (box?.left ?? 0) + 24);
    }
  }

  const help = document.getElementById('help-overlay')!;
  if (helpOpen) { help.classList.add('show'); help.innerHTML = HELP_HTML; }
  else { help.classList.remove('show'); help.innerHTML = ''; }

  // Clock of Fate + withdrawn nations
  const fateTag = document.getElementById('fate-tag')!;
  if (state.turn >= 6 || state.eliminated.length) {
    const out = state.eliminated.length
      ? ' · out: ' + state.eliminated.map((n) => NATION_LABEL[n]).join(', ')
      : '';
    fateTag.hidden = false;
    fateTag.textContent = `Clock of Fate ${state.fateDrawn.length}/18${out}`;
  } else {
    fateTag.hidden = true;
  }

  // victory screen
  const go = document.getElementById('gameover')!;
  if (state.winner) {
    const msg = state.winner.side === 'defender'
      ? 'Frederick endures — Prussia wins the war!'
      : `${NATION_LABEL[state.winner.nation]} has taken all its objectives — victory!`;
    go.classList.add('show');
    go.innerHTML = `<div id="go-card">
      <div class="go-title serif">Victory</div>
      <div class="go-msg">${msg}</div>
      ${mode === 'local' ? '<button class="gb primary" id="go-again">New Game</button>' : `<div class="sub">after ${state.turn} turns</div>`}
    </div>`;
  } else {
    go.classList.remove('show');
    go.innerHTML = '';
  }
}

function renderMap(): void {
  document.getElementById('board-root')!.innerHTML = boardInner();
}

// ---- interactions --------------------------------------------------------

function onBoardClick(e: Event): void {
  if (state.combat) return;
  const target = e.target as Element;

  // during set-up the board is for looking at, not moving on
  if (state.phase === 'setup') return;

  // settling a retreat: the only thing you can do is name one of the offered cities
  if (state.pendingRetreat) {
    const node = target.closest('[data-node]')?.getAttribute('data-node');
    if (node && moveTargets().has(node)) dispatch({ type: 'chooseRetreat', node });
    return;
  }

  const pieceEl = target.closest('[data-piece]');
  if (pieceEl) return onPieceClick(pieceEl.getAttribute('data-piece')!);
  const trainEl = target.closest('[data-train]');
  if (trainEl) return onTrainClick(trainEl.getAttribute('data-train')!);
  const nodeEl = target.closest('[data-node]');
  if (nodeEl) return onNodeClick(nodeEl.getAttribute('data-node')!);
  deselect(); // clicked empty map
}

function deselect(): void {
  if (!selected && !selectedTrain) return;
  selected = null;
  selectedTrain = null;
  renderMap();
  renderChrome();
}

function onTrainClick(trainId: string): void {
  const t = state.trains[trainId];
  if (!t) return;
  if (t.nation === activeNation() && canControl(t.nation)) {
    selectedTrain = selectedTrain === trainId ? null : trainId;
    selected = null;
    renderMap(); renderChrome();
  } else {
    deselect();
  }
}

/** Right-click clears the current selection (and suppresses the browser menu). */
function onBoardContextMenu(e: MouseEvent): void {
  e.preventDefault();
  if (!state.combat) deselect();
}

function onNodeClick(node: string): void {
  if (selectedTrain) {
    if (moveTargets().has(node)) {
      const trainId = selectedTrain;
      selectedTrain = null;
      dispatch({ type: 'moveTrain', trainId, to: node });
    } else {
      deselect();
    }
    return;
  }
  if (!selected) return;
  if (moveTargets().has(node)) {
    const pieceId = selected;
    selected = null;
    dispatch({ type: 'move', pieceId, to: node });
  } else {
    deselect(); // clicked an invalid destination
  }
}

function onPieceClick(pieceId: string): void {
  const p = state.pieces[pieceId];
  if (!p) return;
  // click one of your own active generals → select / toggle off
  if (p.nation === activeNation() && canControl(p.nation)) {
    selected = selected === pieceId ? null : pieceId;
    selectedTrain = null;
    renderMap(); renderChrome();
    return;
  }
  // with a general selected, click an adjacent enemy → attack it
  if (selected) {
    const sel = state.pieces[selected];
    if (sel && areEnemies(sel.nation, p.nation) && areAdjacent(friedrichMap, sel.node, p.node)) {
      const attackerId = selected;
      selected = null;
      dispatch({ type: 'attack', attackerId, defenderId: pieceId });
      return;
    }
    deselect(); // clicked a piece that isn't a valid target
  }
}

function onSetupClick(cmd: string): void {
  const nation = allotNation;
  if (!nation) return;
  const [verb, arg] = cmd.split(':');
  if (verb === 'tab') { allotNation = arg as Nation; allotHover = null; renderMap(); renderChrome(); return; }
  if (verb === 'plus') return bumpAllot(nation, arg!, 1);
  if (verb === 'minus') return bumpAllot(nation, arg!, -1);
  if (verb === 'even') { allotDraft[nation] = suggestAllotment(state, nation); renderMap(); renderChrome(); return; }
  if (verb === 'go') {
    // clear the selection FIRST: dispatch re-renders, and setupBox picks the next
    // unraised nation for us — nulling it afterwards would undo that choice
    allotNation = null;
    dispatch({ type: 'allotTroops', nation, alloc: draftFor(nation) });
  }
}

function onHudClick(e: Event): void {
  const rt = (e.target as Element).closest('[data-rec]') as HTMLElement | null;
  if (rt) return onRecruitClick(rt.dataset.rec!);
  const st = (e.target as Element).closest('[data-setup]') as HTMLElement | null;
  if (st) return onSetupClick(st.dataset.setup!);
  const dt = (e.target as Element).closest('[data-discard]') as HTMLElement | null;
  if (dt) return dispatch({ type: 'discardCard', cardId: dt.dataset.discard! });
  const ht = (e.target as Element).closest('[data-help],#btn-help') as HTMLElement | null;
  if (ht) { helpOpen = ht.id === 'btn-help'; renderChrome(); return; }

  const t = (e.target as Element).closest('[data-card],[data-resval],#cpass,#btn-end,#btn-reset,#btn-undo,#btn-recruit,#go-again,#zoom-in,#zoom-out,#zoom-fit') as HTMLElement | null;
  if (!t) return;
  if (t.id === 'btn-recruit') { recruitOpen = true; recruit.troops = 0; recruit.trains = 0; recruit.cards.clear(); renderChrome(); return; }
  if (t.id === 'btn-undo') { if (selected) dispatch({ type: 'undoMove', pieceId: selected }); return; }
  if (t.id === 'btn-end') { selected = null; dispatch({ type: 'endNationTurn' }); return; }
  if (t.id === 'btn-reset' || t.id === 'go-again') { state = Friedrich.setup('board-demo', ['A', 'B', 'C', 'D']); selected = null; renderMap(); renderChrome(); return; }
  if (t.id === 'zoom-in') return zoomAt(innerWidth / 2, innerHeight / 2, 0.8);
  if (t.id === 'zoom-out') return zoomAt(innerWidth / 2, innerHeight / 2, 1.25);
  if (t.id === 'zoom-fit') return fitView();
  if (t.id === 'cpass') { pendingReserve = null; dispatch({ type: 'combatPass' }); return; }
  if (t.dataset.resval) return onReserveValue(t.dataset.resval);
  if (t.dataset.card) return onCombatCard(t.dataset.card);
}

function onRecruitClick(cmd: string): void {
  if (cmd === 'cancel') { recruitOpen = false; renderChrome(); return; }
  if (cmd === 't+') recruit.troops++;
  if (cmd === 't-') recruit.troops = Math.max(0, recruit.troops - 1);
  if (cmd === 's+') recruit.trains++;
  if (cmd === 's-') recruit.trains = Math.max(0, recruit.trains - 1);
  if (cmd.startsWith('card:')) {
    const id = cmd.slice(5);
    if (recruit.cards.has(id)) recruit.cards.delete(id);
    else recruit.cards.add(id);
  }
  if (cmd === 'go') {
    const target = (document.getElementById('rec-target') as HTMLSelectElement | null)?.value ?? '';
    const node = (document.getElementById('rec-depot') as HTMLSelectElement | null)?.value;
    const [kind, id] = target.split(':');
    recruitOpen = false;
    // build without empty keys (exactOptionalPropertyTypes)
    const action: Extract<WithoutBy<FriedrichAction>, { type: 'recruit' }> = {
      type: 'recruit',
      troops: recruit.troops,
      trains: recruit.trains,
      cardIds: [...recruit.cards],
      ...(node ? { node } : {}),
      ...(kind === 'return' && id ? { generalId: id } : {}),
      ...(kind === 'reinforce' && id ? { reinforceId: id } : {}),
    };
    dispatch(action);
    return;
  }
  renderChrome();
}

function onCombatCard(cardId: string): void {
  const c = state.combat!;
  const p = c.duel.toMove === 'attacker' ? c.duel.attacker : c.duel.defender;
  const card = p.hand.find((x) => x.id === cardId);
  if (!card) return;
  if (card.kind === 'reserve') { pendingReserve = cardId; renderChrome(); return; }
  dispatch({ type: 'combatPlay', cardId });
}

function onReserveValue(raw: string): void {
  const c = state.combat!;
  const cardId = pendingReserve!;
  pendingReserve = null;
  if (raw === 'cancel') { renderChrome(); return; }
  const suit = (c.duel.toMove === 'attacker' ? c.duel.attacker : c.duel.defender).sectorSuit;
  dispatch({ type: 'combatPlay', cardId, reserve: { suit, value: Math.max(1, Math.min(10, +raw)) } });
}

// ---- mount ---------------------------------------------------------------

const COMPASS = `<svg id="compass" viewBox="-60 -60 120 120" stroke="#c6a24a" fill="#c6a24a">
  <circle r="52" fill="none" stroke-width="3"/><circle r="40" fill="none" stroke-width="1"/>
  <path d="M0,-50 L9,0 L0,50 L-9,0 Z" fill="#e7d9b8"/><path d="M-50,0 L0,9 L50,0 L0,-9 Z"/>
  <text y="-56" text-anchor="middle" font-family="Georgia" font-size="18" stroke="none">N</text></svg>`;

function mount(): void {
  document.getElementById('app')!.innerHTML = `
    <div id="topbar">
      <div id="title" class="serif">FRIEDRICH<small>DER SIEBENJÄHRIGE KRIEG</small></div>
      <div class="turnbox"><div class="yr">Turn <span id="turn-num">1</span></div><div class="lbl">1756 · Clock of Fate</div></div>
      <div id="active-banner"><span class="swatch"></span><div><span class="who serif"></span> <span class="sub">to act</span></div></div>
      <div class="bar-spacer"></div>
      <div id="fate-tag" class="muted-tag" hidden></div>
      <div id="you-tag" class="muted-tag"></div>
      <button class="gb" id="btn-help" title="How to play">?</button>
      <div class="navlinks"><a href="/duel.html">Duel</a></div>
    </div>
    <div id="map-view">
      <svg id="board-svg" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><g id="board-root"></g></svg>
      <div id="vignette"></div>
      ${COMPASS}
      <div id="hud">
        <div id="left-col">
          <div id="log-panel" class="panel"><h4>Dispatches</h4><ul id="log-list"></ul></div>
          <div id="army-panel" class="panel" hidden></div>
        </div>
        <div id="status-panel" class="panel"></div>
        <div id="bottom-col">
          <div id="hand-panel" class="panel"></div>
          <div id="command" class="panel">
            <span id="status-line"></span>
            <button class="gb" id="btn-undo" hidden>Undo Move</button>
            <button class="gb" id="btn-recruit">Recruit</button>
            <button class="gb primary" id="btn-end">End Stage</button>
            <button class="gb" id="btn-reset">New Game</button>
          </div>
        </div>
        <div id="zoom" class="panel">
          <button class="gb" id="zoom-in">+</button>
          <button class="gb" id="zoom-out">−</button>
          <button class="gb" id="zoom-fit">⤢</button>
        </div>
        <div id="combat-overlay"></div>
        <div id="recruit-overlay" class="modal"></div>
        <div id="setup-overlay" class="modal"></div>
        <div id="help-overlay" class="modal"></div>
        <div id="gameover"></div>
      </div>
    </div>
    <div id="lobby"><div id="lobby-card"></div></div>`;

  const root = document.getElementById('board-root')!;
  root.addEventListener('click', onBoardClick);
  // hover any counter (including the enemy's) to inspect that stack
  root.addEventListener('mouseover', (e) => {
    const el = (e.target as Element).closest('[data-piece]');
    const id = el?.getAttribute('data-piece') ?? null;
    if (id === hovered) return;
    hovered = id;
    // during set-up the highlight runs both ways: hovering a counter on the map
    // picks out its row in the panel
    if (state.phase === 'setup') { allotHover = id; renderMap(); }
    renderChrome();
  });
  root.addEventListener('mouseout', (e) => {
    if ((e.target as Element).closest('[data-piece]') && hovered) { hovered = null; renderChrome(); }
  });
  // hovering a general's row in the set-up panel picks him out on the map
  const setupEl = document.getElementById('setup-overlay')!;
  setupEl.addEventListener('mouseover', (e) => {
    const id = (e.target as Element).closest('[data-general]')?.getAttribute('data-general') ?? null;
    if (id !== allotHover) { allotHover = id; renderMap(); renderChrome(); }
  });
  setupEl.addEventListener('mouseleave', () => {
    if (allotHover) { allotHover = null; renderMap(); renderChrome(); }
  });
  document.getElementById('map-view')!.addEventListener('contextmenu', onBoardContextMenu);
  document.getElementById('hud')!.addEventListener('click', onHudClick);
  document.getElementById('lobby')!.addEventListener('click', onLobbyClick);
  // the help button lives in the topbar, outside the delegated HUD handler
  document.getElementById('btn-help')!.addEventListener('click', () => { helpOpen = true; renderChrome(); });
  setupPanZoom();
  fitView();
  renderMap();
  renderChrome();
  renderLobby('choose');
}

// ---- lobby + networking --------------------------------------------------

function renderLobby(stage: 'choose' | 'waiting'): void {
  const lobby = document.getElementById('lobby')!;
  const card = document.getElementById('lobby-card')!;
  lobby.classList.add('show');
  if (stage === 'choose') {
    const name = localStorage.getItem('friedrich.name') ?? '';
    const room = localStorage.getItem('friedrich.room') ?? '';
    card.innerHTML = `
      <h2 class="serif">FRIEDRICH</h2>
      <p class="sub">The Seven Years' War, online. 3–4 players.</p>
      <label>Your name<input id="lb-name" value="${name}" placeholder="Frederick" maxlength="20"></label>
      <label>Room code<input id="lb-room" value="${room}" placeholder="leuthen" maxlength="24"></label>
      <div class="lb-buttons">
        <button class="gb primary" id="lb-online">Play online</button>
        <button class="gb" id="lb-local">Play locally (hotseat)</button>
      </div>
      <p id="lb-msg" class="lb-msg"></p>
      <p class="sub small">Online: share the room code with friends. Everyone opens this page, enters the same code, and joins.</p>`;
  } else {
    const link = `${location.origin}/board.html?room=${encodeURIComponent(roomCode)}`;
    const rows = players
      .map((p) => `<li>${p.connected ? '🟢' : '⚪'} seat ${p.seat + 1}: <b>${p.name}</b>${p.playerId === myPlayerId ? ' (you)' : ''}</li>`)
      .join('');
    card.innerHTML = `
      <h2 class="serif">Room “${roomCode}”</h2>
      <p class="sub">Waiting for players — need ${Friedrich.minPlayers}, up to ${Friedrich.maxPlayers}. ${players.length} here.</p>
      <ul class="lb-players">${rows}</ul>
      <label>Invite link<input id="lb-link" readonly value="${link}" onclick="this.select()"></label>
      <p id="lb-msg" class="lb-msg">The game begins automatically once ${Friedrich.minPlayers} have joined.</p>`;
  }
}

function startLocal(): void {
  mode = 'local';
  state = Friedrich.setup('board-demo', ['A', 'B', 'C', 'D']);
  selected = null;
  document.getElementById('lobby')!.classList.remove('show');
  renderMap();
  renderChrome();
}

function joinOnline(name: string, room: string): void {
  mode = 'net';
  roomCode = room;
  localStorage.setItem('friedrich.name', name);
  localStorage.setItem('friedrich.room', room);
  conn = new GameConnection(undefined, onServerMessage, () => {});
  conn.connect();
  conn.send({ t: 'join', room, name });
  renderLobby('waiting');
}

function onServerMessage(msg: ServerMessage): void {
  switch (msg.t) {
    case 'joined':
      myPlayerId = msg.playerId;
      roomCode = msg.room;
      break;
    case 'players':
      players = [...msg.players];
      if (!started) renderLobby('waiting');
      break;
    case 'state': {
      state = msg.view as FriedrichState;
      if (selected && !state.pieces[selected]) selected = null;
      if (!started) {
        started = true;
        document.getElementById('lobby')!.classList.remove('show');
        fitView();
      }
      renderMap();
      renderChrome();
      break;
    }
    case 'error': {
      const lm = document.getElementById('lb-msg');
      if (!started && lm) lm.textContent = String(msg.message);
      else flashStatus(String(msg.message));
      break;
    }
  }
}

function onLobbyClick(e: Event): void {
  const t = (e.target as Element).closest('#lb-online,#lb-local') as HTMLElement | null;
  if (!t) return;
  const name = (document.getElementById('lb-name') as HTMLInputElement)?.value.trim() || 'Player';
  const room = (document.getElementById('lb-room') as HTMLInputElement)?.value.trim().toLowerCase();
  if (t.id === 'lb-local') return startLocal();
  if (t.id === 'lb-online') {
    if (!room) { document.getElementById('lb-msg')!.textContent = 'Enter a room code to play online.'; return; }
    joinOnline(name, room);
  }
}

mount();

// deep link: /board.html?room=xyz prefills the room code
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) {
  const input = document.getElementById('lb-room') as HTMLInputElement | null;
  if (input) input.value = roomParam;
}
