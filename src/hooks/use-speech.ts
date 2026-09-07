import { useEffect, useRef, useState } from "react";

export type NarrationState = "idle" | "playing" | "paused";

const RATE_KEY = "aw:rate";
const VOICE_KEY = "aw:voice";

const clampRate = (value: number) => Math.min(2, Math.max(0.5, value));

function loadRate(): number {
  const raw = localStorage.getItem(RATE_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? clampRate(parsed) : 1;
}

/** Heuristically pick the warmest, most expressive English voice available. */
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
    if (/natural|neural|premium|enhanced/.test(name)) points += 3;
    if (name.includes("google")) points += 2;
    if (warmNames.some((warm) => name.includes(warm))) points += 2;
    if (voice.localService) points += 1;
    return points;
  };
  return [...voices].sort((a, b) => score(b) - score(a))[0];
}

export interface NarratorApi {
  supported: boolean;
  state: NarrationState;
  index: number;
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

/**
 * Drives the browser's built-in speech engine (Web Speech API) across a
 * list of narration segments — no server, no API keys, no usage limits.
 *
 * Reliability rules baked in:
 * - The very first `speak()` happens synchronously inside the user gesture
 *   (Safari and iOS refuse speech that is deferred past the gesture).
 * - `cancel()` is only called when something is actually queued, because
 *   Chrome can silently swallow an utterance spoken in the same tick as an
 *   unconditional cancel.
 * - A watchdog recovers when the engine accepts an utterance but never plays
 *   it, and a heartbeat nudges Chrome's long-utterance freeze.
 */
export function useNarrator(segments: string[], initialIndex = 0): NarratorApi {
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const [state, setState] = useState<NarrationState>("idle");
  const [index, setIndex] = useState(initialIndex);
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
  const rateRef = useRef(rate);
  const voiceRef = useRef(voiceURI);
  const generationRef = useRef(0);
  const recoveryRef = useRef(0);

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

  // Heartbeat + silence watchdog. Chrome sometimes accepts an utterance but
  // never plays it, or freezes mid-part on longer segments; both previously
  // looked identical to a dead player. Recover instead of failing silently.
  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const watchdog = window.setInterval(() => {
      if (stateRef.current !== "playing" || synth.paused) return;
      if (synth.speaking || synth.pending) {
        // A no-op resume() unfreezes Chrome's long-utterance stall.
        if (synth.speaking && !synth.paused) synth.resume();
        return;
      }
      recoveryRef.current += 1;
      if (recoveryRef.current > 5) {
        setEngineState("idle");
        setError(
          "Your browser's speech engine isn't responding. Try reloading the page or another browser (Chrome, Edge, or Safari).",
        );
        return;
      }
      speakFrom(indexRef.current, { fromWatchdog: true });
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

  /** Speak segment `from`, then chain onward. Re-invocations supersede safely. */
  function speakFrom(
    from: number,
    opts: { fromWatchdog?: boolean } = {},
  ) {
    if (!supported) return;
    const synth = window.speechSynthesis;
    if (!opts.fromWatchdog) recoveryRef.current = 0;
    const generation = ++generationRef.current;

    const segment = segmentsRef.current[from];
    if (segment === undefined) {
      const lastIndex = Math.max(0, segmentsRef.current.length - 1);
      setEngineState("idle", lastIndex);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(segment);
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
      setError(null);
    };
    utterance.onend = () => {
      if (generation !== generationRef.current || stateRef.current !== "playing")
        return;
      const nextIndex = from + 1;
      if (nextIndex < segmentsRef.current.length) {
        speakFrom(nextIndex);
      } else {
        setEngineState("idle", from);
      }
    };
    utterance.onerror = (event) => {
      // Replacing the queue reports the old utterance as interrupted — expected.
      if (event.error === "interrupted" || event.error === "canceled") return;
      if (generation !== generationRef.current) return;
      setEngineState("idle");
      setError(
        event.error === "not-allowed"
          ? "The browser blocked speech audio. Press play once more, or open the app in its own browser tab."
          : `Speech engine error: ${event.error}`,
      );
    };

    setEngineState("playing", from);

    if (synth.speaking || synth.pending || synth.paused) {
      // Something is queued: cancel it first, then speak on the next tick so
      // the fresh utterance isn't swallowed by the cancel. This path never
      // runs as the first user action, so Safari's gesture rule still holds.
      synth.cancel();
      window.setTimeout(() => {
        if (generation !== generationRef.current || stateRef.current !== "playing")
          return;
        synth.speak(utterance);
      }, 60);
    } else {
      // Engine is idle (first play, or the previous part just ended):
      // speak synchronously for maximum reliability.
      synth.speak(utterance);
    }
  }

  function play(from?: number) {
    speakFrom(from ?? indexRef.current);
  }

  function pause() {
    if (!supported || stateRef.current !== "playing") return;
    window.speechSynthesis.pause();
    setEngineState("paused");
  }

  function toggle() {
    if (!supported) return;
    if (stateRef.current === "playing") {
      pause();
      return;
    }
    // Resume by re-speaking the current part: resume() is unreliable across
    // browsers (Chrome often stays silent after un-pausing), and restarting
    // the segment is always correct after a seek, voice, or rate change.
    speakFrom(indexRef.current);
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
    if (stateRef.current === "playing") speakFrom(indexRef.current);
  }

  function updateVoice(next: string) {
    if (!next) return;
    localStorage.setItem(VOICE_KEY, next);
    setVoiceURI(next);
    voiceRef.current = next;
    if (stateRef.current === "playing") speakFrom(indexRef.current);
  }

  return {
    supported,
    state,
    index,
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
