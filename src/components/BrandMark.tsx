import { AudioWaveform } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({
  className,
  showWordmark = false,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-soft">
        <AudioWaveform className="size-5" aria-hidden="true" />
      </span>
      {showWordmark && (
        <span className="font-display text-lg font-semibold tracking-tight">
          ParseWave
        </span>
      )}
    </span>
  );
}
