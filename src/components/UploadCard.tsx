import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import {
  ACCEPTED_FILES,
  MAX_CHARS,
  bookStats,
  extractTextFromFile,
  guessTitle,
} from "@/lib/extract";
import { cn } from "@/lib/utils";
import { useAction, useMutation } from "convex/react";
import {
  BookAudio,
  Check,
  FileText,
  Loader2,
  RefreshCw,
  UploadCloud,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router";

type Phase = "idle" | "extracting" | "ready" | "creating";

export function UploadCard() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const createBook = useMutation(api.books.createBook);
  const narrate = useAction(api.tts.generateAudiobook);

  const [phase, setPhase] = useState<Phase>("idle");
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");

  const stats = text ? bookStats(text) : null;
  const estParts = stats ? Math.max(1, Math.round(stats.chars / 1500)) : 0;
  const busy = phase === "extracting" || phase === "creating";

  function reset() {
    setPhase("idle");
    setFile(null);
    setText("");
    setTitle("");
  }

  async function handleFile(next: File) {
    setPhase("extracting");
    try {
      const extracted = await extractTextFromFile(next);
      if (extracted.trim().length < 100) {
        throw new Error(
          "We couldn't find readable text in this file. Scanned documents (images of text) aren't supported yet.",
        );
      }
      if (extracted.length > MAX_CHARS) {
        throw new Error(
          `This document is too long (${extracted.length.toLocaleString()} characters). The current limit is ${MAX_CHARS.toLocaleString()}.`,
        );
      }
      setFile(next);
      setText(extracted);
      setTitle(guessTitle(next.name, extracted));
      setPhase("ready");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not read this file.",
      );
      reset();
    }
  }

  async function handleNarrate() {
    if (!file || !text) return;
    setPhase("creating");
    try {
      const bookId = await createBook({
        title: title.trim() || "Untitled audiobook",
        fileName: file.name,
        text,
      });
      // Fire-and-forget: progress streams in reactively via the book status.
      void narrate({ bookId }).catch((err: Error) => toast.error(err.message));
      toast.success("Narration started — your audiobook is being voiced.");
      navigate(`/listen/${bookId}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not start narration.",
      );
      setPhase("ready");
    }
  }

  return (
    <section
      className="rounded-3xl border border-border/70 bg-card p-1 shadow-soft"
      aria-label="Upload a document"
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_FILES}
        className="hidden"
        onChange={(e) => {
          const next = e.target.files?.[0];
          if (next) void handleFile(next);
          e.target.value = "";
        }}
      />

      {phase === "idle" || phase === "extracting" ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(e) => {
            if (!busy && (e.key === "Enter" || e.key === " ")) {
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const next = e.dataTransfer.files?.[0];
            if (next && !busy) void handleFile(next);
          }}
          className={cn(
            "flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-[1.35rem] border-2 border-dashed px-6 py-10 text-center transition-colors",
            dragging
              ? "border-primary bg-accent/60"
              : "border-border hover:border-primary/50 hover:bg-accent/30",
            busy && "pointer-events-none",
          )}
        >
          {phase === "extracting" ? (
            <>
              <Loader2 className="size-9 animate-spin text-primary" />
              <p className="text-sm font-medium">
                Reading your document&hellip;
              </p>
              <p className="text-xs text-muted-foreground">
                Extracting text and skipping images, page numbers, and headers
              </p>
            </>
          ) : (
            <>
              <div className="flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                <UploadCloud className="size-6" />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  Drop your PDF or text file here
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  or click to browse &middot; up to 25 MB
                </p>
              </div>
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-[11px] font-medium text-secondary-foreground">
                <Check className="size-3 text-primary" />
                Images, page numbers &amp; headers are skipped automatically
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <FileText className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{file?.name}</p>
                <p className="text-xs text-muted-foreground">
                  Ready to be narrated
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground"
              onClick={reset}
              disabled={busy}
              aria-label="Choose a different file"
            >
              <X className="size-4" />
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { label: "Words", value: stats?.words.toLocaleString() ?? "—" },
              {
                label: "Listen time",
                value: stats ? `~${stats.minutes} min` : "—",
              },
              { label: "Parts", value: `≈${estParts}` },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-border/60 bg-secondary/50 px-3 py-2.5 text-center"
              >
                <p className="text-sm font-semibold tabular-nums">
                  {stat.value}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <label
              htmlFor="book-title"
              className="text-xs font-medium text-muted-foreground"
            >
              Audiobook title
            </label>
            <Input
              id="book-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              className="mt-1.5 bg-background"
              maxLength={120}
            />
          </div>

          <div className="mt-4 max-h-32 overflow-y-auto rounded-xl border border-border/60 bg-muted/50 p-3">
            <p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
              {text.slice(0, 1400)}
              {text.length > 1400 ? "…" : ""}
            </p>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={handleNarrate}
              disabled={busy || !text}
              className="flex-1 gap-2"
            >
              {phase === "creating" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <BookAudio className="size-4" />
              )}
              {phase === "creating"
                ? "Starting narration…"
                : "Narrate this audiobook"}
            </Button>
            <Button
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="gap-2"
            >
              <RefreshCw className="size-4" />
              Swap file
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
