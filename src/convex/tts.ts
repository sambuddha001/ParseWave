"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

/**
 * Narrates a book with a warm, expressive human voice via ElevenLabs.
 * Each text segment becomes one MP3 stored in Convex file storage.
 */

const MODEL_ID = "eleven_multilingual_v2";
const OUTPUT_FORMAT = "mp3_44100_128";

// Warm, expressive narrator voices preferred for audiobook reading.
const PREFERRED_VOICE_NAMES = [
  "Bella",
  "Charlotte",
  "Matilda",
  "Sarah",
  "Jessica",
  "Rachel",
];
const FALLBACK_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

const VOICE_SETTINGS = {
  stability: 0.4, // lower = more emotional variation
  similarity_boost: 0.8,
  style: 0.45, // expressive style exaggeration
  use_speaker_boost: true,
};

class TtsError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pick a warm expressive voice from the account's available voices. */
async function resolveVoice(
  apiKey: string,
): Promise<{ voiceId: string; voiceName: string }> {
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        voices?: Array<{ voice_id: string; name?: string }>;
      };
      const voices = data.voices ?? [];
      for (const preferred of PREFERRED_VOICE_NAMES) {
        const match = voices.find(
          (voice) =>
            (voice.name ?? "").toLowerCase() === preferred.toLowerCase(),
        );
        if (match) {
          return { voiceId: match.voice_id, voiceName: match.name ?? preferred };
        }
      }
      if (voices.length > 0) {
        return {
          voiceId: voices[0].voice_id,
          voiceName: voices[0].name ?? "Narrator",
        };
      }
    }
  } catch {
    // fall through to the known premade voice below
  }
  return { voiceId: FALLBACK_VOICE_ID, voiceName: "Warm narrator" };
}

async function synthesize(
  apiKey: string,
  voiceId: string,
  text: string,
): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: VOICE_SETTINGS,
      }),
    },
  );
  if (!res.ok) {
    let message = `Text-to-speech request failed (${res.status})`;
    try {
      const parsed = (await res.json()) as {
        detail?: { message?: string } | string;
      };
      if (typeof parsed.detail === "string") message = parsed.detail;
      else if (parsed.detail?.message) message = parsed.detail.message;
    } catch {
      // keep the default message
    }
    throw new TtsError(message, res.status);
  }
  return res.arrayBuffer();
}

export const generateAudiobook = action({
  args: { bookId: v.id("books") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to narrate audiobooks.");

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      const error =
        "Missing ELEVENLABS_API_KEY. Add it in the Keys/API keys tab, then press Retry.";
      await ctx.runMutation(internal.books.finishBook, {
        bookId: args.bookId,
        error,
      });
      throw new Error(error);
    }

    const { segments } = await ctx.runQuery(internal.books.getForGeneration, {
      bookId: args.bookId,
      userId,
    });

    const voice = await resolveVoice(apiKey);
    await ctx.runMutation(internal.books.beginGeneration, {
      bookId: args.bookId,
      voiceName: voice.voiceName,
    });

    let lastError: string | null = null;

    for (const segment of segments) {
      if (lastError && /(\(401\)|\(403\)|api key|invalid_api_key)/i.test(lastError)) {
        // Bad credentials will not recover — stop wasting requests.
        break;
      }

      await ctx.runMutation(internal.books.markSegmentProcessing, {
        segmentId: segment._id,
      });

      try {
        let audio: ArrayBuffer;
        try {
          audio = await synthesize(apiKey, voice.voiceId, segment.text);
        } catch (err) {
          // One retry with backoff covers rate limits and transient hiccups.
          if (err instanceof TtsError && (err.status === 401 || err.status === 403)) {
            throw err;
          }
          await sleep(5000);
          audio = await synthesize(apiKey, voice.voiceId, segment.text);
        }

        const blob = new Blob([audio], { type: "audio/mpeg" });
        const storageId = await ctx.storage.store(blob);
        await ctx.runMutation(internal.books.markSegmentReady, {
          segmentId: segment._id,
          storageId,
          bytes: blob.size,
        });
      } catch (err) {
        lastError =
          err instanceof Error ? err.message : "Narration failed for one part.";
        await ctx.runMutation(internal.books.markSegmentError, {
          segmentId: segment._id,
          error: lastError,
        });
      }

      // Stay friendly to rate limits between requests.
      await sleep(300);
    }

    await ctx.runMutation(internal.books.finishBook, {
      bookId: args.bookId,
      error: lastError ?? undefined,
    });
  },
});
