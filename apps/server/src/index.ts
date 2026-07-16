/**
 * Authoritative game server. Holds the true state for each room, validates every
 * action through the shared reducer + authorization, and broadcasts each player
 * their redacted view. Also serves the built client, so the whole game runs as a
 * single service (one port) — which is what Railway deploys. JSON over WebSocket.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { DEFAULT_PORT, type ClientMessage, type ServerMessage, type RoomPlayer } from '@friedrich/engine';
import { Friedrich, authorizeAction, type FriedrichState, type FriedrichAction } from '@friedrich/game';

// ---- rooms ---------------------------------------------------------------

interface Seat {
  readonly playerId: string;
  readonly name: string;
  readonly seat: number;
  ws: WebSocket | null;
}
interface Room {
  readonly code: string;
  readonly seats: Seat[];
  state: FriedrichState | null;
}

const rooms = new Map<string, Room>();

function getRoom(code: string): Room {
  let room = rooms.get(code);
  if (!room) {
    room = { code, seats: [], state: null };
    rooms.set(code, room);
  }
  return room;
}

const isLocked = (room: Room): boolean => room.state !== null && room.state.version > 0;

function rebuildState(room: Room): void {
  const ids = room.seats.map((s) => s.playerId);
  if (ids.length >= Friedrich.minPlayers) room.state = Friedrich.setup(room.code, ids);
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function roomPlayers(room: Room): RoomPlayer[] {
  return room.seats.map((s) => ({
    playerId: s.playerId,
    name: s.name,
    seat: s.seat,
    connected: s.ws !== null && s.ws.readyState === s.ws.OPEN,
  }));
}

function broadcast(room: Room): void {
  const players = roomPlayers(room);
  for (const seat of room.seats) {
    if (!seat.ws) continue;
    send(seat.ws, { t: 'players', players });
    if (room.state) {
      send(seat.ws, { t: 'state', version: room.state.version, view: Friedrich.redact(room.state, seat.playerId) });
    }
  }
}

function handleJoin(ws: WebSocket, room: Room, name: string): Seat | null {
  const existing = room.seats.find((s) => s.name === name);
  if (existing) {
    existing.ws = ws; // reconnect by name
    return existing;
  }
  if (isLocked(room)) {
    send(ws, { t: 'error', message: 'Game already started; cannot take a new seat.' });
    return null;
  }
  if (room.seats.length >= Friedrich.maxPlayers) {
    send(ws, { t: 'error', message: 'Room is full.' });
    return null;
  }
  const seat: Seat = { playerId: `${room.code}:${room.seats.length}:${name}`, name, seat: room.seats.length, ws };
  room.seats.push(seat);
  rebuildState(room);
  return seat;
}

// ---- static file serving (built client) ----------------------------------

const CLIENT_DIR = process.env.CLIENT_DIR ?? join(process.cwd(), 'apps', 'client', 'dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.map': 'application/json', '.woff2': 'font/woff2',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]!);
  let rel = urlPath === '/' ? 'board.html' : urlPath.replace(/^\/+/, '');
  // keep the request inside CLIENT_DIR
  const filePath = normalize(join(CLIENT_DIR, rel));
  if (!filePath.startsWith(normalize(CLIENT_DIR))) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) throw new Error('dir');
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' }).end(body);
  } catch {
    // unknown path → board (single entry) so deep links still load
    try {
      const body = await readFile(join(CLIENT_DIR, 'board.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html']! }).end(body);
    } catch {
      res.writeHead(404).end('Client build not found. Run `npm run build`.');
    }
  }
}

// ---- wire up http + ws on one port ---------------------------------------

const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
const httpServer = createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200).end('ok'); return; }
  void serveStatic(req, res);
});
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  let joined: { room: Room; seat: Seat } | null = null;

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      send(ws, { t: 'error', message: 'Malformed message.' });
      return;
    }

    if (msg.t === 'join') {
      const room = getRoom(msg.room);
      const seat = handleJoin(ws, room, msg.name);
      if (!seat) return;
      joined = { room, seat };
      send(ws, { t: 'joined', room: room.code, playerId: seat.playerId, seat: seat.seat });
      broadcast(room);
      return;
    }

    if (msg.t === 'action') {
      if (!joined) return send(ws, { t: 'error', message: 'Join a room first.' });
      const { room, seat } = joined;
      if (!room.state) return send(ws, { t: 'error', message: 'Waiting for enough players to start.' });
      const action = { ...msg.action, by: seat.playerId } as FriedrichAction;
      const denied = authorizeAction(room.state, seat.playerId, action);
      if (denied) return send(ws, { t: 'error', message: denied });
      try {
        room.state = Friedrich.reducer(room.state, action);
      } catch (err) {
        return send(ws, { t: 'error', message: err instanceof Error ? err.message : 'Illegal action.' });
      }
      broadcast(room);
      return;
    }
  });

  ws.on('close', () => {
    if (!joined) return;
    joined.seat.ws = null;
    broadcast(joined.room);
  });
});

httpServer.listen(PORT, () => console.log(`Friedrich server on http://localhost:${PORT} (ws + client)`));
