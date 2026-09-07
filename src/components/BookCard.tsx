import { Button } from "@/components/ui/button";
import type { StoredBook } from "@/lib/bookStore";
import { AudioLines, Headphones, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

export function BookCard({
  book,
  onListen,
  onDelete,
}: {
  book: StoredBook;
  onListen: (book: StoredBook) => void;
  onDelete: (id: string) => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = window.setTimeout(() => setConfirmingDelete(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingDelete]);

  return (
    <article className="group flex flex-col rounded-2xl border border-border/70 bg-card p-5 shadow-soft transition-shadow hover:shadow-lift">
      <div className="flex items-start justify-between gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <AudioLines className="size-5" />
        </div>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-secondary-foreground">
          ~{book.minutes} min
        </span>
      </div>

      <h3 className="mt-3 line-clamp-2 font-display text-lg font-semibold leading-snug tracking-tight">
        {book.title}
      </h3>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {book.fileName} &middot; {book.words.toLocaleString()} words
      </p>

      <div className="mt-auto flex items-center gap-2 pt-4">
        <Button
          size="sm"
          className="flex-1"
          onClick={() => onListen(book)}
        >
          <Headphones className="size-4" />
          Listen
        </Button>
        {confirmingDelete ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onDelete(book.id)}
            className="px-2.5"
          >
            Delete?
          </Button>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Delete ${book.title}`}
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
