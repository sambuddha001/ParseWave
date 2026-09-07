import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pickDefaultVoice, useNarrator } from "@/hooks/use-speech";
import type { StoredBook } from "@/lib/bookStore";
import { waveHeight } from "@/lib/extract";
import { segmentForSpeech } from "@/lib/segment";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BookAudio,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 2];
const WPM = 150;

function fmtMinutes(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.max(1, minutes)} min`;
}

export function NarrationDeck({
  book,
  onClose,
}: {
  book: StoredBook;
  onClose: () => void;
}) {
  const segments = useMemo(() => segmentForSpeech(book.text), [book.text]);

  // Resume where the listener left off.
  const [initialIndex] = useState(() => {
    const raw = localStorage.getItem(`aw:pos:${book.id}`);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? Math.min(Math.floor(parsed), segmentForSpeech(book.text).length - 1)
      : 0;
  });
  const narrator = useNarrator(segments, Math.max(0, initialIndex));

  const bars = useMemo(() => Array.from({ length: 48 }, (_, i) => i), []);
  const playing = narrator.state === "playing";

  const wordCounts = useMemo(
    () => segments.map((segment) => (segment.match(/\S+/g) ?? []).length),
    [segments],
  );
  const wordsBefore = useMemo(() => {
    const prefix = [0];
    for (let i = 0; i < wordCounts.length; i++) {
      prefix.push(prefix[i] + wordCounts[i]);
    }
    return prefix;
  }, [wordCounts]);

  const total = segments.length;
  const currentIndex = Math.min(narrator.index, Math.max(0, total - 1));
  const elapsed = (wordsBefore[currentIndex] ?? 0) / (WPM * narrator.rate);
  const left =
    ((wordsBefore[total] ?? 0) - (wordsBefore[currentIndex] ?? 0)) /
    (WPM * narrator.rate);
  const progress = total ? ((currentIndex + 1) / total) * 100 : 0;

  // Remember the position after every part.
  useEffect(() => {
    localStorage.setItem(`aw:pos:${book.id}`, String(narrator.index));
  }, [book.id, narrator.index]);

  const sortedVoices = useMemo(
    () =>
      [...narrator.voices].sort((a, b) => {
        const aEn = a.lang.toLowerCase().startsWith("en") ? 0 : 1;
        const bEn = b.lang.toLowerCase().startsWith("en") ? 0 : 1;
        return aEn - bEn || a.name.localeCompare(b.name);
      }),
    [narrator.voices],
  );
  const defaultVoice = useMemo(
    () => pickDefaultVoice(narrator.voices),
    [narrator.voices],
  );

  function handleSeek(event: React.MouseEvent<HTMLDivElement>) {
    if (!total) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    narrator.goTo(Math.floor(ratio * total));
  }

  return (
    <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-lift sm:p-7">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-soft">
            <BookAudio className="size-5" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-semibold tracking-tight">
              {book.title}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {book.fileName}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground"
          onClick={() => {
            narrator.stop();
            onClose();
          }}
          aria-label="Close narrator"
        >
          <X className="size-4" />
        </Button>
      </div>

      {!narrator.supported ? (
        <div className="mt-5 flex items-start gap-2.5 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            Your browser doesn't support built-in narration. Try Chrome, Edge,
            or Safari.
          </p>
        </div>
      ) : (
        <>
          {narrator.error && (
            <div className="mt-5 flex items-start justify-between gap-3 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p className="leading-5">{narrator.error}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => narrator.play()}
              >
                Try again
              </Button>
            </div>
          )}

          {/* Waveform */}
          <div className="mt-6 flex h-16 items-center justify-center gap-[3px]" aria-hidden="true">
            {bars.map((i) => (
              <span
                key={i}
                className={cn(
                  "w-[3px] rounded-full bg-primary/75",
                  playing && "wave-bar",
                )}
                style={{
                  height: `${waveHeight(i) * 100}%`,
                  animationDelay: `${(i % 12) * 0.13}s`,
                  opacity: 0.3 + waveHeight(i) * 0.55,
                }}
              />
            ))}
          </div>

          {/* Seekable progress */}
          <div className="mt-5">
            <div
              role="slider"
              aria-label="Narration position"
              aria-valuemin={1}
              aria-valuemax={total}
              aria-valuenow={currentIndex + 1}
              tabIndex={0}
              onClick={handleSeek}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") narrator.next();
                if (e.key === "ArrowLeft") narrator.prev();
              }}
              className="group relative h-2 w-full cursor-pointer overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] font-medium text-muted-foreground">
              <span>{fmtMinutes(Math.max(0, Math.round(elapsed)))} in</span>
              <span className="tabular-nums">
                Part {currentIndex + 1} of {total}
              </span>
              <span>{fmtMinutes(Math.max(0, Math.round(left)))} left</span>
            </div>
          </div>

          {/* Transport */}
          <div className="mt-6 flex items-center justify-center gap-5">
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-full text-muted-foreground hover:text-foreground"
              onClick={narrator.prev}
              disabled={currentIndex === 0}
              aria-label="Previous part"
            >
              <SkipBack className="size-4" />
            </Button>
            <motion.button
              type="button"
              onClick={narrator.toggle}
              whileTap={{ scale: 0.92 }}
              className="flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lift transition-colors hover:bg-primary/90"
              aria-label={playing ? "Pause narration" : "Play narration"}
            >
              {playing ? (
                <Pause className="size-6" />
              ) : (
                <Play className="size-6 translate-x-[1px]" />
              )}
            </motion.button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-full text-muted-foreground hover:text-foreground"
              onClick={narrator.next}
              disabled={currentIndex >= total - 1}
              aria-label="Next part"
            >
              <SkipForward className="size-4" />
            </Button>
          </div>

          {/* Captions */}
          <div
            className="mt-6 min-h-28 rounded-2xl border border-border/60 bg-background/60 p-4"
            aria-live="polite"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={currentIndex}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="font-display text-base leading-relaxed sm:text-lg"
              >
                {segments[currentIndex]}
              </motion.p>
            </AnimatePresence>
            {segments[currentIndex + 1] && (
              <p className="mt-3 line-clamp-2 border-t border-border/50 pt-3 text-sm leading-6 text-muted-foreground/70">
                {segments[currentIndex + 1]}
              </p>
            )}
          </div>

          {/* Voice + speed */}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1 sm:max-w-64">
              <Select
                value={narrator.voiceURI || undefined}
                onValueChange={narrator.setVoice}
                disabled={sortedVoices.length === 0}
              >
                <SelectTrigger className="w-full bg-background" aria-label="Narrator voice">
                  <SelectValue
                    placeholder={defaultVoice ? defaultVoice.name : "Default voice"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {sortedVoices.map((voice) => (
                    <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name} &middot; {voice.lang}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Narration speed">
              {RATE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => narrator.setRate(option)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                    Math.abs(narrator.rate - option) < 0.01
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-accent",
                  )}
                >
                  {option}&times;
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
