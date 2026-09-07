import * as pdfjsLib from "pdfjs-dist";
// Vite serves the pdf.js worker as an asset URL.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/** Must mirror MAX_BOOK_CHARS in src/convex/books.ts. */
export const MAX_CHARS = 150_000;

export const ACCEPTED_FILES =
  ".pdf,.txt,.md,application/pdf,text/plain,text/markdown";
export const MAX_FILE_MB = 25;

/**
 * Clean raw extracted text: collapse whitespace, drop page numbers and
 * running headers, and re-join words that PDFs hyphenate across lines.
 * Images never produce text, so they are skipped automatically.
 */
export function cleanExtractedText(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => {
      if (!line) return true;
      // standalone page numbers ("12") and running markers ("Page 12 of 340")
      if (/^(page\s*)?\d{1,4}$/i.test(line)) return false;
      if (/^page \d+( of \d+)?$/i.test(line)) return false;
      return true;
    });

  let text = lines.join("\n");
  // de-hyphenate words broken across line breaks: "narrat-\nion" → "narration"
  text = text.replace(/([A-Za-z])-\n([a-z])/g, "$1$2");
  // collapse runs of blank lines into paragraph breaks
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) })
    .promise;
  const pages: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    let pageText = "";
    for (const item of content.items) {
      if ("str" in item) {
        pageText += item.str;
        if (item.hasEOL) pageText += "\n";
      }
    }
    pages.push(pageText);
    page.cleanup();
  }
  return pages.join("\n\n");
}

/** Extract and clean readable text from a PDF or text file. */
export async function extractTextFromFile(file: File): Promise<string> {
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    throw new Error(`File is larger than ${MAX_FILE_MB} MB.`);
  }
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return cleanExtractedText(await extractPdfText(file));
  }
  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    file.type.startsWith("text/")
  ) {
    return cleanExtractedText(await file.text());
  }
  throw new Error("Unsupported file type — upload a PDF or text file.");
}

/** Guess a book title: first heading-like line, else the file name. */
export function guessTitle(fileName: string, text: string): string {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 2);
  if (
    firstLine &&
    firstLine.length <= 80 &&
    !/[.!?]$/.test(firstLine) &&
    !/^\d+$/.test(firstLine)
  ) {
    return firstLine;
  }
  return (
    fileName
      .replace(/\.(pdf|txt|md)$/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Untitled audiobook"
  );
}

export function bookStats(text: string): {
  words: number;
  chars: number;
  minutes: number;
} {
  const trimmed = text.trim();
  const words = (trimmed.match(/\S+/g) ?? []).length;
  return {
    words,
    chars: trimmed.length,
    minutes: Math.max(1, Math.ceil(words / 150)),
  };
}

/** Deterministic pseudo-random height in [0.25, 1] for waveform bars. */
export function waveHeight(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return 0.25 + 0.75 * Math.abs(x - Math.floor(x));
}
