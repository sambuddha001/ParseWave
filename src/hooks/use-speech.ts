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
 * Browser quirks handled here:
 * - Safari/WebKit requires speak() to run synchronously inside the click
 *   handler, or it stays silent. So we never defer the very first speak
 *   while the engine is idle.
 * - Chrome ignores speak() issued in the same tick as cancel(), so we only
 *   defer (60 ms) when we actually cancelled a busy engine.
 * - Chrome/Edge sometimes swallow an utterance outright (no onstart/onend).
 *   A watchdog detects the silence and retries with the default voice.
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

  // The refs are the engine's source of truth, updated at every transition
  // point so async utterance callbacks never act on stale values.
  const segmentsRef = useRef(segments);
  const stateRef = useRef<NarrationState>("idle");
  const indexRef = useRef(initialIndex);
  const rateRef = useRef(rate);
  const voiceRef = useRef(voiceURI);
  const generationRef = useRef(0);
  const fallbackTriedRef = useRef(false);
  const stallTimerRef = useRef<number | null>(null);

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
      // Async engines report an empty list before they are ready — keep the
      // previous state instead of clobbering the stored voice choice.
      if (list.length === 0) return;
      setVoices(list);
      setVoiceURI((current) => {
        // Drop a stored voice that no longer exists (new browser/device),
        // otherwise it would silently mismatch forever.
        if (current && list.some((voice) => voice.voiceURI === current))
          return current;
        return pickDefaultVoice(list)?.voiceURI ?? "";
      });
    };
    load();
    synth.addEventListener("voiceschanged", load);
    return () => {
      synth.removeEventListener("voiceschanged", load);
    };
  }, [supported]);

  // Never leave narration running or timers pending after unmount.
  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    return () => {
      generationRef.current += 1;
      if (stallTimerRef.current !== null) {
        window.clearTimeout(stallTimerRef.current);
        stallTimerRef.current = null;
      }
      synth.cancel();
    };
  }, [supported]);

  function setEngineState(next: NarrationState, nextIndex?: number) {
    stateRef.current = next;
    setState(next);
    if (nextIndex !== undefined) {
      indexRef.current = nextIndex;
      setIndex(nextIndex);
    }
  }

  function clearStallWatchdog() {
    if (stallTimerRef.current !== null) {
      window.clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }

  /** Speak one segment, then chain onward on its natural end. */
  function startUtterance(from: number, useDefaultVoice = false) {
    const synth = window.speechSynthesis;
    const generation = generationRef.current;
    const segment = segmentsRef.current[from];
    if (segment === undefined) {
      setEngineState("idle", Math.max(0, segmentsRef.current.length - 1));
      return;
    }

    clearStallWatchdog();
    const utterance = new SpeechSynthesisUtterance(segment);
    const available = synth.getVoices();
    let voice: SpeechSynthesisVoice | null | undefined;
    if (useDefaultVoice) {
      // The chosen voice failed once — hand the decision back to the browser.
      voice = null;
    } else if (voiceRef.current) {
      voice =
        available.find((candidate) => candidate.voiceURI === voiceRef.current) ??
        pickDefaultVoice(available);
    } else {
      voice = pickDefaultVoice(available);
    }
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.voice = null;
      utterance.lang = "en-US";
    }
    utterance.rate = clampRate(rateRef.current);
    utterance.volume = 1;
    utterance.pitch = 1;

    utterance.onstart = () => {
      // Real audio confirmed — disarm the silence watchdog.
      clearStallWatchdog();
    };
    utterance.onend = () => {
      clearStallWatchdog();
      if (generation !== generationRef.current || stateRef.current !== "playing")
        return;
      const nextIndex = from + 1;
      if (nextIndex < segmentsRef.current.length) {
        startUtterance(nextIndex);
      } else {
        setEngineState("idle", from);
      }
    };
    utterance.onerror = (event) => {
      clearStallWatchdog();
      // Replacing the queue reports the old utterance as interrupted — expected.
      if (event.error === "interrupted" || event.error === "canceled") return;
      if (generation !== generationRef.current) return;
      // A picked voice can fail to produce audio (e.g. a network voice while
      // offline). Fall back to the browser default voice once before giving up.
      if (!fallbackTriedRef.current) {
        fallbackTriedRef.current = true;
        startUtterance(from, true);
        return;
      }
      setEngineState("idle");
    };

    synth.speak(utterance);

    // If the engine swallowed the utterance (still nothing queued shortly
    // after), retry with the default voice instead of sitting in silence.
    stallTimerRef.current = window.setTimeout(() => {
      stallTimerRef.current = null;
      if (generation !== generationRef.current || stateRef.current !== "playing")
        return;
      if (synth.speaking || synth.pending) return;
      if (!fallbackTriedRef.current) {
        fallbackTriedRef.current = true;
        startUtterance(from, true);
      } else {
        setEngineState("idle");
      }
    }, 1600);
  }

  /** Start narration at `from`, superseding anything already queued. */
  function speakFrom(from: number) {
    if (!supported) return;
    const synth = window.speechSynthesis;
    fallbackTriedRef.current = false;
    const generation = ++generationRef.current;
    const wasBusy = synth.speaking || synth.pending || synth.paused;
    setEngineState("playing", from);

    if (wasBusy) {
      // Chrome ignores speak() issued in the same tick as cancel(); defer briefly.
      synth.cancel();
      window.setTimeout(() => {
        if (generation !== generationRef.current || stateRef.current !== "playing")
          return;
        startUtterance(from);
      }, 60);
    } else {
      // Engine idle: speak inside the user gesture itself — Safari drops the
      // utterance (silently) when speak() is deferred past the click.
      startUtterance(from);
    }
  }

  function play(from?: number) {
    speakFrom(from ?? indexRef.current);
  }

  function pause() {
    if (!supported || stateRef.current !== "playing") return;
    clearStallWatchdog();
    window.speechSynthesis.pause();
    setEngineState("paused");
  }

  function toggle() {
    if (!supported) return;
    const synth = window.speechSynthesis;
    if (stateRef.current === "playing") {
      pause();
      return;
    }
    if (stateRef.current === "paused") {
      clearStallWatchdog();
      synth.resume();
      setEngineState("playing");
      // Some engines drop the queue while paused; restart the part if silent.
      const generation = generationRef.current;
      window.setTimeout(() => {
        if (generation !== generationRef.current || stateRef.current !== "playing")
          return;
        if (synth.speaking || synth.pending) return;
        generationRef.current += 1;
        fallbackTriedRef.current = false;
        startUtterance(indexRef.current);
      }, 250);
      return;
    }
    speakFrom(indexRef.current);
  }

  function stop() {
    if (!supported) return;
    clearStallWatchdog();
    generationRef.current += 1;
    window.speechSynthesis.cancel();
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
