/**
 * Standalone, network-free combat demo. It drives the engine's duel state
 * machine directly so you can play a battle hand-to-hand (hotseat: you control
 * both sides). This same view becomes the real combat panel once battles are
 * triggered from the board.
 */

import {
  SUITS,
  buildTacticalDeck,
  rngShuffle,
  seedFromString,
  startDuel,
  playCard,
  pass,
  mustPlay,
  legalCardIds,
  type Suit,
  type TacticalCard,
  type DuelState,
  type DuelSide,
  type DuelCombatant,
} from '@friedrich/engine';

const app = document.getElementById('app')!;

const SUIT_SYMBOL: Record<Suit, string> = { clubs: '♣', spades: '♠', hearts: '♥', diamonds: '♦' };
const isRed = (s: Suit) => s === 'hearts' || s === 'diamonds';

interface Config {
  atkTroops: number;
  defTroops: number;
  atkSuit: Suit;
  defSuit: Suit;
  handSize: number;
  seed: string;
}

let phase: 'setup' | 'playing' = 'setup';
let cfg: Config = { atkTroops: 2, defTroops: 4, atkSuit: 'diamonds', defSuit: 'spades', handSize: 6, seed: 'demo' };
let duel: DuelState | null = null;
let pendingReserve: string | null = null; // cardId awaiting a declared value

function drawHand(owner: string, size: number, seed: string): TacticalCard[] {
  const { items } = rngShuffle(seedFromString(`${seed}:${owner}`), buildTacticalDeck(owner));
  return items.slice(0, size);
}

function startFromConfig(): void {
  const attacker: DuelCombatant = { troops: cfg.atkTroops, sectorSuit: cfg.atkSuit, hand: drawHand('atk', cfg.handSize, cfg.seed) };
  const defender: DuelCombatant = { troops: cfg.defTroops, sectorSuit: cfg.defSuit, hand: drawHand('def', cfg.handSize, cfg.seed) };
  duel = startDuel(attacker, defender);
  pendingReserve = null;
  phase = 'playing';
  render();
}

function startRulebookExample(): void {
  const attacker: DuelCombatant = {
    troops: 2,
    sectorSuit: 'diamonds',
    hand: [
      { id: 'diamonds-10', kind: 'suit', suit: 'diamonds', value: 10 },
      { id: 'diamonds-7', kind: 'suit', suit: 'diamonds', value: 7 },
      { id: 'diamonds-4', kind: 'suit', suit: 'diamonds', value: 4 },
      { id: 'atk-reserve', kind: 'reserve' },
    ],
  };
  const defender: DuelCombatant = {
    troops: 4,
    sectorSuit: 'spades',
    hand: [
      { id: 'spades-5', kind: 'suit', suit: 'spades', value: 5 },
      { id: 'spades-3', kind: 'suit', suit: 'spades', value: 3 },
      { id: 'spades-4', kind: 'suit', suit: 'spades', value: 4 },
    ],
  };
  duel = startDuel(attacker, defender);
  pendingReserve = null;
  phase = 'playing';
  render();
}

// ---- setup view ----------------------------------------------------------

