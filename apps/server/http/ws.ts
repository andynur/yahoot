/**
 * WebSocket endpoint. Connect to `/ws?pin=<PIN>&role=player`
 * or `/ws?pin=<PIN>&role=host&token=<JWT>`.
 *
 * The PIN comes in at upgrade time so `open` can subscribe immediately (native
 * Bun pub/sub, topic = PIN). Every inbound frame is validated against the shared
 * Zod union before it reaches the engine — nothing untyped gets through.
 */
import type { ServerWebSocket, WebSocketHandler } from "bun";
import {
  normalizePin,
  parseClientMessage,
  type ClientToServer,
} from "@shared/protocol";
import { verifyTeacherToken } from "../auth/jwt";
import { hostTopic, playerTopic, send } from "../bus";
import * as engine from "../game/engine";
import type { SocketData } from "../socket";

const fail = (ws: ServerWebSocket<SocketData>, message: string) =>
  send(ws, { type: "ERROR", message });

export type { SocketData };

export async function handleUpgrade(
  req: Request,
  server: Bun.Server<SocketData>,
): Promise<Response | undefined> {
  const url = new URL(req.url);
  // The PIN is shown grouped ("142 001"); accept it however it was typed.
  const pin = normalizePin(url.searchParams.get("pin") ?? "");
  const role = url.searchParams.get("role") === "host" ? "host" : "player";
  if (!pin) return new Response("missing pin", { status: 400 });

  let teacherId: string | null = null;
  if (role === "host") {
    teacherId = await verifyTeacherToken(url.searchParams.get("token"));
    if (!teacherId) return new Response("unauthorized", { status: 401 });
  }

  const data: SocketData = { pin, role, playerId: null, teacherId };
  return server.upgrade(req, { data })
    ? undefined
    : new Response("expected a websocket upgrade", { status: 426 });
}

function requireHost(ws: ServerWebSocket<SocketData>): boolean {
  return ws.data.role === "host" && ws.data.teacherId !== null;
}

async function dispatch(
  ws: ServerWebSocket<SocketData>,
  msg: ClientToServer,
): Promise<void> {
  const { pin } = ws.data;

  switch (msg.type) {
    case "PLAYER_JOIN": {
      const result = await engine.playerJoin(pin, msg.nickname, msg.avatar);
      if ("error" in result) {
        fail(ws, result.error);
        return;
      }
      ws.data.playerId = result.playerId;
      ws.subscribe(playerTopic(result.playerId));
      await engine.sendSnapshot(ws, pin, result.playerId);
      return;
    }

    case "PLAYER_REJOIN": {
      if (await engine.playerRejoin(pin, msg.playerId)) {
        ws.data.playerId = msg.playerId;
        ws.subscribe(playerTopic(msg.playerId));
        await engine.sendSnapshot(ws, pin, msg.playerId);
      } else {
        fail(ws, "unknown player — rejoin failed");
      }
      return;
    }

    case "PLAYER_ANSWER": {
      const receivedAt = Date.now(); // server clock is the only authority
      if (!ws.data.playerId) {
        fail(ws, "join before answering");
        return;
      }
      await engine.handleAnswer(
        ws,
        pin,
        ws.data.playerId,
        msg.questionId,
        msg.choiceIndex,
        receivedAt,
      );
      return;
    }

    case "PLAYER_REACT": {
      if (!ws.data.playerId) return;
      await engine.playerReact(pin, ws.data.playerId, msg.emoji);
      return;
    }

    case "HOST_START_QUESTION": {
      if (!requireHost(ws)) return;
      await engine.hostStartQuestion(pin);
      return;
    }

    case "HOST_NEXT": {
      if (!requireHost(ws)) return;
      await engine.hostNext(pin);
      return;
    }
  }
}

export const websocket: WebSocketHandler<SocketData> = {
  /**
   * Limits, tuned for a classroom of phones rather than Bun's generous defaults.
   *
   * `maxPayloadLength` caps what a *client* may send us. Every message in
   * ClientToServer is a few hundred bytes at most (the largest is a nickname
   * plus a PIN), so 16 KB is enormous headroom — and it stops one student's
   * console from making the server buffer Bun's default 16 MB.
   *
   * `idleTimeout` is what retires a dead socket. Bun sends ping frames on its
   * own (`sendPings` defaults to true), so a phone that is merely sitting on the
   * lock screen keeps answering pongs and stays connected; the timer only runs
   * out when the device is genuinely gone — walked out of wifi range, killed the
   * browser, switched to mobile data. 60 s means the host's player count
   * corrects itself within a question instead of within two minutes.
   *
   * `closeOnBackpressureLimit` matters on school wifi: a phone too slow to drain
   * what we publish would otherwise accumulate frames in server memory for the
   * whole game. Dropping it is right — it reconnects and gets a fresh
   * STATE_SNAPSHOT, which is more correct than a backlog of stale ones.
   */
  maxPayloadLength: 16 * 1024,
  idleTimeout: 60,
  backpressureLimit: 1024 * 1024,
  closeOnBackpressureLimit: true,

  open(ws) {
    ws.subscribe(ws.data.pin);
    if (ws.data.role === "host") ws.subscribe(hostTopic(ws.data.pin));
    void engine.sendSnapshot(ws, ws.data.pin, ws.data.playerId);
  },
  async message(ws, raw) {
    const msg = parseClientMessage(
      typeof raw === "string" ? raw : raw.toString(),
    );
    if (!msg) {
      fail(ws, "malformed or unknown message");
      return;
    }
    await dispatch(ws, msg);
  },
  close(ws) {
    ws.unsubscribe(ws.data.pin);
    if (ws.data.role === "host") ws.unsubscribe(hostTopic(ws.data.pin));
    if (ws.data.playerId) ws.unsubscribe(playerTopic(ws.data.playerId));
  },
};
