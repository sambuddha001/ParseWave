import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveBook, type StoredBook } from "@/lib/bookStore";
import {
  ACCEPTED_FILES,
  bookStats,
  extractTextFromFile,
  guessTitle,
} from "@/lib/extract";
import { segmentForSpeech } from "@/lib/segment";
import { cn } from "@/lib/utils";
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

type Phase = "idle" | "extracting" | "ready";

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowMs(): number {
  return Date.now();
}

export function UploadCard({ onSaved }: { onSaved: (book: StoredBook) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");

  const stats = text ? bookStats(text) : null;
  const parts = text ? segmentForSpeech(text).length : 0;
  const busy = phase === "extracting" || saving;

  function reset() {
    setPhase("idle");
    setSaving(false);
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

  async function handleSave() {
    if (!file || !text || saving) return;
    setSaving(true);
    try {
      const book: StoredBook = {
        id: makeId(),
        title: title.trim() || guessTitle(file.name, text),
        fileName: file.name,
        text,
        words: stats?.words ?? 0,
        minutes: stats?.minutes ?? 1,
        createdAt: nowMs(),
      };
      await saveBook(book);
      toast.success("Added to your shelf — press play below.");
      onSaved(book);
      reset();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not save this audiobook locally.",
      );
      setSaving(false);
    }
  }

  return (
    <section
      className="rounded-3xl border border-border/70 bg-card p-1 text-left shadow-soft"
      aria-label="Add a document to narrate"
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
              <p className="max-w-xs text-xs text-muted-foreground">
                Extracting every page — big documents can take a moment
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
                  or click to browse &middot; any length, no sign-up
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
                  Ready to be read aloud
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground"
              onClick={reset}
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
              { label: "Parts", value: parts ? `≈${parts}` : "—" },
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
              disabled={saving}
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
              onClick={() => void handleSave()}
              disabled={busy || !text}
              className="flex-1 gap-2"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <BookAudio className="size-4" />
              )}
              {saving ? "Adding…" : "Add to my shelf"}
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
