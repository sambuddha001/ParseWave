import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { waveHeight } from "@/lib/extract";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BookOpenCheck,
  FileText,
  Headphones,
  Images,
  Library,
  Play,
  ScanSearch,
  Sparkles,
  Timer,
} from "lucide-react";
import { Link } from "react-router";

const authHref = `/auth?returnTo=${encodeURIComponent("/library")}`;

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.55, ease: "easeOut" as const },
};

function HeroMock() {
  const bars = Array.from({ length: 40 }, (_, i) => i);
  return (
    <div className="relative mx-auto h-[380px] w-full max-w-md select-none">
      {/* Back card: the uploaded document */}
      <motion.div
        initial={{ opacity: 0, y: 24, rotate: -4 }}
        animate={{ opacity: 1, y: 0, rotate: -4 }}
        transition={{ duration: 0.6, delay: 0.15 }}
        className="absolute inset-x-4 top-2 rounded-3xl border border-border/70 bg-card p-5 shadow-soft"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <FileText className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold">the-long-way-home.pdf</p>
            <p className="text-xs text-muted-foreground">
              84,210 words · 312 pages · images skipped
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          <div className="h-2 w-11/12 rounded-full bg-muted" />
          <div className="h-2 w-4/5 rounded-full bg-muted" />
          <div className="h-2 w-2/3 rounded-full bg-muted" />
        </div>
      </motion.div>

      {/* Front card: the player */}
      <motion.div
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.3 }}
        className="absolute inset-x-0 bottom-0 rounded-3xl border border-border/70 bg-card p-6 shadow-lift"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Now narrating
            </p>
            <p className="mt-0.5 font-display text-lg font-semibold">
              The Long Way Home
            </p>
          </div>
          <span className="rounded-full bg-emerald-600/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
            Part 12 of 57
          </span>
        </div>
        <div className="mt-4 flex h-16 items-center justify-center gap-[3px]">
          {bars.map((i) => (
            <span
              key={i}
              className="wave-bar w-[3px] rounded-full bg-primary/75"
              style={{
                height: `${waveHeight(i) * 100}%`,
                animationDelay: `${(i % 12) * 0.13}s`,
                opacity: 0.45 + waveHeight(i) * 0.55,
              }}
            />
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-soft">
            <Play className="size-5 translate-x-[1px]" />
          </span>
          <div className="flex-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-[38%] rounded-full bg-primary" />
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] font-medium text-muted-foreground">
              <span>2:14</span>
              <span>5:51</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

const steps = [
  {
    icon: ScanSearch,
    title: "Upload your file",
    body: "Drop in a PDF or text file. We pull out the real text — paragraphs, dialogue, chapters — and leave everything else behind.",
  },
  {
    icon: Sparkles,
    title: "We clean the script",
    body: "Images, page numbers, and repeated headers are skipped. Hyphenated words are stitched back together so the narration flows.",
  },
  {
    icon: Headphones,
    title: "Press play",
    body: "A warm, expressive narrator reads it aloud. Follow along, change the speed, and pick up right where you left off.",
  },
];

const features = [
  {
    icon: Images,
    title: "Skips the clutter",
    body: "Figures, page numbers, and running headers never get read aloud — only the words that matter.",
  },
  {
    icon: BookOpenCheck,
    title: "Warm human narration",
    body: "An expressive voice with natural emotion and pacing, not a robotic drone reading word by word.",
  },
  {
    icon: Library,
    title: "Your listening library",
    body: "Every document becomes an audiobook you keep, with playback position saved automatically.",
  },
  {
    icon: Timer,
    title: "Made for long listens",
    body: "Playback speed from 1× to 2×, 15-second skips, and follow-along text for every part.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <BrandMark showWordmark />
          <nav className="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
            <a href="#how" className="transition-colors hover:text-foreground">
              How it works
            </a>
            <a href="#features" className="transition-colors hover:text-foreground">
              Features
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link to={authHref}>Sign in</Link>
            </Button>
            <Button asChild>
              <Link to={authHref}>Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_50%_-8rem,var(--color-accent)_0%,transparent_70%)] opacity-70"
        />
        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-14 px-4 pb-24 pt-16 sm:px-6 lg:grid-cols-2 lg:gap-8 lg:pt-24">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-soft">
              <FileText className="size-3.5 text-primary" />
              PDF in · audiobook out
            </span>
            <h1 className="mt-5 text-balance font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Turn any document into an audiobook you&rsquo;ll love{" "}
              <span className="italic text-primary">listening</span> to.
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-lg leading-7 text-muted-foreground">
              Upload a PDF or text file and Audiobook Weaver voices the whole
              thing with a warm, expressive human narrator — automatically
              skipping images, page numbers, and clutter along the way.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" asChild className="gap-2 shadow-lift">
                <Link to={authHref}>
                  Create your first audiobook
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#how">See how it works</a>
              </Button>
            </div>
            <p className="mt-5 text-xs text-muted-foreground">
              Files up to 25 MB · 150,000 characters per book · MP3 narration
            </p>
          </motion.div>
          <HeroMock />
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-border/60 py-24">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <motion.div {...fadeUp} className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-wider text-primary">
              How it works
            </p>
            <h2 className="mt-2 text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              From file to finished audiobook in three steps
            </h2>
          </motion.div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
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

      {/* Features */}
      <section
        id="features"
        className="border-t border-border/60 bg-secondary/40 py-24"
      >
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <motion.div {...fadeUp} className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-wider text-primary">
              Why Audiobook Weaver
            </p>
            <h2 className="mt-2 text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Built for people who&rsquo;d rather listen
            </h2>
          </motion.div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature, i) => (
              <motion.div
                key={feature.title}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: i * 0.08 }}
                className="rounded-2xl border border-border/70 bg-card p-6 shadow-soft"
              >
                <div className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <feature.icon className="size-5" />
                </div>
                <h3 className="mt-4 font-semibold tracking-tight">
                  {feature.title}
                </h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  {feature.body}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section className="py-24">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <motion.div
            {...fadeUp}
            className="relative overflow-hidden rounded-3xl bg-primary px-6 py-16 text-center shadow-lift sm:px-12"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_20rem_at_50%_120%,oklch(1_0_0_/_0.22)_0%,transparent_70%)]"
            />
            <h2 className="relative text-balance font-display text-3xl font-semibold tracking-tight text-primary-foreground sm:text-4xl">
              Your next great listen is already sitting in your files.
            </h2>
            <p className="relative mx-auto mt-3 max-w-xl text-pretty text-primary-foreground/85">
              Upload it, press play, and let the story read itself to you.
            </p>
            <Button
              size="lg"
              variant="secondary"
              asChild
              className="relative mt-8 gap-2"
            >
              <Link to={authHref}>
                Start narrating for free
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60 py-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <BrandMark showWordmark />
          <p className="text-xs text-muted-foreground">
            © 2026 Audiobook Weaver · Narrated with warmth
          </p>
        </div>
      </footer>
    </div>
  );
}
