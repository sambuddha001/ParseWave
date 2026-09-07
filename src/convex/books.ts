import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

/** Maximum characters of source text accepted for one audiobook. */
export const MAX_BOOK_CHARS = 150_000;

const WPM = 150;

/** Split a long paragraph into sentence-sized pieces under `max` chars. */
function splitLongParagraph(paragraph: string, max: number): string[] {
  if (paragraph.length <= max) return [paragraph];
  const sentences =
    paragraph.match(/[^.!?…]+[.!?…]+["')\]]*|\S[^.!?…]*$/g) ?? [paragraph];
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (current && (current + " " + trimmed).length > max) {
      pieces.push(current);
      current = trimmed;
    } else {
      current = current ? current + " " + trimmed : trimmed;
    }
  }
  if (current) pieces.push(current);
  // Hard-split any remaining oversized sentence.
  return pieces.flatMap((piece) => {
    if (piece.length <= max) return [piece];
    const parts: string[] = [];
    for (let i = 0; i < piece.length; i += max) {
      parts.push(piece.slice(i, i + max));
    }
    return parts;
  });
}

/** Accumulate paragraphs into chunks of at most `max` characters. */
export function chunkText(text: string, max = 1500): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const paragraph of paragraphs) {
    for (const piece of splitLongParagraph(paragraph, max)) {
      if (current && (current + "\n\n" + piece).length > max) {
        flush();
        current = piece;
      } else {
        current = current ? current + "\n\n" + piece : piece;
      }
    }
  }
  flush();
  return chunks;
}

function countWords(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

/** Create a book from extracted text: chunk it and store one segment per chunk. */
export const createBook = mutation({
  args: {
    title: v.string(),
    fileName: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to create audiobooks.");

    const text = args.text.trim();
    if (text.length < 100) {
      throw new Error(
        "This document has almost no readable text — try another file.",
      );
    }
    if (text.length > MAX_BOOK_CHARS) {
      throw new Error(
        `Document is too long (${text.length.toLocaleString()} characters). The limit is ${MAX_BOOK_CHARS.toLocaleString()}.`,
      );
    }

    const chunks = chunkText(text);
    const wordCount = countWords(text);
    const now = Date.now();

    const bookId = await ctx.db.insert("books", {
      userId,
      title: args.title.trim().slice(0, 120) || "Untitled audiobook",
      fileName: args.fileName.slice(0, 200),
      charCount: text.length,
      wordCount,
      estMinutes: Math.max(1, Math.ceil(wordCount / WPM)),
      voiceName: "Warm narrator",
      status: "generating",
      totalSegments: chunks.length,
      readySegments: 0,
      createdAt: now,
    });

    for (let idx = 0; idx < chunks.length; idx++) {
      await ctx.db.insert("segments", {
        bookId,
        idx,
        text: chunks[idx],
        charCount: chunks[idx].length,
        status: "pending",
      });
    }

    return bookId;
  },
});

/** All audiobooks owned by the current user, newest first. */
export const listBooks = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("books")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

/** One book with ownership check. */
export const getBook = query({
  args: { bookId: v.id("books") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const book = await ctx.db.get(args.bookId);
    if (!book || book.userId !== userId) return null;
    return book;
  },
});

/** Segments of one book with playback URLs, ordered for the playlist. */
export const getSegments = query({
  args: { bookId: v.id("books") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const book = await ctx.db.get(args.bookId);
    if (!book || book.userId !== userId) return [];
    const segments = await ctx.db
      .query("segments")
      .withIndex("by_book", (q) => q.eq("bookId", args.bookId))
      .order("asc")
      .collect();
    return await Promise.all(
      segments.map(async (segment) => ({
        _id: segment._id,
        idx: segment.idx,
        text: segment.text,
        charCount: segment.charCount,
        status: segment.status,
        bytes: segment.bytes,
        error: segment.error,
        url:
          segment.storageId !== undefined
            ? await ctx.storage.getUrl(segment.storageId)
            : null,
      })),
    );
  },
});

/** Delete a book, its segments, and its audio files. */
export const deleteBook = mutation({
  args: { bookId: v.id("books") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return;
    const book = await ctx.db.get(args.bookId);
    if (!book || book.userId !== userId) return;
    const segments = await ctx.db
      .query("segments")
      .withIndex("by_book", (q) => q.eq("bookId", args.bookId))
      .collect();
    for (const segment of segments) {
      if (segment.storageId !== undefined) {
        await ctx.storage.delete(segment.storageId);
      }
      await ctx.db.delete(segment._id);
    }
    await ctx.db.delete(args.bookId);
  },
});

// ---------------------------------------------------------------------------
// Internal helpers used by the narration action (src/convex/tts.ts).
// ---------------------------------------------------------------------------

/** Fetch the book plus the segments that still need audio. */
export const getForGeneration = internalQuery({
  args: { bookId: v.id("books"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const book = await ctx.db.get(args.bookId);
    if (!book || book.userId !== args.userId) {
      throw new Error("Audiobook not found.");
    }
    const all = await ctx.db
      .query("segments")
      .withIndex("by_book", (q) => q.eq("bookId", args.bookId))
      .order("asc")
      .collect();
    const segments = all
      .filter((s) => s.status === "pending" || s.status === "error")
      .map((s) => ({ _id: s._id, idx: s.idx, text: s.text }));
    return {
      book: {
        _id: book._id,
        title: book.title,
        status: book.status,
      },
      segments,
    };
  },
});

/** Mark the book as narrating and record which voice is used. */
export const beginGeneration = internalMutation({
  args: { bookId: v.id("books"), voiceName: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.bookId, {
      status: "generating",
      voiceName: args.voiceName,
      error: undefined,
    });
  },
});

export const markSegmentProcessing = internalMutation({
  args: { segmentId: v.id("segments") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.segmentId, { status: "processing", error: undefined });
  },
});

export const markSegmentReady = internalMutation({
  args: {
    segmentId: v.id("segments"),
    storageId: v.id("_storage"),
    bytes: v.number(),
  },
  handler: async (ctx, args) => {
    const segment = await ctx.db.get(args.segmentId);
    if (!segment) return;
    await ctx.db.patch(args.segmentId, {
      status: "ready",
      storageId: args.storageId,
      bytes: args.bytes,
      error: undefined,
    });
    const book = await ctx.db.get(segment.bookId);
    if (book) {
      await ctx.db.patch(book._id, {
        readySegments: Math.min(book.totalSegments, book.readySegments + 1),
      });
    }
  },
});

export const markSegmentError = internalMutation({
  args: { segmentId: v.id("segments"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.segmentId, { status: "error", error: args.error });
  },
});

/** Finish generation: ready when nothing is left, error otherwise. */
export const finishBook = internalMutation({
  args: { bookId: v.id("books"), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const book = await ctx.db.get(args.bookId);
    if (!book) return;
    if (args.error) {
      await ctx.db.patch(args.bookId, { status: "error", error: args.error });
      return;
    }
    const remaining = await ctx.db
      .query("segments")
      .withIndex("by_book", (q) => q.eq("bookId", args.bookId))
      .filter((q) =>
        q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "error")),
      )
      .collect();
    if (remaining.length === 0) {
      await ctx.db.patch(args.bookId, { status: "ready", error: undefined });
    } else {
      await ctx.db.patch(args.bookId, {
        status: "error",
        error: `${remaining.length} part${remaining.length === 1 ? "" : "s"} could not be narrated — retry to finish.`,
      });
    }
  },
});
