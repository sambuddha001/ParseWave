import { Button } from "@/components/ui/button";
import {
  CHARS_PER_SECOND,
  pickDefaultVoice,
  useNarrator,
} from "@/hooks/use-speech";
import type { StoredBook } from "@/lib/bookStore";
import { waveHeight } from "@/lib/extract";
import { segmentForSpeech, splitSentences } from "@/lib/segment";
import { cn } from "@/lib/utils";
import {
  downloadBlob,
  isExportSupported,
  safeFileName,
  startMp3Export,
  type Mp3ExportHandle,
} from "@/lib/exportAudio";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  AudioLines,
  BookAudio,
  Check,
  ChevronDown,
  Download,
  Loader2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

/** Rank a voice for the picker: English + premium network voices float up. */
function voiceRank(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  const lang = voice.lang.toLowerCase();
  let score = 0;
  if (lang.startsWith("en")) score += 100;
  if (/natural|neural|premium|enhanced|wavenet|studio|journey|online/.test(name))
    score += 40;
  if (name.includes("google")) score += 20;
  if (name.includes("microsoft") && name.includes("online")) score += 20;
  if (voice.localService) score -= 5;
  if (/espeak|pico|festival|eloquence|freetts/.test(name)) score -= 30;
  return score;
}

function voiceLabel(voice: SpeechSynthesisVoice): string {
  const name = voice.name.replace(/\s*\(.*?\)\s*$/g, "").trim();
  const lang = voice.lang.replace("-", " ");
  return `${name} · ${lang}`;
}

const RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 2];

