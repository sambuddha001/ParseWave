import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { useAction, useQuery } from "convex/react";
import {
  ArrowLeft,
  AlertTriangle,
  AudioLines,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { waveHeight } from "@/lib/extract";

const RATES = [1, 1.25, 1.5, 2] as const;

function posKey(bookId: string) {
  return `audiobook-weaver:pos:${bookId}`;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function Listen() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const book = useQuery(
    api.books.getBook,
    bookId ? { bookId: bookId as Id<"books"> } : "skip",
  );
  const segments = useQuery(
    api.books.getSegments,
    bookId ? { bookId: bookId as Id<"books"> } : "skip",
  );
  const narrate = useAction(api.tts.generateAudiobook);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSaveRef = useRef(0);

  // Read the saved playback position once, lazily, before first render.
  const [savedPos] = useState(() => {
    if (!bookId) return null;
    try {
      return JSON.parse(localStorage.getItem(posKey(bookId)) ?? "null") as
        | { idx?: number; time?: number }
        | null;
    } catch {
      return null;
    }
  });
  const seekToRef = useRef<number | null>(
    typeof savedPos?.time === "number" && savedPos.time > 1
      ? savedPos.time
      : null,
  );
  const [requestedIndex, setRequestedIndex] = useState<number | null>(
    typeof savedPos?.idx === "number" && savedPos.idx >= 0
      ? savedPos.idx
      : null,
  );
  const [wantPlay, setWantPlay] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState<number>(1);
  const [retrying, setRetrying] = useState(false);

  // Redirect if the book doesn't exist or belongs to someone else.
  useEffect(() => {
    if (book === null) navigate("/library", { replace: true });
  }, [book, navigate]);

  const total = segments?.length ?? 0;
  // The playing index is derived: fall back to the first part when the saved
  // position is out of range for the loaded segments.
  const index =
    requestedIndex !== null && requestedIndex < Math.max(total, 1)
      ? requestedIndex
      : 0;
  const current = segments?.[index];

  // Point the audio element at the current segment when it has audio.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current?.url) return;
    if (audio.dataset.src !== current.url) {
      audio.dataset.src = current.url;
      audio.src = current.url;
      audio.load();
    }
    audio.playbackRate = rate;
  }, [current?.url, rate]);

  // Honor the play intent: play when possible, pause when requested.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (wantPlay && current?.url) {
      audio.play().catch(() => setWantPlay(false));
    } else if (!wantPlay) {
      audio.pause();
    }
  }, [wantPlay, current?.url, index]);

  function savePosition(idx: number, time: number) {
    if (!bookId) return;
    try {
      localStorage.setItem(posKey(bookId), JSON.stringify({ idx, time }));
    } catch {
      // storage unavailable — resume is best-effort
    }
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    const now = Date.now();
    if (now - lastSaveRef.current > 5000) {
      lastSaveRef.current = now;
      savePosition(index, audio.currentTime);
    }
  }

  function handleLoadedMetadata() {
    const audio = audioRef.current;
    if (!audio) return;
    setDuration(audio.duration);
    if (seekToRef.current !== null) {
      audio.currentTime = seekToRef.current;
      setCurrentTime(seekToRef.current);
      seekToRef.current = null;
    }
  }

  function handleEnded() {
    savePosition(index + 1, 0);
    if (index + 1 < total) {
      seekToRef.current = 0;
      setRequestedIndex(index + 1);
    } else {
      setWantPlay(false);
    }
  }

  function togglePlay() {
    if (!current?.url) {
      toast.info(
        book?.status === "generating"
          ? "The first part is still being voiced — hang tight."
          : "This audiobook has no audio yet.",
      );
      return;
    }
    if (wantPlay) {
      savePosition(index, audioRef.current?.currentTime ?? 0);
    }
    setWantPlay(!wantPlay);
  }

  function changeIndex(next: number) {
    if (!segments) return;
    const clamped = Math.max(0, Math.min(total - 1, next));
    if (clamped === index) return;
    seekToRef.current = 0;
    setCurrentTime(0);
    setDuration(0);
    setRequestedIndex(clamped);
  }

  function skip(delta: number) {
    const audio = audioRef.current;
    if (!audio || !current?.url) return;
    audio.currentTime = Math.max(
      0,
      Math.min(audio.duration || 0, audio.currentTime + delta),
    );
  }

  async function handleRetry() {
    if (!bookId) return;
    setRetrying(true);
    void narrate({ bookId: bookId as Id<"books"> })
      .catch((err: Error) => toast.error(err.message))
      .finally(() => setRetrying(false));
  }

  const bars = useMemo(() => Array.from({ length: 56 }, (_, i) => i), []);
  const partProgress =
    total > 0 ? ((index + (duration ? currentTime / duration : 0)) / total) * 100 : 0;
  const readyCount = segments
    ? segments.filter((s) => s.url).length
    : book?.readySegments ?? 0;

  if (book === undefined || segments === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!book) return null;

  return (
    <div className="min-h-screen bg-background">
      <audio
        ref={audioRef}
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />

      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-4 sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={() => navigate("/library")}
          >
            <ArrowLeft className="size-4" />
            Library
          </Button>
          <BrandMark />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-8 sm:px-6">
        {book.status === "generating" && (
          <div className="mb-6 rounded-2xl border border-primary/25 bg-accent/60 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-accent-foreground">
              <Loader2 className="size-4 animate-spin text-primary" />
              Narrating — {readyCount} of {book.totalSegments} parts ready
            </div>
            <Progress
              value={
                book.totalSegments
                  ? (readyCount / book.totalSegments) * 100
                  : 0
              }
              className="mt-2 h-1.5"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              You can start listening now; the next part begins automatically
              as soon as it's voiced.
            </p>
          </div>
        )}

        {book.status === "error" && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">
                {book.error ?? "Narration hit a problem."}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2 gap-1.5"
                onClick={handleRetry}
                disabled={retrying}
              >
                {retrying ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="size-3.5" />
                )}
                Retry narration
              </Button>
            </div>
          </div>
        )}

        {/* Art + waveform */}
        <section className="rounded-3xl border border-border/70 bg-card p-6 shadow-lift sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
                {book.title}
              </h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 font-medium text-accent-foreground">
                  <AudioLines className="size-3" />
                  {book.voiceName}
                </span>
                <span>
                  Part {Math.min(index + 1, Math.max(total, 1))} of{" "}
                  {Math.max(total, book.totalSegments)}
                </span>
                <span>·</span>
                <span>~{book.estMinutes} min</span>
              </p>
            </div>
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
              <AudioLines className="size-6" />
            </div>
          </div>

          <div
            className="mt-6 flex h-24 items-center justify-center gap-[3px] overflow-hidden rounded-2xl bg-secondary/60 px-4"
            aria-hidden="true"
          >
            {bars.map((i) => (
              <span
                key={i}
                className={cn(
                  "w-[3px] rounded-full bg-primary/75",
                  wantPlay && current?.url && "wave-bar",
                )}
                style={{
                  height: `${waveHeight(i) * 100}%`,
                  animationDelay: `${(i % 14) * 0.11}s`,
                  opacity: 0.45 + waveHeight(i) * 0.55,
                }}
              />
            ))}
          </div>

          {/* Controls */}
          <div className="mt-6 flex items-center justify-center gap-2 sm:gap-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Back 15 seconds"
              onClick={() => skip(-15)}
              disabled={!current?.url}
              className="relative size-10 text-muted-foreground"
            >
              <RotateCcw className="size-4" />
              <span className="absolute bottom-1 text-[8px] font-semibold">
                15
              </span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous part"
              onClick={() => changeIndex(index - 1)}
              disabled={index === 0}
              className="size-10 text-muted-foreground"
            >
              <SkipBack className="size-4" />
            </Button>
            <Button
              size="icon"
              aria-label={wantPlay ? "Pause" : "Play"}
              onClick={togglePlay}
              disabled={!current?.url}
              className="size-14 rounded-full shadow-lift"
            >
              {wantPlay ? (
                <Pause className="size-6" />
              ) : (
                <Play className="size-6 translate-x-[1px]" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next part"
              onClick={() => changeIndex(index + 1)}
              disabled={total === 0 || index >= total - 1}
              className="size-10 text-muted-foreground"
            >
              <SkipForward className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Forward 15 seconds"
              onClick={() => skip(15)}
              disabled={!current?.url}
              className="relative size-10 text-muted-foreground"
            >
              <RotateCw className="size-4" />
              <span className="absolute bottom-1 text-[8px] font-semibold">
                15
              </span>
            </Button>
          </div>

          {/* Seek within the current part */}
          <div className="mt-5 flex items-center gap-3">
            <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
              {formatTime(currentTime)}
            </span>
            <Slider
              value={[Math.min(currentTime, duration || 0)]}
              max={duration || 1}
              step={0.1}
              onValueChange={(value) => {
                const audio = audioRef.current;
                if (!audio || !current?.url) return;
                audio.currentTime = value[0];
                setCurrentTime(value[0]);
              }}
              disabled={!current?.url}
              className="flex-1"
            />
            <span className="w-12 text-xs tabular-nums text-muted-foreground">
              {formatTime(duration)}
            </span>
          </div>

          {/* Progress across the whole book */}
          <div className="mt-4">
            <Progress value={partProgress} className="h-1" />
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{Math.round(partProgress)}% listened</span>
              <div className="flex items-center gap-0.5 rounded-full bg-muted p-0.5">
                {RATES.map((option) => (
                  <button
                    key={option}
                    onClick={() => setRate(option)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                      rate === option
                        ? "bg-card text-foreground shadow-soft"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option}×
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Follow-along text */}
        {current && (
          <section className="mt-6 rounded-2xl border border-border/70 bg-card p-5 shadow-soft">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Follow along — part {index + 1}
            </h2>
            <p className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-foreground/85">
              {current.text}
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
