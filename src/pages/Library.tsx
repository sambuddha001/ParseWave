import { BookCard } from "@/components/BookCard";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/convex/_generated/api";
import { Library as LibraryIcon, LogOut } from "lucide-react";
import { useNavigate } from "react-router";
import { UploadCard } from "@/components/UploadCard";
import { useQuery } from "convex/react";

export default function Library() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const books = useQuery(api.books.listBooks, {});

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <BrandMark showWordmark />
          <div className="flex items-center gap-2">
            <span className="hidden max-w-52 truncate text-sm text-muted-foreground sm:block">
              {user?.email ?? "Guest listener"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={handleSignOut}
              className="text-muted-foreground"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-10 sm:px-6">
        <div className="max-w-2xl">
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Your library
          </h1>
          <p className="mt-2 text-muted-foreground">
            Upload a document and it becomes a narrated audiobook — read aloud
            with a warm, expressive human voice.
          </p>
        </div>

        <div className="mt-8">
          <UploadCard />
        </div>

        <section className="mt-12" aria-label="Your audiobooks">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Audiobooks
          </h2>
          {books === undefined ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-48 rounded-2xl" />
              ))}
            </div>
          ) : books.length === 0 ? (
            <div className="mt-4 flex flex-col items-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                <LibraryIcon className="size-6" />
              </div>
              <p className="mt-4 font-display text-lg font-semibold">
                No audiobooks yet
              </p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Upload a PDF or text file above — we'll voice the whole thing
                for you, images and clutter skipped.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {books.map((book) => (
                <BookCard key={book._id} book={book} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
