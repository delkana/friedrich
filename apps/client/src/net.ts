/**
 * Thin WebSocket client. Sends actions to the authoritative server and surfaces
 * server messages via a callback. No game logic lives here.
 */

import { DEFAULT_PORT, type ClientMessage, type ServerMessage } from '@friedrich/engine';

export type ServerHandler = (msg: ServerMessage) => void;

/**
 * Where the ws server lives. In dev the Vite client (5199) and ws server (8787)
 * are separate, so target the ws port on the same host; in production the server
 * serves the client too, so connect to the same origin (wss under https).
 */
export function defaultServerUrl(): string {
  if (import.meta.env.DEV) return `ws://${location.hostname}:${DEFAULT_PORT}`;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}`;
}

export class GameConnection {
  private ws: WebSocket | null = null;
  private queue: ClientMessage[] = [];

  constructor(
    private readonly url: string = defaultServerUrl(),
    private readonly onMessage: ServerHandler,
    private readonly onStatus: (open: boolean) => void = () => {},
  ) {}

  connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.onStatus(true);
      for (const m of this.queue) ws.send(JSON.stringify(m));
      this.queue = [];
    };
    ws.onclose = () => {
      this.onStatus(false);
      setTimeout(() => this.connect(), 1000);
    };
    ws.onmessage = (ev) => {
      try {
        this.onMessage(JSON.parse(String(ev.data)) as ServerMessage);
      } catch {
        /* ignore malformed */
      }
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }
}