function renderSetup(): void {
  const suitOptions = (sel: Suit) =>
    SUITS.map((s) => `<option value="${s}" ${s === sel ? 'selected' : ''}>${SUIT_SYMBOL[s]} ${s}</option>`).join('');

  app.innerHTML = `
    <div class="card">
      <div class="row" style="align-items:flex-start; gap:2rem">
        <div>
          <h3>Attacker</h3>
          <label>Troops <input id="atkTroops" type="number" min="1" max="8" value="${cfg.atkTroops}" style="width:4rem"></label><br>
          <label>Sector suit <select id="atkSuit">${suitOptions(cfg.atkSuit)}</select></label>
        </div>
        <div>
          <h3>Defender</h3>
          <label>Troops <input id="defTroops" type="number" min="1" max="8" value="${cfg.defTroops}" style="width:4rem"></label><br>
          <label>Sector suit <select id="defSuit">${suitOptions(cfg.defSuit)}</select></label>
        </div>
        <div>
          <h3>Deal</h3>
          <label>Hand size <input id="handSize" type="number" min="0" max="20" value="${cfg.handSize}" style="width:4rem"></label><br>
          <label>Seed <input id="seed" value="${cfg.seed}" style="width:7rem"></label>
        </div>
      </div>
      <div class="row" style="margin-top:1rem">
        <button id="startRandom">Deal &amp; fight</button>
        <button id="startExample">Load rulebook example</button>
      </div>
      <p class="muted">The behind side plays first; cards must match that general's sector suit; Reserves are wild.
      Close the gap to swing the right-to-play, or accept defeat.</p>
    </div>`;

  const num = (id: string) => (document.getElementById(id) as HTMLInputElement);
  const sel = (id: string) => (document.getElementById(id) as HTMLSelectElement);
  const readConfig = () => {
    cfg = {
      atkTroops: clamp(+num('atkTroops').value, 1, 8),
      defTroops: clamp(+num('defTroops').value, 1, 8),
      atkSuit: sel('atkSuit').value as Suit,
      defSuit: sel('defSuit').value as Suit,
      handSize: clamp(+num('handSize').value, 0, 20),
      seed: num('seed').value || 'demo',
    };
  };
  document.getElementById('startRandom')!.addEventListener('click', () => { readConfig(); startFromConfig(); });
  document.getElementById('startExample')!.addEventListener('click', () => startRulebookExample());
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

// ---- playing view --------------------------------------------------------

function cardHtml(card: TacticalCard, playable: boolean): string {
  if (card.kind === 'reserve') {
    return `<div class="tc reserve ${playable ? 'playable' : 'disabled'}" data-card="${card.id}">RES<br>1–10</div>`;
  }
  const red = isRed(card.suit) ? 'red' : '';
  const cls = `tc ${red} ${playable ? 'playable' : 'disabled'}`;
  return `<div class="${cls}" data-card="${card.id}"><span class="sym">${SUIT_SYMBOL[card.suit]}</span><span class="val">${card.value}</span></div>`;
}

function partyHtml(s: DuelState, side: DuelSide): string {
  const p = side === 'attacker' ? s.attacker : s.defender;
  const active = s.status === 'active' && s.toMove === side;
  const legal = new Set(active ? legalCardIds(s, side) : []);
  const label = side === 'attacker' ? 'Attacker' : 'Defender';
  const hand = p.hand.map((c) => cardHtml(c, legal.has(c.id))).join('') || '<span class="muted">— no cards —</span>';
  return `
    <div class="party ${active ? 'active' : ''}">
      <h3>${label} ${active ? '⭐' : ''}</h3>
      <div class="muted">sector ${SUIT_SYMBOL[p.sectorSuit]} ${p.sectorSuit} · troops ${p.troops}</div>
      <div class="tot">total <b>${p.total}</b> = ${p.troops} troops + ${p.total - p.troops} cards</div>
      <div class="hand">${hand}</div>
    </div>`;
}

function scoreBar(s: DuelState): string {
  const diff = s.attacker.total - s.defender.total; // + = attacker ahead
  const mag = Math.min(Math.abs(diff), 20);
  const pct = (mag / 20) * 50;
  const fill =
    diff === 0
      ? ''
      : diff > 0
        ? `<div class="fill" style="left:50%; width:${pct}%; background:#3b5b92"></div>`
        : `<div class="fill" style="right:50%; width:${pct}%; background:#b23b3b"></div>`;
  const who = diff === 0 ? 'even' : diff > 0 ? `attacker ahead by ${diff}` : `defender ahead by ${-diff}`;
  return `<div class="score">${fill}<div class="mid"></div></div><div class="muted">score ${who}</div>`;
}

function resultBanner(s: DuelState): string {
  const r = s.result!;
  if (r.outcome === 'tie') return `<div class="banner tie">Tie — both hold. No losses, no retreat.</div>`;
  const winner = r.outcome === 'attacker_won' ? 'Attacker' : 'Defender';
  const loser = r.loser === 'attacker' ? 'Attacker' : 'Defender';
  const fate = r.loserEliminated
    ? `${loser} is wiped out (loses all ${r.casualties} committed).`
    : `${loser} loses ${r.casualties} troop(s) and must retreat ${r.casualties} cities.`;
  return `<div class="banner win">${winner} wins. ${fate}</div>`;
}

function reservePicker(cardId: string): string {
  const vals = Array.from({ length: 10 }, (_, i) => i + 1)
    .map((v) => `<button data-resval="${v}">${v}</button>`)
    .join(' ');
  return `<div class="card"><b>Declare Reserve value</b> <span class="muted">(card ${cardId})</span>
    <div class="row" style="margin-top:.4rem">${vals} <button data-resval="cancel">cancel</button></div></div>`;
}

function renderPlaying(): void {
  const s = duel!;
  const mover = s.toMove;
  const forced = s.status === 'active' && mustPlay(s, mover);
  const logHtml = s.history
    .map((h) => `<li>${h.side} played ${h.cardId} (+${h.value}) → score ${h.diffAfter >= 0 ? '+' : ''}${h.diffAfter}</li>`)
    .join('');

  app.innerHTML = `
    <div class="card">
      <div class="row" style="gap:1rem; align-items:stretch">${partyHtml(s, 'attacker')}${partyHtml(s, 'defender')}</div>
      ${scoreBar(s)}
      ${s.status === 'active'
        ? `<div class="row" style="margin-top:.5rem">
             <button id="pass" ${forced ? 'disabled' : ''}>${passLabel(s)}</button>
             <span class="muted">${forced ? `${mover} holds a matching card and must play it.` : `${mover} to act.`}</span>
           </div>`
        : `${resultBanner(s)}<div class="row" style="margin-top:.6rem"><button id="again">New duel</button></div>`}
    </div>
    ${pendingReserve ? reservePicker(pendingReserve) : ''}
    <div class="card"><b>Play log</b><ul class="log">${logHtml || '<li class="muted">no cards played yet</li>'}</ul></div>`;

  // wire card clicks (only playable ones matter)
  for (const el of Array.from(app.querySelectorAll<HTMLElement>('.tc.playable'))) {
    el.addEventListener('click', () => onCardClick(el.dataset.card!));
  }
  document.getElementById('pass')?.addEventListener('click', () => { duel = pass(s, mover); pendingReserve = null; render(); });
  document.getElementById('again')?.addEventListener('click', () => { phase = 'setup'; duel = null; render(); });
  for (const b of Array.from(app.querySelectorAll<HTMLElement>('[data-resval]'))) {
    b.addEventListener('click', () => onReserveValue(b.dataset.resval!));
  }
}

function onCardClick(cardId: string): void {
  const s = duel!;
  const mover = s.toMove;
  const card = (mover === 'attacker' ? s.attacker : s.defender).hand.find((c) => c.id === cardId);
  if (!card) return;
  if (card.kind === 'reserve') {
    pendingReserve = cardId; // ask for a value
    render();
    return;
  }
  duel = playCard(s, mover, cardId);
  render();
}

function onReserveValue(raw: string): void {
  const s = duel!;
  const mover = s.toMove;
  const cardId = pendingReserve!;
  pendingReserve = null;
  if (raw === 'cancel') { render(); return; }
  const value = clamp(+raw, 1, 10);
  const suit = (mover === 'attacker' ? s.attacker : s.defender).sectorSuit;
  duel = playCard(s, mover, cardId, { suit, value });
  render();
}

function passLabel(s: DuelState): string {
  const diff = s.attacker.total - s.defender.total;
  return diff === 0 ? 'Pass (offer tie)' : 'Accept defeat';
}

// ---- router --------------------------------------------------------------

function render(): void {
  if (phase === 'setup') renderSetup();
  else renderPlaying();
}

render();
