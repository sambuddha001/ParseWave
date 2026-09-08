import { BookCard } from "@/components/BookCard";
import { BrandMark } from "@/components/BrandMark";
import { NarrationDeck } from "@/components/NarrationDeck";
import { UploadCard } from "@/components/UploadCard";
import { deleteBook, listBooks, type StoredBook } from "@/lib/bookStore";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Github,
  Headphones,
  Images,
  Infinity as InfinityIcon,
  Linkedin,
  Moon,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Sun,
  Timer,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const CONTACT_LINKS = [
  {
    href: "https://github.com/sambuddha001",
    label: "ParseWave on GitHub",
    icon: Github,
  },
  {
    href: "https://www.linkedin.com/in/sambuddha-pal/",
    label: "Sambuddha Pal on LinkedIn",
    icon: Linkedin,
  },
] as const;

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.55, ease: "easeOut" as const },
};

const steps = [
  {
    icon: ScanSearch,
    title: "Drop a file",
    body: "PDF or plain text. We pull out the real text — paragraphs, dialogue, chapters — and leave everything else behind.",
  },
  {
    icon: Sparkles,
    title: "We clean the script",
    body: "Images, page numbers, and running headers are skipped, and hyphenated words are stitched back together.",
  },
  {
    icon: Headphones,
    title: "Press play",
    body: "Your browser's own narrator reads it aloud — with captions, speed control, and automatic resume.",
  },
];

const trustPills = [
  { icon: InfinityIcon, label: "No length limits" },
  { icon: ShieldCheck, label: "Never leaves your device" },
  { icon: Timer, label: "No account, no API" },
];

export default function Landing() {
  const [books, setBooks] = useState<StoredBook[] | null>(null);
  const [activeBook, setActiveBook] = useState<StoredBook | null>(null);
  const deckRef = useRef<HTMLDivElement | null>(null);

  // Theme state, hydrated from the pre-paint script in index.html.
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false,
  );
  const toggleTheme = useCallback(() => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("pw:theme", next ? "dark" : "light");
    } catch {
      // storage unavailable — theme just won't persist
    }
  }, [isDark]);

  useEffect(() => {
    let alive = true;
    listBooks()
      .then((list) => {
        if (alive) setBooks(list);
      })
      .catch(() => {
        if (alive) setBooks([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const openBook = useCallback((book: StoredBook) => {
    setActiveBook(book);
    requestAnimationFrame(() => {
      document
        .getElementById("narrator")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const handleSaved = useCallback(
    (book: StoredBook) => {
      setBooks((current) => [book, ...(current ?? [])]);
      openBook(book);
    },
    [openBook],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteBook(id);
        localStorage.removeItem(`aw:pos:${id}`);
        setBooks((current) => current?.filter((b) => b.id !== id) ?? null);
        setActiveBook((current) => (current?.id === id ? null : current));
        toast.success("Removed from your shelf");
      } catch {
        toast.error("Could not remove this audiobook.");
      }
    },
    [],
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <BrandMark showWordmark />
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-soft">
              <ShieldCheck className="size-3.5 text-primary" />
              Runs 100% in your browser
            </span>
            {CONTACT_LINKS.map((link) => (
              <Button
                key={link.href}
                variant="outline"
                size="icon"
                asChild
                className="size-9 rounded-full shadow-soft"
              >
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={link.label}
                >
                  <link.icon className="size-4" />
                </a>
              </Button>
            ))}
            <Button
              variant="outline"
              size="icon"
              onClick={toggleTheme}
              className="size-9 rounded-full shadow-soft"
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* Hero + the feature itself */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_50%_-8rem,var(--color-accent)_0%,transparent_70%)] opacity-70"
        />
        <div className="relative mx-auto w-full max-w-2xl px-4 pb-20 pt-14 sm:px-6 sm:pt-20">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="flex flex-col items-center text-center"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-soft">
              <FileText className="size-3.5 text-primary" />
              PDF in &middot; audiobook out &middot; instantly
            </span>
            <h1 className="mt-5 text-balance font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Your documents, read{" "}
              <span className="italic text-primary">aloud</span> — right now.
            </h1>
            <p className="mt-4 max-w-xl text-pretty text-lg leading-7 text-muted-foreground">
              Drop a file and start listening in seconds. Narration is spoken
              by your browser itself — no sign-up, no API, no length limits,
              and your files never leave your device.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12, ease: "easeOut" }}
            className="mt-9"
          >
            <UploadCard onSaved={handleSaved} />
          </motion.div>

          <motion.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.25 }}
            className="mt-6 flex flex-wrap items-center justify-center gap-2"
          >
            {trustPills.map((pill) => (
              <li
                key={pill.label}
                className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-[11px] font-medium text-secondary-foreground"
              >
                <pill.icon className="size-3 text-primary" />
                {pill.label}
              </li>
            ))}
          </motion.ul>
        </div>
      </section>

      {/* Narrator */}
      <AnimatePresence>
        {activeBook && (
          <motion.section
            key="narrator-section"
            id="narrator"
            ref={deckRef}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="scroll-mt-24 border-t border-border/60 py-16"
          >
            <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
              <NarrationDeck
                key={activeBook.id}
                book={activeBook}
                onClose={() => setActiveBook(null)}
              />
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Shelf */}
      <section
        id="shelf"
        className="border-t border-border/60 py-16"
      >
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <motion.div {...fadeUp} className="flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-primary">
                Your shelf
              </p>
              <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight">
                Saved on this device
              </h2>
            </div>
            {books && books.length > 0 && (
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                {books.length} {books.length === 1 ? "book" : "books"}
              </span>
            )}
          </motion.div>

          {books === null ? (
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-44 animate-pulse rounded-2xl border border-border/60 bg-muted/50"
                />
              ))}
            </div>
          ) : books.length === 0 ? (
            <motion.div
              {...fadeUp}
              className="mt-10 rounded-2xl border-2 border-dashed border-border bg-card/50 px-6 py-12 text-center"
            >
              <Images className="mx-auto size-8 text-muted-foreground/50" />
              <p className="mt-3 text-sm font-medium">
                Nothing on your shelf yet
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add a document above and it will appear here, ready to listen.
              </p>
            </motion.div>
          ) : (
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {books.map((book, i) => (
                <motion.div
                  key={book.id}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.4, delay: Math.min(i, 5) * 0.06 }}
                >
                  <BookCard
                    book={book}
                    onListen={openBook}
                    onDelete={(id) => void handleDelete(id)}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-border/60 bg-secondary/40 py-16">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <motion.div {...fadeUp} className="max-w-2xl">
            <h2 className="text-balance font-display text-3xl font-semibold tracking-tight">
              From file to finished listen in three steps
            </h2>
          </motion.div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {steps.map((step, i) => (
              <motion.div
                key={step.title}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: i * 0.08 }}
                className="rounded-2xl border border-border/70 bg-card p-6 shadow-soft"
              >
                <div className="flex items-center justify-between">
                  <div className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                    <step.icon className="size-5" />
                  </div>
                  <span className="font-display text-4xl font-semibold text-border">
                    {i + 1}
                  </span>
                </div>
                <h3 className="mt-4 font-display text-xl font-semibold tracking-tight">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {step.body}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60 py-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <BrandMark showWordmark />
          <p className="text-xs text-muted-foreground">
            &copy; 2026 ParseWave &middot; Narrated locally, with warmth
          </p>
        </div>
      </footer>
    </div>
  );
}
