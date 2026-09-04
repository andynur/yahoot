/**
 * Game audio, synthesised in the browser with Web Audio oscillators.
 *
 * No audio files: nothing to download, nothing to bundle, and it works offline.
 * Every cue is a short envelope over one or two oscillators.
 *
 * Autoplay policy: an AudioContext starts *suspended* until a real user gesture.
 * `unlock()` is wired to the first pointer/key event and to the buttons that
 * begin a game, so by the time a question opens the context is already running.
 * Never construct the context at module load — Safari counts that against you.
 */

const STORAGE_KEY = "yahoot:sound";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = readPreference();
let lobbyTimer: ReturnType<typeof setInterval> | null = null;

function readPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true; // private mode / blocked storage — default to sound on
  }
}

function ensure(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.28; // headroom — these are background cues, not music
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call from any user gesture. Safe to call repeatedly. */
export function unlock(): void {
  ensure();
}

export function isSoundOn(): boolean {
  return enabled;
}

export function setSoundOn(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* storage blocked — the setting just won't persist */
  }
  if (!on) {
    stopLobbyLoop();
    if (master) master.gain.value = 0;
  } else if (master) {
    master.gain.value = 0.28;
    ensure();
  }
}

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

interface ToneOptions {
  freq: number;
  /** seconds from now */
  at?: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  /** glide to this frequency over the note's length */
  slideTo?: number;
}

function tone({
  freq,
  at = 0,
  dur = 0.18,
  type = "triangle",
  gain = 0.6,
  slideTo,
}: ToneOptions): void {
  const c = ensure();
  if (!c || !master) return;

  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const env = c.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);

  // short attack, exponential decay — a click-free "blip"
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(env);
  env.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Filtered white noise — used for whooshes and the confetti pop. */
function noise(dur = 0.3, gain = 0.35, sweepFrom = 1200, sweepTo = 200): void {
  const c = ensure();
  if (!c || !master) return;

  const t0 = c.currentTime;
  const frames = Math.floor(c.sampleRate * dur);
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const src = c.createBufferSource();
  src.buffer = buffer;

  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(sweepFrom, t0);
  filter.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);

  const env = c.createGain();
  env.gain.setValueAtTime(gain, t0);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(filter);
  filter.connect(env);
  env.connect(master);
  src.start(t0);
}

/** Play a sequence of [frequency, startOffset, duration] notes. */
function melody(
  notes: Array<[number, number, number?]>,
  type: OscillatorType = "triangle",
  gain = 0.55,
): void {
  for (const [freq, at, dur] of notes) {
    tone({ freq, at, dur: dur ?? 0.16, type, gain });
  }
}

// Equal-temperament note table (only what the cues use).
const N = {
  C4: 261.63,
  E4: 329.63,
  G4: 392.0,
  A4: 440.0,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  A5: 880.0,
  C6: 1046.5,
  E6: 1318.51,
  Eb4: 311.13,
  Gb4: 369.99,
  Bb3: 233.08,
  F3: 174.61,
} as const;

// ---------------------------------------------------------------------------
// cues
// ---------------------------------------------------------------------------

export const sfx = {
  /** A player's name pops into the lobby. */
  join: () => tone({ freq: N.E5, dur: 0.1, type: "sine", gain: 0.4 }),

  /** A question opens. */
  questionStart: () => {
    noise(0.35, 0.22, 300, 2000);
    melody(
      [
        [N.C5, 0.05, 0.12],
        [N.E5, 0.15, 0.12],
        [N.G5, 0.25, 0.2],
      ],
      "triangle",
      0.5,
    );
  },

  /** One second of the final countdown. `urgency` 0→1 raises the pitch. */
  tick: (urgency: number) =>
    tone({
      freq: 660 + urgency * 340,
      dur: 0.07,
      type: "square",
      gain: 0.18 + urgency * 0.18,
    }),

  /** Player taps an answer shape. */
  pick: () => tone({ freq: N.A4, dur: 0.06, type: "square", gain: 0.3 }),

  /** The server accepted it. */
  locked: () => {
    tone({ freq: N.E5, dur: 0.09, type: "sine", gain: 0.35 });
    tone({ freq: N.A5, at: 0.08, dur: 0.12, type: "sine", gain: 0.3 });
  },

  /** Host: answers close, bars are about to fill in. */
  reveal: () => noise(0.5, 0.28, 1800, 160),

  correct: () =>
    melody(
      [
        [N.C5, 0, 0.12],
        [N.E5, 0.1, 0.12],
        [N.G5, 0.2, 0.12],
        [N.C6, 0.3, 0.34],
      ],
      "triangle",
      0.6,
    ),

  wrong: () =>
    melody(
      [
        [N.Gb4, 0, 0.18],
        [N.Eb4, 0.14, 0.18],
        [N.Bb3, 0.28, 0.36],
      ],
      "sawtooth",
      0.32,
    ),

  /** Scoreboard slides in. */
  leaderboard: () => {
    noise(0.4, 0.18, 400, 1600);
    melody(
      [
        [N.G4, 0.08, 0.14],
        [N.C5, 0.18, 0.14],
        [N.E5, 0.28, 0.24],
      ],
      "sine",
      0.4,
    );
  },

  /** Game over — plays under the confetti. */
  fanfare: () => {
    melody(
      [
        [N.C5, 0, 0.14],
        [N.E5, 0.13, 0.14],
        [N.G5, 0.26, 0.14],
        [N.C6, 0.39, 0.18],
        [N.G5, 0.58, 0.14],
        [N.C6, 0.71, 0.5],
        [N.E6, 0.71, 0.5],
      ],
      "triangle",
      0.5,
    );
    // low root under the chord for weight
    tone({ freq: N.F3, at: 0.71, dur: 0.6, type: "sine", gain: 0.4 });
    noise(0.7, 0.16, 2200, 400);
  },

  /** Confetti burst. */
  pop: () => {
    noise(0.22, 0.3, 2600, 500);
    tone({ freq: N.C6, dur: 0.1, type: "sine", gain: 0.3 });
  },
};

// ---------------------------------------------------------------------------
// lobby bed — a slow two-note pulse so the projector isn't silent
// ---------------------------------------------------------------------------

export function startLobbyLoop(): void {
  if (lobbyTimer || !enabled) return;
  let step = 0;
  const beat = () => {
    const pattern = [N.C4, N.G4, N.E4, N.G4];
    tone({
      freq: pattern[step % pattern.length]!,
      dur: 0.5,
      type: "sine",
      gain: 0.16,
    });
    step++;
  };
  beat();
  lobbyTimer = setInterval(beat, 900);
}

export function stopLobbyLoop(): void {
  if (lobbyTimer) {
    clearInterval(lobbyTimer);
    lobbyTimer = null;
  }
}

// First gesture anywhere unlocks audio for the rest of the session.
if (typeof window !== "undefined") {
  const once = () => {
    unlock();
    window.removeEventListener("pointerdown", once);
    window.removeEventListener("keydown", once);
  };
  window.addEventListener("pointerdown", once, { once: true });
  window.addEventListener("keydown", once, { once: true });
}
