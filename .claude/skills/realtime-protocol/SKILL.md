---
name: realtime-protocol
description: How to add or change any WebSocket message. Load whenever a new client↔server event is needed or an existing one changes.
---

# Real-time protocol

Every WebSocket message is a Zod schema in `packages/shared/protocol.ts`, in one
of two discriminated unions — `ClientToServer` or `ServerToClient` — imported by
both apps. There is **no** untyped `ws.send(JSON.stringify({ ... }))` anywhere;
both sides serialise/parse through the shared helpers.

## The order to add a message — always this order

1. **`packages/shared/protocol.ts`** — define the schema, add it to the right
   union, export its inferred type.
2. **Server** — handle it (client→server) or publish it (server→client).
3. **Web** — send it or react to it.

Editing the protocol first means TypeScript then points you at every call site
that must change. Don't touch an app before the schema.

## Adding a client→server message (sketch: `PLAYER_BUZZ`)

`PLAYER_REACT` / `REACTION` are already implemented the same way — read those
for a real end-to-end example (protocol → `engine.playerReact` → `useGameSocket`
reducer → `components/Reactions.tsx`).

```ts
// 1. packages/shared/protocol.ts
export const PlayerBuzz = z.object({
  type: z.literal("PLAYER_BUZZ"),
});
export const ClientToServer = z.discriminatedUnion("type", [
  PlayerJoin, PlayerRejoin, PlayerAnswer, HostStartQuestion, HostNext, PlayerReact,
  PlayerBuzz,                // <-- add here
]);
export type PlayerBuzz = z.infer<typeof PlayerBuzz>;
```

```ts
// 2. apps/server/http/ws.ts — dispatch() switch
case "PLAYER_BUZZ":
  if (!ws.data.playerId) return;
  await engine.playerBuzz(ws.data.pin, ws.data.playerId);
  return;
```

```ts
// 3. apps/web — send it
game.send({ type: "PLAYER_BUZZ" });
```

## Adding a server→client message

Define the schema + add to `ServerToClient` + export the type, then publish it
through `apps/server/bus.ts` (`publish(topic, msg)` / `send(ws, msg)` — both
typed `ServerToClient`), then handle it in the `reducer` in
`apps/web/src/useGameSocket.ts`.

## Non-negotiables

- **Server handlers must `safeParse`.** Inbound frames go through
  `parseClientMessage(raw)` (returns `null` on malformed/unknown) — reject nulls,
  never trust the shape.
- Pick the topic deliberately: `<pin>` = public (everyone), `host:<pin>` = the
  projector only, `player:<id>` = private. A message type belongs to exactly one
  topic. Anything published **per answer** must not go on `<pin>` — with 200
  players that is 200 × 200 = 40k frames per question, and the load test showed
  moving `ANSWER_COUNT` to `host:<pin>` cut p95 round-trip from 36 ms to 30 ms
  and max fan-out from 17 ms to 7 ms.
- `QUESTION_SHOWN` carries an absolute `deadline` (epoch ms). Never send a
  duration or a "seconds left" — the client derives the cosmetic countdown.
- Never put the correct answer in a player-facing message. `QUESTION_SHOWN` has
  choice text only; `correctIndex` first appears in `QUESTION_CLOSED` at reveal.

## Socket limits (set in `http/ws.ts`)

Bun's defaults are sized for the open internet, not a classroom:

| Option | Ours | Bun default | Why |
|---|---|---|---|
| `maxPayloadLength` | 16 KB | 16 MB | Caps **inbound** only — verified, an outbound 40 KB frame passes fine. Our largest client message is a few hundred bytes; a 150-player `LEADERBOARD` going *out* is ~19 KB and is unaffected. |
| `idleTimeout` | 60 s | 120 s | `sendPings` is on by default, so a phone on the lock screen still answers pongs and stays connected. This only fires for a device that is really gone, and halves how long a ghost sits in the player count. |
| `backpressureLimit` | 1 MB | 16 MB | A phone too slow to drain would otherwise buffer frames in server memory all game. |
| `closeOnBackpressureLimit` | true | false | Dropping it is correct — it reconnects and gets a fresh `STATE_SNAPSHOT`, which beats a backlog of stale ones. |

If the leaderboard ever grows past ~16 KB *inbound* (it cannot today — clients
never send it), revisit `maxPayloadLength` before assuming a client bug.
