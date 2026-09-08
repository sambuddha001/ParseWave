/**
 * MP3 export for ParseWave — entirely local, no APIs.
 *
 * The Web Speech API does not expose its output as a MediaStream, so the only
 * way to capture the exact narration you hear is to record the tab's own
 * audio. The flow:
 *
 *   1. The user picks "This tab" in the browser's share dialog once.
 *   2. We record the tab audio while the narrator reads the book.
 *   3. When narration ends (or the user stops), we encode the recording to
 *      MP3 with a pure-JS encoder (@breezystack/lamejs) and download it.
 *
 * The recording is mono 48 kHz (tab audio down-mixed), resampled to the
 * encoder rate on the fly, so a one-hour book lands around 30–60 MB.
 */
import { Mp3Encoder } from "@breezystack/lamejs";

const SAMPLE_RATE = 44100;
const KBPS = 128;
const CHUNK_SECONDS = 2; // encode in ~2s blocks to keep memory flat

export type ExportPhase =
  | "idle"
  | "requesting"
  | "recording"
  | "encoding"
  | "saving"
  | "error";

export interface ExportProgress {
  phase: ExportPhase;
  /** Seconds of narration captured so far (while recording). */
  seconds: number;
  /** 0–100 while encoding. */
  percent: number;
  message: string | null;
}

interface AudioChunk {
  chunks: Float32Array[];
  length: number;
}

function newChunk(): AudioChunk {
  return { chunks: [], length: 0 };
}

function pushChunk(chunk: AudioChunk, data: Float32Array) {
  chunk.chunks.push(data);
  chunk.length += data.length;
}

function mergeChunk(chunk: AudioChunk): Float32Array {
  const out = new Float32Array(chunk.length);
  let offset = 0;
  for (const part of chunk.chunks) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function isExportSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function" &&
    typeof AudioContext !== "undefined" &&
    typeof Mp3Encoder === "function"
  );
}

export interface Mp3ExportHandle {
  /** Promise resolving to the Blob, or null if the user cancelled capture. */
  done: Promise<Blob | null>;
  /** Stop early — still encodes what was captured. */
  stop: () => void;
}

/**
 * Start capturing this tab's audio. Resolves with the handle once capture is
 * live (after the user grants it). Returns null if unsupported or cancelled.
 */
export async function startMp3Export(): Promise<Mp3ExportHandle | null> {
  if (!isExportSupported()) return null;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true, // required by the picker, unused
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      // Chrome hints: prefer the current tab with audio.
      // @ts-expect-error — non-standard but widely supported hints
      preferCurrentTab: true,
      selfBrowserSurface: "exclude",
      systemAudio: "exclude",
    });
  } catch {
    return null; // user cancelled the picker
  }

  // If the user picked a surface without audio, bail cleanly.
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }
  // Drop the video track immediately — we only need audio.
  stream.getVideoTracks().forEach((t) => t.stop());

  const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  const source = audioContext.createMediaStreamSource(stream);
  // ScriptProcessor works everywhere without extra permissions; the node
  // buffers at 4096 samples per callback.
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const sink = audioContext.createGain();
  sink.gain.value = 0; // silent tap — the tab's own audio still plays

  const collected = newChunk();
  let doneResolve: (blob: Blob | null) => void = () => {};
  let stopped = false;
  let trackEnded = false;

  const done = new Promise<Blob | null>((resolve) => {
    doneResolve = resolve;
  });

  const finish = () => {
    if (stopped) return;
    stopped = true;
    try {
      processor.onaudioprocess = null;
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void audioContext.close();
    } catch {
      // already torn down
    }
    if (collected.length === 0) {
      doneResolve(null);
      return;
    }
    // Encode merged PCM to MP3 (async so the UI can paint).
    const pcm = mergeChunk(collected);
    setTimeout(() => {
      try {
        doneResolve(encodeMp3(pcm, SAMPLE_RATE));
      } catch {
        doneResolve(null);
      }
    }, 30);
  };

  processor.onaudioprocess = (event) => {
    if (stopped || trackEnded) return;
    const input = event.inputBuffer.getChannelData(0);
    pushChunk(collected, new Float32Array(input));
  };

  source.connect(processor);
  processor.connect(sink);
  sink.connect(audioContext.destination);

  const audioTrack = stream.getAudioTracks()[0];
  audioTrack.addEventListener("ended", () => {
    trackEnded = true;
    finish();
  });

  return {
    done,
    stop: finish,
  };
}

/** Encode mono Float32 PCM into an MP3 Blob. */
export function encodeMp3(pcm: Float32Array, sampleRate: number): Blob {
  const encoder = new Mp3Encoder(1, sampleRate, KBPS);
  const blockSize = SAMPLE_RATE * CHUNK_SECONDS; // samples per encode block
  const parts: Uint8Array[] = [];

  for (let offset = 0; offset < pcm.length; offset += blockSize) {
    const slice = pcm.subarray(offset, Math.min(offset + blockSize, pcm.length));
    const encoded = encoder.encodeBuffer(floatToInt16(slice));
    if (encoded.length > 0) parts.push(new Uint8Array(encoded));
  }
  const tail = encoder.flush();
  if (tail.length > 0) parts.push(new Uint8Array(tail));

  return new Blob(parts as BlobPart[], { type: "audio/mpeg" });
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function safeFileName(title: string): string {
  const cleaned = title
    .replace(/[^\w\s.-]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${cleaned || "parsewave-audiobook"}.mp3`;
}
