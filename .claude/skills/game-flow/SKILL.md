---
name: game-flow
description: The authoritative game state machine, timer, and scoring rules. Load whenever editing the game engine, question timing, scoring, or leaderboard logic.
---

# Game flow

## The state machine (`apps/server/game/machine.ts` — pure, tested)

```
LOBBY ──HOST_START_QUESTION──▶ QUESTION_ACTIVE
QUESTION_ACTIVE ──LOCK──▶ ANSWERS_LOCKED          (LOCK = timer expired OR everyone answered)
ANSWERS_LOCKED ──SCORED──▶ REVEAL                 (SCORED = server finished computeScore for all)
REVEAL ──HOST_NEXT──▶ LEADERBOARD
LEADERBOARD ──HOST_START_QUESTION──▶ QUESTION_ACTIVE   (next question, if any)
LEADERBOARD ──HOST_NEXT──▶ ENDED
```

`transition(state, event, ctx)` returns the next `{ state, questionIndex }` or
`null` for an illegal event. It does no I/O. The orchestration lives in
`apps/server/game/engine.ts`, which loads the snapshot from `state/store.ts`,
checks the precondition state, applies the transition, saves, and publishes.

**Every transition is server-driven.** The client never advances anything; it
renders whatever `STATE_SNAPSHOT` / the event stream says.

## Timer — the server owns the clock

`hostStartQuestion` sets `askedAt = Date.now()` and
`deadline = askedAt + timeLimitSeconds * 1000` on the snapshot, then schedules a
server-side `setTimeout` to `lockAndScore` at the deadline. The timer map is
process memory, but it is **rebuilt from the stored deadlines on boot**
(`engine.rehydrate()`), so a restart mid-question still closes it on time. The
authoritative deadline is the one in the stored snapshot.

`QUESTION_SHOWN` sends the absolute `deadline`. The client countdown is cosmetic.

## Scoring — server only, via the pure function

`packages/shared/scoring.ts`:
`computeScore({ correct, askedAt, deadline, answeredAt, maxPoints })`.

- Wrong answer → 0.
- `answeredAt >= deadline` → 0 (late).
- Correct → at least half of `maxPoints`, plus up to half more scaled by how much
  of the question window was still left. Instant correct = full `maxPoints`.

`answeredAt` is **the server's receive time** (`Date.now()` in the WS message
handler), never a client-supplied timestamp. `askedAt` was added to the init
sketch's signature because "time remaining" is only a fraction once you know the
window it sits in.

## Where state lives

- During play: the **`live_*` tables only** (`state/store.ts`) — `live_games`
  holds the snapshot, with `live_players` / `live_answers` / `live_scores` /
  `live_log` / `live_prev_ranks` / `live_active` alongside it. `bun:sqlite` is
  synchronous, so a read-check-write inside one store function cannot interleave
  with another request; answers are `insert or ignore` (write-once) and scores
  are a single `update … set score = score + ?`.
- Closing a question is claimed via `live_scored (pin, question_index)` — an
  `insert or ignore` on a primary key, so exactly one caller scores the room.
  See rule 3 in CLAUDE.md; this is not decoration.
- On game end: `engine.endGame` writes `game_results` + flips `game_sessions`
  to `ended` in **one transaction**, publishes `GAME_ENDED`, then purges the
  `live_*` rows. That is the only time game data reaches the durable tables.

## Anti-cheat rationale — do not "optimise away"

The client is untrusted. If timing or scoring moved client-side, or the deadline
check were dropped, a student could freeze their clock or replay a correct answer
after the reveal and top the leaderboard. Late answers are rejected on the server
(`handleAnswer`: state must be `QUESTION_ACTIVE` and `receivedAt < deadline`),
and score is computed only in `lockAndScore` from server timestamps.
