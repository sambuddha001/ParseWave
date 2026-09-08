/**
 * Split cleaned text into sentence-aligned parts for the browser's speech
 * engine. Parts are large (~3 minutes of reading) so narration flows
 * continuously like a real audiobook instead of restarting prosody every
 * few sentences, while staying well under every engine's utterance limits.
 * There is no limit on total text length.
 */

const MAX_SEGMENT = 3200;

/** Split a long paragraph into sentence-sized pieces under `max` chars. */
function splitLongParagraph(paragraph: string, max: number): string[] {
  if (paragraph.length <= max) return [paragraph];

  const sentences = paragraph.match(/[^.!?…]+[.!?…]+["'”’)\]]*|\S[^.!?…]*$/g) ?? [paragraph];
  const pieces: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > max) {
      if (current) {
        pieces.push(current.trim());
        current = "";
      }
      // Hard-split an oversized sentence at word boundaries.
      const words = sentence.split(" ");
      let piece = "";
      for (const word of words) {
        if (piece.length + word.length + 1 > max) {
          pieces.push(piece.trim());
          piece = word;
        } else {
          piece += (piece ? " " : "") + word;
        }
      }
      current = piece;
      continue;
    }
    if (current.length + sentence.length + 1 > max) {
      pieces.push(current.trim());
      current = sentence;
    } else {
      current += (current ? " " : "") + sentence;
    }
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
}

export interface SentenceSpan {
  text: string;
  start: number;
  end: number;
}

const SENTENCE_RE = /[^.!?…]+[.!?…]+["'”’)\]]*|\S[^.!?…]*$/g;

/** Split text into sentence spans with their character offsets. */
export function splitSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  for (const match of text.matchAll(SENTENCE_RE)) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const start = match.index + (raw.length - raw.trimStart().length);
    spans.push({ text: trimmed, start, end: match.index + raw.length });
  }
  return spans;
}

/** Divide a whole book into narration segments, in reading order. */
export function segmentForSpeech(text: string, max = MAX_SEGMENT): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const segments: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const pieces = splitLongParagraph(paragraph, max);
    for (const piece of pieces) {
      if (current.length + piece.length + 2 > max) {
        if (current) segments.push(current.trim());
        current = piece;
      } else {
        // Join with a plain space: a newline mid-part makes several engines
        // insert a hard, audible pause, which reads as choppy narration.
        current += (current ? " " : "") + piece;
      }
    }
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}
