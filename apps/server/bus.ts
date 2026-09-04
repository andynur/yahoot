import type { Server, ServerWebSocket } from "bun";
import type { ServerToClient } from "@shared/protocol";
import type { SocketData } from "./socket";

/**
 * Thin wrapper over Bun's native WebSocket pub/sub. The engine talks to clients
 * only through here, so every outbound message is typed against the shared
 * protocol and nothing is hand-serialized at call sites.
 *
 * Topics:
 *   <pin>            — public game events (everyone in the room, host + players)
 *   host:<pin>       — host-screen-only events (players don't render them)
 *   player:<id>      — private events for one player's socket(s)
 *
 * Use `host:<pin>` for anything only the projector shows. Per-answer messages on
 * the public topic are O(players²) fan-out during the burst — 200 answers to 200
 * subscribers is 40k frames per question, all but one of them discarded.
 */
let server: Server<SocketData> | null = null;

export function bindServer(s: Server<SocketData>): void {
  server = s;
}

export function publish(topic: string, message: ServerToClient): void {
  server?.publish(topic, JSON.stringify(message));
}

export function send(
  ws: ServerWebSocket<SocketData>,
  message: ServerToClient,
): void {
  ws.send(JSON.stringify(message));
}

export const playerTopic = (playerId: string): string => `player:${playerId}`;
export const hostTopic = (pin: string): string => `host:${pin}`;