function fmtSeconds(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtMinutes(minutes: number): string {
  if (minutes < 1) return "<1 min";
  if (minutes >= 60) {
    let h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (m >= 60) return `${h + 1}h`;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(minutes)} min`;
}

export function NarrationDeck({
  book,
  onClose,
}: {
  book: StoredBook;
  onClose: () => void;
}) {
  const segments = useMemo(() => segmentForSpeech(book.text), [book.text]);

  // Preview frames frequently block the browser's speech engine; when we're
  // embedded, offer a one-click way out to a real browser tab.
  const inPreviewFrame =
    typeof window !== "undefined" && window.self !== window.top;

  // Resume where the listener left off.
  const [initialIndex] = useState(() => {
    const raw = localStorage.getItem(`aw:pos:${book.id}`);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? Math.min(Math.floor(parsed), segmentForSpeech(book.text).length - 1)
      : 0;
  });
  const narrator = useNarrator(segments, Math.max(0, initialIndex), {
    onFinish: () => {
      // If an export is running, wrap it up when the book ends.
      const handle = exportHandleRef.current;
      if (handle) void finishExport(handle);
    },
  });

  const bars = useMemo(() => Array.from({ length: 48 }, (_, i) => i), []);
  const playing = narrator.state === "playing";

  const total = segments.length;
  const currentIndex = Math.min(narrator.index, Math.max(0, total - 1));
  const currentPart = segments[currentIndex] ?? "";

  // Sentence-level captions, synced to the engine's word boundaries.
  const sentences = useMemo(() => splitSentences(currentPart), [currentPart]);
  const activeSentenceIdx = useMemo(() => {
    let active = 0;
    for (let i = 0; i < sentences.length; i++) {
      if (narrator.charIndex >= sentences[i].start) active = i;
      else break;
    }
    return active;
  }, [sentences, narrator.charIndex]);
  const activeSentence = sentences[activeSentenceIdx]?.text ?? currentPart;
  const upcoming =
    sentences[activeSentenceIdx + 1]?.text ?? segments[currentIndex + 1];

  // Character-based position for a smooth, continuous progress bar.
  const charPrefix = useMemo(() => {
    const prefix = [0];
    for (const segment of segments) {
      prefix.push(prefix[prefix.length - 1] + segment.length);
    }
    return prefix;
  }, [segments]);
  const totalChars = charPrefix[total] ?? 0;
  const charsDone =
    (charPrefix[currentIndex] ?? 0) +
    Math.min(narrator.charIndex, currentPart.length);
  const elapsedMin = charsDone / (CHARS_PER_SECOND * narrator.rate) / 60;
  const leftMin =
    (totalChars - charsDone) / (CHARS_PER_SECOND * narrator.rate) / 60;
  const progress = totalChars ? (charsDone / totalChars) * 100 : 0;

  // Remember the position after every part.
  useEffect(() => {
    localStorage.setItem(`aw:pos:${book.id}`, String(narrator.index));
  }, [book.id, narrator.index]);

  const sortedVoices = useMemo(
    () =>
      [...narrator.voices].sort((a, b) => {
        const rank = voiceRank(b) - voiceRank(a);
        return rank !== 0 ? rank : a.name.localeCompare(b.name);
      }),
    [narrator.voices],
  );
  const defaultVoice = useMemo(
    () => pickDefaultVoice(narrator.voices),
    [narrator.voices],
  );
  const activeVoice = useMemo(
    () =>
      sortedVoices.find((v) => v.voiceURI === narrator.voiceURI) ??
      defaultVoice ??
      sortedVoices[0],
    [sortedVoices, narrator.voiceURI, defaultVoice],
  );
  const [voiceOpen, setVoiceOpen] = useState(false);
  const voiceButtonRef = useRef<HTMLButtonElement>(null);
  const voiceListRef = useRef<HTMLDivElement>(null);

  // --- MP3 export state ---
  const exportSupported = useMemo(() => isExportSupported(), []);
  const [exportPhase, setExportPhase] = useState<
    "idle" | "recording" | "encoding" | "saving"
  >("idle");
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const exportHandleRef = useRef<Mp3ExportHandle | null>(null);
  const exportSecondsRef = useRef(0);

  const finishExport = useCallback(
    async (handle: Mp3ExportHandle) => {
      exportHandleRef.current = null;
      setExportPhase("encoding");
      const blob = await handle.done;
      if (!blob) {
        setExportPhase("idle");
        toast.error("Export cancelled — no audio was captured.");
        return;
      }
      setExportPhase("saving");
      try {
        downloadBlob(blob, safeFileName(book.title));
        toast.success("MP3 saved to your downloads.");
      } catch {
        toast.error("Could not save the MP3 file.");
      }
      setExportPhase("idle");
      setRecordedSeconds(0);
      exportSecondsRef.current = 0;
    },
    [book.title],
  );

  const startExport = useCallback(async () => {
    if (exportPhase !== "idle" || !exportSupported) return;
    // Start capture first so the very first spoken word is included.
    const handle = await startMp3Export();
    if (!handle) {
      toast.error(
        "Couldn't capture this tab's audio. Pick “This tab” with “Share tab audio” checked when your browser asks.",
      );
      return;
    }
    exportHandleRef.current = handle;
    exportSecondsRef.current = 0;
    setRecordedSeconds(0);
    setExportPhase("recording");
    // Kick off narration (or resume) right after capture is live.
    if (narrator.state !== "playing") narrator.play();
    void handle.done.then(() => {
      // If capture ends on its own (e.g. user hit “Stop sharing”), finish up.
      if (exportHandleRef.current === handle) {
        void finishExport(handle);
      }
    });
  }, [exportPhase, exportSupported, narrator, finishExport]);

  const stopExport = useCallback(() => {
    const handle = exportHandleRef.current;
    if (!handle) return;
    // Pause narration too — the export captures exactly what played.
    if (narrator.state === "playing") narrator.pause();
    void finishExport(handle);
  }, [narrator, finishExport]);

  // Tick the recorded-seconds counter while recording.
  useEffect(() => {
    if (exportPhase !== "recording") return;
    const timer = window.setInterval(() => {
      if (narrator.state === "playing") {
        exportSecondsRef.current += 1;
        setRecordedSeconds(exportSecondsRef.current);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [exportPhase, narrator.state]);

  // Bring the active voice into view the moment the list opens.
  useEffect(() => {
    if (!voiceOpen) return;
    const list = voiceListRef.current;
    if (!list) return;
    const selected = list.querySelector('[aria-current="true"]');
    if (selected instanceof HTMLElement) {
      selected.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [voiceOpen]);

  // Close the voice picker when the user clicks elsewhere.
  useEffect(() => {
    if (!voiceOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        voiceButtonRef.current &&
        !voiceButtonRef.current.contains(event.target as Node)
      ) {
        setVoiceOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVoiceOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [voiceOpen]);

  function handleSeek(event: React.MouseEvent<HTMLDivElement>) {
    if (!totalChars) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );
    const targetChar = ratio * totalChars;
    let target = 0;
    while (
      target < total - 1 &&
      (charPrefix[target + 1] ?? 0) <= targetChar
    ) {
      target++;
    }
    narrator.goTo(target);
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
              <div className="flex shrink-0 flex-col items-stretch gap-1.5">
                {inPreviewFrame && (
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-destructive/30 px-2.5 py-1.5 text-center text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10"
                  >
                    Open in new tab
                  </a>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => narrator.play()}
                >
                  Try again
                </Button>
              </div>
            </div>
          )}

          {/* Waveform */}
          <div
            className="mt-6 flex h-16 items-center justify-center gap-[3px]"
            aria-hidden="true"
          >
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
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
              tabIndex={0}
              onClick={handleSeek}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") narrator.next();
                if (e.key === "ArrowLeft") narrator.prev();
              }}
              className="group relative h-2 w-full cursor-pointer overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] font-medium text-muted-foreground">
              <span>{fmtMinutes(Math.max(0, elapsedMin))} in</span>
              <span className="tabular-nums">
                Section {currentIndex + 1} of {total}
              </span>
              <span>{fmtMinutes(Math.max(0, leftMin))} left</span>
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
              aria-label="Previous section"
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
              aria-label="Next section"
            >
              <SkipForward className="size-4" />
            </Button>
          </div>

          {/* Captions — the sentence being read, plus what's next */}
          <div
            className="mt-6 min-h-28 rounded-2xl border border-border/60 bg-background/60 p-4"
            aria-live="polite"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={`${currentIndex}:${activeSentenceIdx}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="line-clamp-5 font-display text-base leading-relaxed sm:text-lg"
              >
                {activeSentence}
              </motion.p>
            </AnimatePresence>
            {upcoming && (
              <p className="mt-3 line-clamp-2 border-t border-border/50 pt-3 text-sm leading-6 text-muted-foreground/70">
                {upcoming}
              </p>
            )}
          </div>

          {/* Voice + speed */}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative min-w-0 flex-1 sm:max-w-64">
              <button
                ref={voiceButtonRef}
                type="button"
                onClick={() => setVoiceOpen((open) => !open)}
                disabled={sortedVoices.length === 0}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2 text-left text-sm shadow-xs transition-colors hover:border-primary/40 focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]"
                aria-label="Narrator voice"
                aria-haspopup="listbox"
                aria-expanded={voiceOpen}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <AudioLines className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate">
                    {activeVoice ? voiceLabel(activeVoice) : "Default voice"}
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                    voiceOpen && "rotate-180",
                  )}
                />
              </button>

              <AnimatePresence initial={false}>
                {voiceOpen && sortedVoices.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="absolute left-0 right-0 top-full z-50 mt-1.5 w-full min-w-56 rounded-xl border border-border bg-popover shadow-lift"
                    role="listbox"
                  >
                    <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Narrator voice
                      </p>
                      <span className="text-[11px] text-muted-foreground">
                        {sortedVoices.length} available
                      </span>
                    </div>
                    <div
                      ref={voiceListRef}
                      className="max-h-56 overflow-y-auto overscroll-contain p-1 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent]"
                    >
                      {sortedVoices.map((voice) => {
                        const selected = voice.voiceURI === narrator.voiceURI;
                        return (
                          <button
                            key={voice.voiceURI}
                            type="button"
                            onClick={() => {
                              narrator.setVoice(voice.voiceURI);
                              setVoiceOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                              selected
                                ? "bg-accent/70 text-foreground"
                                : "text-popover-foreground hover:bg-accent/40",
                            )}
                            aria-current={selected ? "true" : undefined}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {voiceLabel(voice)}
                            </span>
                            {selected && (
                              <Check className="size-4 shrink-0 text-primary" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div
              className="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Narration speed"
            >
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

          {/* Download MP3 */}
          <div className="mt-5 border-t border-border/60 pt-5">
            {exportPhase === "idle" ? (
              <div className="flex flex-col gap-1.5">
                <Button
                  onClick={() => void startExport()}
                  disabled={!exportSupported}
                  className="w-full gap-2"
                >
                  <Download className="size-4" />
                  Download MP3
                </Button>
                <p className="text-center text-[11px] leading-4 text-muted-foreground">
                  {exportSupported
                    ? "Records the narration as it plays, right in your browser — no uploads, no APIs."
                    : "MP3 export needs a browser with screen-capture support (Chrome, Edge, or Safari)."}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-background/60 p-4">
                {exportPhase === "recording" ? (
                  <>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="relative flex size-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-60" />
                        <span className="relative inline-flex size-2.5 rounded-full bg-destructive" />
                      </span>
                      Recording &middot; {fmtSeconds(recordedSeconds)}
                    </div>
                    <p className="text-center text-[11px] leading-4 text-muted-foreground">
                      Narration is playing and being captured. Let it finish, or
                      stop whenever you like.
                    </p>
                    <Button
                      variant="outline"
                      className="gap-2"
                      onClick={() => void stopExport()}
                    >
                      <Square className="size-3.5" />
                      Stop &amp; save
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Loader2 className="size-4 animate-spin text-primary" />
                      {exportPhase === "encoding"
                        ? "Encoding your MP3…"
                        : "Saving your MP3…"}
                    </div>
                    <p className="text-center text-[11px] leading-4 text-muted-foreground">
                      Longer books take a few moments to encode.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
