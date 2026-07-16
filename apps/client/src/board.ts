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
  areEnemies,
  MAX_STACK,
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
let pendingReserve: string | null = null;
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
  if (!selected || state.combat) return targets;
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
      const obj = n.objectiveFor
        ? `<rect x="${n.x + 22}" y="${n.y - 54}" width="30" height="30" fill="${NATION_COLOR[n.objectiveFor as Nation] ?? '#888'}" stroke="#241a0e" stroke-width="3"/>` +
          (n.objectiveOrder === 2 ? `<line x1="${n.x + 24}" y1="${n.y - 26}" x2="${n.x + 50}" y2="${n.y - 52}" stroke="#f2e7c8" stroke-width="5"/>` : '')
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

  const pieces = [...friedrichMap.nodes.values()]
    .flatMap((n) => piecesAt(n.id).map((p, i) => {
      const px = n.x + 54;
      const py = n.y - 30 + i * 46;
      const canSelect = p.nation === activeNation() && canControl(p.nation) && !state.combat;
      const isTarget = sel && areEnemies(sel.nation, p.nation) && areAdjacent(friedrichMap, sel.node, p.node);
      const cls = [p.id === selected ? 'sel' : '', isTarget ? 'target' : ''].join(' ');
      const troops = p.troops === HIDDEN_TROOPS ? '?' : String(p.troops);
      return `<g class="piece ${cls}" data-piece="${p.id}" style="${canSelect || isTarget ? '' : 'cursor:default'}">
        <circle cx="${px}" cy="${py}" r="52" fill="none" pointer-events="all"/>
        <circle class="ring" cx="${px}" cy="${py}" r="34"/>
        <circle cx="${px}" cy="${py}" r="25" fill="${NATION_COLOR[p.nation]}"/>
        <text class="ptext" x="${px}" y="${py + 11}">${troops}</text></g>`;
    }))
    .join('');

  return defs + ground + washes + sectors + stamps + edges + ghosts + nodes + pieces;
}

// ---- pan / zoom ----------------------------------------------------------

const mapView = () => document.getElementById('map-view')!;
const boardSvg = () => document.getElementById('board-svg') as unknown as SVGSVGElement;

function applyView(): void {
  boardSvg().setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
}

function fitView(): void {
  const r = mapView().getBoundingClientRect();
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

  el.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    didGesture = false; // always start a fresh gesture — never inherit a prior drag's suppression
    if (pts.size === 1) {
      dragId = e.pointerId;
      start = { x: e.clientX, y: e.clientY };
      last = { ...start };
    }
    if (pts.size === 2) pinchDist = 0;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
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
    view.h = view.w * (r.height / r.width);
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

function renderChrome(): void {
  const nation = activeNation();
  document.getElementById('turn-num')!.textContent = String(state.turn);
  const banner = document.getElementById('active-banner')!;
  banner.querySelector('.swatch')!.setAttribute('style', `background:${NATION_COLOR[nation]}`);
  banner.querySelector('.who')!.textContent = NATION_LABEL[nation];

  const youTag = document.getElementById('you-tag')!;
  if (mode === 'net') {
    const mine = [...(myNations() ?? new Set<Nation>())].map((n) => NATION_LABEL[n]).join(', ');
    youTag.textContent = mine ? `You: ${mine}` : 'Spectator';
  } else {
    youTag.textContent = 'Hotseat';
  }

  const log = document.getElementById('log-list')!;
  log.innerHTML = state.log.slice(-14).map((l) => `<li>${l}</li>`).join('');
  log.scrollTop = log.scrollHeight;

  const myTurn = canControl(nation);
  const selMoved = selected != null && state.stageMoves[selected] !== undefined;
  const status = document.getElementById('status-line')!;
  status.textContent = state.combat
    ? 'Battle underway…'
    : !myTurn
      ? `Waiting for ${NATION_LABEL[nation]}…`
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

  const overlay = document.getElementById('combat-overlay')!;
  if (state.combat) { overlay.classList.add('show'); overlay.innerHTML = combatBox(); }
  else { overlay.classList.remove('show'); overlay.innerHTML = ''; }
}

function renderMap(): void {
  document.getElementById('board-root')!.innerHTML = boardInner();
}

// ---- interactions --------------------------------------------------------

function onBoardClick(e: Event): void {
  if (state.combat) return;
  const target = e.target as Element;
  const pieceEl = target.closest('[data-piece]');
  if (pieceEl) return onPieceClick(pieceEl.getAttribute('data-piece')!);
  const nodeEl = target.closest('[data-node]');
  if (nodeEl) return onNodeClick(nodeEl.getAttribute('data-node')!);
  deselect(); // clicked empty map
}

function deselect(): void {
  if (!selected) return;
  selected = null;
  renderMap();
  renderChrome();
}

/** Right-click clears the current selection (and suppresses the browser menu). */
function onBoardContextMenu(e: MouseEvent): void {
  e.preventDefault();
  if (!state.combat) deselect();
}

function onNodeClick(node: string): void {
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

function onHudClick(e: Event): void {
  const t = (e.target as Element).closest('[data-card],[data-resval],#cpass,#btn-end,#btn-reset,#btn-undo,#zoom-in,#zoom-out,#zoom-fit') as HTMLElement | null;
  if (!t) return;
  if (t.id === 'btn-undo') { if (selected) dispatch({ type: 'undoMove', pieceId: selected }); return; }
  if (t.id === 'btn-end') { selected = null; dispatch({ type: 'endNationTurn' }); return; }
  if (t.id === 'btn-reset') { state = Friedrich.setup('board-demo', ['A', 'B', 'C', 'D']); selected = null; renderMap(); renderChrome(); return; }
  if (t.id === 'zoom-in') return zoomAt(innerWidth / 2, innerHeight / 2, 0.8);
  if (t.id === 'zoom-out') return zoomAt(innerWidth / 2, innerHeight / 2, 1.25);
  if (t.id === 'zoom-fit') return fitView();
  if (t.id === 'cpass') { pendingReserve = null; dispatch({ type: 'combatPass' }); return; }
  if (t.dataset.resval) return onReserveValue(t.dataset.resval);
  if (t.dataset.card) return onCombatCard(t.dataset.card);
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
      <div id="you-tag" class="muted-tag"></div>
      <div class="navlinks"><a href="/duel.html">Duel</a></div>
    </div>
    <div id="map-view">
      <svg id="board-svg" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><g id="board-root"></g></svg>
      <div id="vignette"></div>
      ${COMPASS}
      <div id="hud">
        <div id="log-panel" class="panel"><h4>Dispatches</h4><ul id="log-list"></ul></div>
        <div id="command" class="panel">
          <span id="status-line"></span>
          <button class="gb" id="btn-undo" hidden>Undo Move</button>
          <button class="gb primary" id="btn-end">End Stage</button>
          <button class="gb" id="btn-reset">New Game</button>
        </div>
        <div id="zoom" class="panel">
          <button class="gb" id="zoom-in">+</button>
          <button class="gb" id="zoom-out">−</button>
          <button class="gb" id="zoom-fit">⤢</button>
        </div>
        <div id="combat-overlay"></div>
      </div>
    </div>
    <div id="lobby"><div id="lobby-card"></div></div>`;

  document.getElementById('board-root')!.addEventListener('click', onBoardClick);
  document.getElementById('map-view')!.addEventListener('contextmenu', onBoardContextMenu);
  document.getElementById('hud')!.addEventListener('click', onHudClick);
  document.getElementById('lobby')!.addEventListener('click', onLobbyClick);
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
