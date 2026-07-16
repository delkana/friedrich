# Friedrich — online

A real-time, browser-based engine for the card-driven wargame **Friedrich**
(the Seven Years' War, 1756–1763), designed by **Richard Sivél** and published by
**Histogame**. Built engine-first: a deterministic rules core with the full board
game playable online in a grand-strategy interface.

> ⚠️ **Fan project, non-commercial.** Friedrich is the intellectual property of its
> designer and publisher. This repository contains only original code plus a
> **factual** representation of the map (city graph, sector suits, objectives) that
> the game needs to run. The copyrighted board artwork, scans and the VASSAL module
> used while digitizing the map are **not** included (see `.gitignore`). If you are
> the rights holder and have concerns, please open an issue.

## Play

Open the app, enter a room code, and share it with 2–3 friends — everyone who
enters the same code joins the same game. Or click **Play locally (hotseat)** to
try it solo on one screen.

- Pan/zoom the parchment map (drag, wheel, pinch on touch).
- On your nation's stage: move your generals (once each — with undo and a ghost
  marker of where they started), then attack adjacent enemies.
- Battles are resolved with the authentic suit-restricted **card duel**.
- Enemy troop counts and hands are hidden from you, as on the real board.

## Architecture

```
packages/
  engine/      Pure, deterministic rules core. No network, no DOM.
               Seeded RNG, map graph + movement, the suit/card duel, the
               action + reducer contract, and the ws protocol types.
  friedrich/   Friedrich data + rules on the engine: the 671-city map, the four
               player roles over seven nations, generals, objectives, combat,
               movement (move-once + undo), redaction + turn authorization.
apps/
  server/      Authoritative Node server. Owns true state + the RNG seed,
               validates every action, redacts each player's view, and also
               serves the built client — one process, one port.
  client/      Vite + TS. Full-screen grand-strategy board (pan/zoom, HUD,
               battle dialog, lobby), a standalone combat-duel demo, and a
               minimal room view.
```

The same `reducer(state, action)` runs on the server and (for hotseat) the
client. Online, the server is authoritative: it hides other players' troop counts
and hands, and only lets a player act for the nation whose turn it is.

## Develop

```bash
npm install
npm run dev:server   # ws + static on :8787
npm run dev:client   # Vite dev server on :5173

npm test             # engine + game unit tests (node:test)
npm run build        # server (tsc) + client (vite) → production
npm start            # serve the built game on $PORT (default 8787)
```

Quick end-to-end checks: `node scripts/net-smoke.mjs` (redaction + authorization
over ws) and `node scripts/smoke.mjs` (room sync).

## Deploy (Railway)

The whole game is one service on a single port. `railway.json` sets
`npm run build` then `npm start`; Railway provides `PORT`, and the client connects
back to the same origin over WebSocket. Point Railway at this repo and deploy.

## Status

Playable online: the full map, movement (once-per-stage with undo + ghost),
stacking, and card-duel combat with casualties + retreat, all authoritative and
hidden-info-correct. Still to come: supply/attrition, victory conditions, the
Cards of Fate end-game, and per-stage card draw.
