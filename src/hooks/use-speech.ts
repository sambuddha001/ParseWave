import { useEffect, useRef, useState } from "react";

export type NarrationState = "idle" | "playing" | "paused";

/** Rough speaking pace for time estimates (~150 wpm ≈ 15 chars/s). */
export const CHARS_PER_SECOND = 15;

const RATE_KEY = "aw:rate";
const VOICE_KEY = "aw:voice";

const clampRate = (value: number) => Math.min(2, Math.max(0.5, value));

function loadRate(): number {
  const raw = localStorage.getItem(RATE_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? clampRate(parsed) : 1;
}

/**
 * Heuristically pick the warmest, highest-quality English voice available.
 * Network/neural voices rank first; known-robotic engines rank last so we
 * never default to them.
 */
export function pickDefaultVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | undefined {
  if (voices.length === 0) return undefined;
  const warmNames = [
    "aria",
    "jenny",
    "sonia",
    "libby",
    "samantha",
    "serena",
    "karen",
    "moira",
    "tessa",
    "ava",
    "allison",
    "zira",
  ];
  const score = (voice: SpeechSynthesisVoice) => {
    const name = voice.name.toLowerCase();
    let points = 0;
    if (voice.lang?.toLowerCase().startsWith("en")) points += 4;
    if (/natural|neural|premium|enhanced|wavenet|studio|journey/.test(name))
      points += 6;
    if (name.includes("google")) points += 5; // Chrome's network voices sound best
    if (name.includes("microsoft") && name.includes("online")) points += 4;
    if (warmNames.some((warm) => name.includes(warm))) points += 2;
    if (voice.localService) points += 1;
    if (/espeak|pico|festival|eloquence|freetts/.test(name)) points -= 10;
    else if (name.includes("compact")) points -= 3;
    return points;
  };
  return [...voices].sort((a, b) => score(b) - score(a))[0];
}

/** Snap an offset back to the start of the nearest word. */
function alignToWordStart(text: string, offset: number): number {
  if (offset <= 0 || offset >= text.length) return 0;
  for (let i = Math.min(offset, text.length - 1); i > 0; i--) {
    const prev = text[i - 1];
    const cur = text[i];
    if (/\s/.test(prev) && !/\s/.test(cur)) return i;
  }
  return 0;
}

export interface NarratorApi {
  supported: boolean;
  state: NarrationState;
  index: number;
  /** Character offset of the spoken word inside the current part. */
  charIndex: number;
  rate: number;
  voiceURI: string;
  voices: SpeechSynthesisVoice[];
  /** Human-readable description of the last fatal engine error, if any. */
  error: string | null;
  play: (from?: number) => void;
  toggle: () => void;
  pause: () => void;
  stop: () => void;
  goTo: (index: number) => void;
  next: () => void;
  prev: () => void;
  setRate: (rate: number) => void;
  setVoice: (voiceURI: string) => void;
}

export interface NarratorOptions {
  /** Called once when the final part finishes playing naturally. */
  onFinish?: () => void;
}

/**
 * Drives the browser's built-in speech engine (Web Speech API) across a
 * list of narration parts — no server, no API keys, no usage limits.
 *
 * Reliability rules baked in:
 * - Parts are large and chained seamlessly, so the book reads as one
 *   continuous narration instead of staccato chunks.
 * - Pause is implemented with `cancel()` plus a word-boundary position:
 *   `synth.pause()` is a silent no-op on several engines (notably Chrome
 *   with remote voices), while cancel is honored everywhere.
 * - The first `speak()` happens synchronously inside the user gesture
 *   (Safari and iOS refuse speech deferred past the gesture).
 * - A watchdog recovers when the engine stalls silently, resuming from the
 *   last spoken word instead of restarting the part. It only intervenes
 *   after sustained silence, so part-to-part chaining never gets re-spoken.
 * - A synthesis failure retries the same voice once (transient hiccups are
 *   common), then switches to a different voice before showing an error.
 */
export function useNarrator(
  segments: string[],
  initialIndex = 0,
  options: NarratorOptions = {},
): NarratorApi {
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const [state, setState] = useState<NarrationState>("idle");
  const [index, setIndex] = useState(initialIndex);
  const [charIndex, setCharIndex] = useState(0);
  const [rate, setRate] = useState(loadRate);
  const [voiceURI, setVoiceURI] = useState(
    () => localStorage.getItem(VOICE_KEY) ?? "",
  );
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [error, setError] = useState<string | null>(null);

  // The refs are the engine's source of truth, updated at every transition
  // point so async utterance callbacks never act on stale values.
  const segmentsRef = useRef(segments);
  const stateRef = useRef<NarrationState>("idle");
  const indexRef = useRef(initialIndex);
  const charIndexRef = useRef(0);
  const rateRef = useRef(rate);
  const voiceRef = useRef(voiceURI);
  const generationRef = useRef(0);
  const recoveryRef = useRef(0);
  const fallbackRef = useRef(0);
  const boundaryFiredRef = useRef(false);
  const lastProgressAtRef = useRef(0);
  const lastBoundaryAtRef = useRef(0);
  const lastResumeAtRef = useRef(0);
  const resumedRef = useRef(false);
  const onFinishRef = useRef(options.onFinish);

  useEffect(() => {
    onFinishRef.current = options.onFinish;
  });

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  useEffect(() => {
    voiceRef.current = voiceURI;
  }, [voiceURI]);

  // Voice lists load asynchronously in most browsers.
  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const load = () => {
      const list = synth.getVoices();
      if (list.length === 0) return;
      setVoices(list);
      // Drop a saved voice that no longer exists in this browser so a stale
      // URI can never silence playback.
      setVoiceURI((current) =>
        current && list.some((v) => v.voiceURI === current)
          ? current
          : (pickDefaultVoice(list)?.voiceURI ?? ""),
      );
    };
    load();
    synth.addEventListener("voiceschanged", load);
    const timer = window.setTimeout(load, 250);
    return () => {
      synth.removeEventListener("voiceschanged", load);
      window.clearTimeout(timer);
    };
  }, [supported]);

  // Never leave narration running after the player goes away.
  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    return () => {
      generationRef.current += 1;
      synth.cancel();
    };
  }, [supported]);

  // Watchdog — two jobs, both triggered only on genuine stalls so normal
  // narration is never interrupted:
  //  1. Chrome freezes on long utterances: the engine keeps reporting
  //     "speaking" but stops producing boundary events. A single resume()
  //     after a stall (not a per-tick heartbeat — that churn stutters audio)
  //     kick-starts it.
  //  2. True silence while "playing": after sustained misses, re-speak from
  //     the last known position.
  useEffect(() => {
    if (!supported) return;
    const watchdog = window.setInterval(() => {
      if (stateRef.current !== "playing") return;
      const synth = window.speechSynthesis;
      if (synth.speaking || synth.pending) {
        // Chrome long-utterance freeze: speaking but no boundary for ~4s.
        const stalled =
          synth.speaking &&
          lastBoundaryAtRef.current > 0 &&
          Date.now() - lastBoundaryAtRef.current > 4000 &&
          Date.now() - lastResumeAtRef.current > 4000;
        if (stalled) {
          lastResumeAtRef.current = Date.now();
          synth.resume();
        }
        // Engines without boundary events: estimate the reading position so
        // captions and the progress bar still move.
        if (
          !boundaryFiredRef.current &&
          lastProgressAtRef.current > 0 &&
          !resumedRef.current
        ) {
          const part = segmentsRef.current[indexRef.current] ?? "";
          const seconds = (Date.now() - lastProgressAtRef.current) / 1000;
          const estimated = Math.floor(
            seconds * CHARS_PER_SECOND * rateRef.current,
          );
          const capped = Math.max(
            charIndexRef.current,
            Math.min(part.length - 1, estimated),
          );
          if (capped > charIndexRef.current) {
            charIndexRef.current = capped;
            setCharIndex(capped);
          }
        }
        return;
      }
      // Engine is silent while we expect audio: count consecutive misses.
      // (A brief part-to-part gap is fine — we only act after ~3.6s.)
      recoveryRef.current += 1;
      if (recoveryRef.current >= 3) {
        recoveryRef.current = 0;
        resumedRef.current = true; // watchdog re-speaks must not estimate
        speakFrom(indexRef.current, {
          fromWatchdog: true,
          startOffset: charIndexRef.current,
        });
      }
    }, 1200);
    return () => window.clearInterval(watchdog);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  function setEngineState(next: NarrationState, nextIndex?: number) {
    stateRef.current = next;
    setState(next);
    if (nextIndex !== undefined) {
      indexRef.current = nextIndex;
      setIndex(nextIndex);
    }
  }

  /** Speak part `from`, then chain onward. Re-invocations supersede safely. */
  function speakFrom(
    from: number,
    opts: { fromWatchdog?: boolean; startOffset?: number } = {},
  ) {
    if (!supported) return;
    const synth = window.speechSynthesis;
    if (!opts.fromWatchdog) {
      recoveryRef.current = 0;
      fallbackRef.current = 0;
    }
    const generation = ++generationRef.current;

    const segment = segmentsRef.current[from];
    if (segment === undefined) {
      const lastIndex = Math.max(0, segmentsRef.current.length - 1);
      setEngineState("idle", lastIndex);
      return;
    }

    // Resume mid-part from the last spoken word when asked to.
    const startOffset =
      opts.startOffset && opts.startOffset > 0
        ? alignToWordStart(segment, opts.startOffset)
        : 0;
    const text = startOffset > 0 ? segment.slice(startOffset) : segment;
    charIndexRef.current = startOffset;
    setCharIndex(startOffset);

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = synth
      .getVoices()
      .find((candidate) => candidate.voiceURI === voiceRef.current);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = "en-US";
    }
    utterance.rate = clampRate(rateRef.current);
    utterance.volume = 1;

    utterance.onstart = () => {
      if (generation !== generationRef.current) return;
      recoveryRef.current = 0;
      fallbackRef.current = 0;
      setError(null);
    };
    utterance.onboundary = (event) => {
      if (generation !== generationRef.current) return;
      boundaryFiredRef.current = true;
      lastProgressAtRef.current = Date.now();
      lastBoundaryAtRef.current = Date.now();
      const pos = startOffset + (event.charIndex ?? 0);
      charIndexRef.current = pos;
      setCharIndex(pos);
    };
    utterance.onend = () => {
      if (generation !== generationRef.current || stateRef.current !== "playing")
        return;
      const nextIndex = from + 1;
      if (nextIndex < segmentsRef.current.length) {
        speakFrom(nextIndex);
      } else {
        setEngineState("idle", from);
        onFinishRef.current?.();
      }
    };
    utterance.onerror = (event) => {
      // Replacing the queue reports the old utterance as interrupted — expected.
      // (String cast: Chrome emits codes like "synthesis-failed" that the DOM
      // lib's SpeechSynthesisErrorCode union doesn't include.)
      const code = String(event.error);
      if (code === "interrupted" || code === "canceled") return;
      if (generation !== generationRef.current) return;

      // Stage 1: transient engine hiccups are common — same voice, one retry.
      if (code === "synthesis-failed" && fallbackRef.current === 0) {
        fallbackRef.current = 1;
        speakFrom(from, { fromWatchdog: true, startOffset });
        return;
      }
      // Stage 2: the voice itself may be broken — switch to another.
      const retriable =
        code === "synthesis-failed" ||
        code === "audio-capture" ||
        code === "voice-unavailable" ||
        code === "language-unavailable" ||
        code === "network";
      if (retriable && fallbackRef.current < 2) {
        fallbackRef.current = 2;
        const failedURI = voiceRef.current;
        const list = synth.getVoices();
        const alternative =
          pickDefaultVoice(list.filter((v) => v.voiceURI !== failedURI))
            ?.voiceURI ?? "";
        voiceRef.current = alternative;
        setVoiceURI(alternative);
        speakFrom(from, { fromWatchdog: true, startOffset });
        return;
      }

      setEngineState("idle");
      setError(
        code === "not-allowed"
          ? "The browser blocked speech audio. Press play once more, or open the app in its own browser tab."
          : code === "synthesis-failed" || code === "synthesis-unavailable"
            ? "Your browser's speech engine couldn't produce audio. Preview frames often block it — open this app in its own browser tab (Chrome, Edge, or Safari) and press play."
            : `Speech engine error: ${code}`,
      );
    };

    setEngineState("playing", from);

    const beginSpeaking = () => {
      speakingSinceReset();
      synth.speak(utterance);
    };

    if (synth.speaking || synth.pending || synth.paused) {
      // Something is queued: cancel it first, then speak on the next tick so
      // the fresh utterance isn't swallowed by the cancel. This path never
      // runs as the first user action, so Safari's gesture rule still holds.
      synth.cancel();
      window.setTimeout(() => {
        if (generation !== generationRef.current || stateRef.current !== "playing")
          return;
        beginSpeaking();
      }, 60);
    } else {
      // Engine is idle (first play, or the previous part just ended):
      // speak synchronously for maximum reliability.
      beginSpeaking();
    }
  }

  /** Record the moment audio (re)started for watchdog/estimation purposes. */
  function speakingSinceReset() {
    boundaryFiredRef.current = false;
    resumedRef.current = false;
    lastProgressAtRef.current = Date.now();
    lastBoundaryAtRef.current = Date.now();
  }

  function play(from?: number) {
    speakFrom(from ?? indexRef.current);
  }

  function pause() {
    if (!supported || stateRef.current !== "playing") return;
    // synth.pause() is a silent no-op on several engines (notably Chrome with
    // its remote voices), which made pause feel dead. Cancel is the one
    // control every engine honors — and the last word-boundary position
    // lets us resume exactly mid-part.
    generationRef.current += 1;
    window.speechSynthesis.cancel();
    setEngineState("paused");
  }

  function toggle() {
    if (!supported) return;
    if (stateRef.current === "playing") {
      pause();
      return;
    }
    // Resume from the last spoken word (falls back to the part start when
    // the engine gave us no boundary events near the end).
    const part = segmentsRef.current[indexRef.current] ?? "";
    const resumeAt =
      charIndexRef.current > 0 && charIndexRef.current < part.length - 2
        ? charIndexRef.current
        : 0;
    speakFrom(indexRef.current, { startOffset: resumeAt });
  }

  function stop() {
    if (!supported) return;
    generationRef.current += 1;
    window.speechSynthesis.cancel();
    recoveryRef.current = 0;
    setError(null);
    setEngineState("idle");
  }

  function goTo(target: number) {
    const clamped = Math.max(
      0,
      Math.min(segmentsRef.current.length - 1, target),
    );
    if (stateRef.current === "playing") {
      speakFrom(clamped);
    } else {
      // Idle or paused: just move the cursor to the new part.
      setEngineState(stateRef.current, clamped);
      charIndexRef.current = 0;
      setCharIndex(0);
    }
  }

  function next() {
    goTo(indexRef.current + 1);
  }

  function prev() {
    goTo(indexRef.current - 1);
  }

  function updateRate(next: number) {
    const clamped = clampRate(next);
    localStorage.setItem(RATE_KEY, String(clamped));
    setRate(clamped);
    rateRef.current = clamped;
    // Re-speak from the current word so the change applies instantly.
    if (stateRef.current === "playing") {
      speakFrom(indexRef.current, { startOffset: charIndexRef.current });
    }
  }

  function updateVoice(next: string) {
    if (!next) return;
    localStorage.setItem(VOICE_KEY, next);
    setVoiceURI(next);
    voiceRef.current = next;
    if (stateRef.current === "playing") {
      speakFrom(indexRef.current, { startOffset: charIndexRef.current });
    }
  }

  return {
    supported,
    state,
    index,
    charIndex,
    rate,
    voiceURI,
    voices,
    error,
    play,
    toggle,
    pause,
    stop,
    goTo,
    next,
    prev,
    setRate: updateRate,
    setVoice: updateVoice,
  };
}
