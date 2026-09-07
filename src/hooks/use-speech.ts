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
      setVoices(list);
      setVoiceURI((current) => current || pickDefaultVoice(list)?.voiceURI || "");
    };
    const timer = window.setTimeout(load, 50);
    synth.addEventListener("voiceschanged", load);
    return () => {
      window.clearTimeout(timer);
      synth.removeEventListener("voiceschanged", load);
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

  function setEngineState(next: NarrationState, nextIndex?: number) {
    stateRef.current = next;
    setState(next);
    if (nextIndex !== undefined) {
      indexRef.current = nextIndex;
      setIndex(nextIndex);
    }
  }

  /** Speak segment `from`, then chain onward. Re-invocations supersede safely. */
  function speakFrom(from: number) {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const generation = ++generationRef.current;
    synth.cancel();

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
    }
    utterance.rate = clampRate(rateRef.current);

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
    };

    setEngineState("playing", from);
    // Chrome ignores speak() issued in the same tick as cancel(); defer briefly.
    window.setTimeout(() => {
      if (generation !== generationRef.current || stateRef.current !== "playing")
        return;
      synth.speak(utterance);
    }, 60);
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
    const synth = window.speechSynthesis;
    if (stateRef.current === "playing") {
      synth.pause();
      setEngineState("paused");
      return;
    }
    if (stateRef.current === "paused") {
      synth.resume();
      setEngineState("playing");
      // Some engines drop the queue while paused; restart the part if silent.
      const generation = generationRef.current;
      window.setTimeout(() => {
        if (
          generation === generationRef.current &&
          stateRef.current === "playing" &&
          !synth.speaking &&
          !synth.pending
        ) {
          speakFrom(indexRef.current);
        }
      }, 250);
      return;
    }
    speakFrom(indexRef.current);
  }

  function stop() {
    if (!supported) return;
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
