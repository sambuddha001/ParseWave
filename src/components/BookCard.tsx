import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useAction, useMutation } from "convex/react";
import {
  AlertTriangle,
  AudioLines,
  Headphones,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

export function BookCard({ book }: { book: Doc<"books"> }) {
  const navigate = useNavigate();
  const narrate = useAction(api.tts.generateAudiobook);
  const deleteBook = useMutation(api.books.deleteBook);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = setTimeout(() => setConfirmingDelete(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmingDelete]);

  const isGenerating = book.status === "generating";
  const progress = book.totalSegments
    ? Math.round((book.readySegments / book.totalSegments) * 100)
    : 0;
  const hasAudio = book.readySegments > 0;

  async function handleRetry() {
    setRetrying(true);
    void narrate({ bookId: book._id })
      .catch((err: Error) => toast.error(err.message))
      .finally(() => setRetrying(false));
  }

  async function handleDelete() {
    try {
      await deleteBook({ bookId: book._id });
      toast.success("Audiobook deleted");
    } catch {
      toast.error("Could not delete this audiobook.");
    }
  }

  return (
    <article className="group flex flex-col rounded-2xl border border-border/70 bg-card p-5 shadow-soft transition-shadow hover:shadow-lift">
      <div className="flex items-start justify-between gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <AudioLines className="size-5" />
        </div>
        {book.status === "ready" && (
          <Badge className="gap-1 bg-emerald-600/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
            <Headphones className="size-3" /> Ready
          </Badge>
        )}
        {isGenerating && (
          <Badge className="gap-1 bg-primary/10 text-primary">
            <Loader2 className="size-3 animate-spin" /> Narrating
          </Badge>
        )}
        {book.status === "error" && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="size-3" /> Needs attention
          </Badge>
        )}
      </div>

      <h3 className="mt-3 line-clamp-2 font-display text-lg font-semibold leading-snug tracking-tight">
        {book.title}
      </h3>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {book.fileName} · {book.wordCount.toLocaleString()} words · ~
        {book.estMinutes} min
      </p>

      {isGenerating && (
        <div className="mt-3">
          <div className="mb-1.5 flex justify-between text-[11px] font-medium text-muted-foreground">
            <span>
              Voicing part {Math.min(book.readySegments + 1, book.totalSegments)}{" "}
              of {book.totalSegments}
            </span>
            <span className="tabular-nums">{progress}%</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">
        Voice: {book.voiceName}
      </p>

      {book.status === "error" && (
        <p className="mt-2 line-clamp-2 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-[11px] leading-4 text-destructive">
          {book.error ?? "Something went wrong while narrating."}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2 pt-1">
        <Button
          size="sm"
          className="flex-1"
          disabled={!hasAudio}
          onClick={() => navigate(`/listen/${book._id}`)}
        >
          <Headphones className="size-4" />
          {hasAudio ? "Listen" : "Not ready"}
        </Button>
        {book.status === "error" && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleRetry}
            disabled={retrying || isGenerating}
            className="gap-1.5"
          >
            {retrying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            Retry
          </Button>
        )}
        {confirmingDelete ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={handleDelete}
            className="px-2.5"
          >
            Delete?
          </Button>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Delete audiobook"
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </article>
  );
}
