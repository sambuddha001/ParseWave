/**
 * Split cleaned text into sentence-aligned segments for the browser's
 * speech engine. Segments stay small so narration is smooth and captions
 * highlight in sync — this also sidesteps utterance length bugs in some
 * browsers. There is no limit on total text length.
 */

const MAX_SEGMENT = 900;

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
        current += (current ? "\n\n" : "") + piece;
      }
    }
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}
