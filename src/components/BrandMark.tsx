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
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-5"
          aria-hidden="true"
        >
          <path d="M12 7.2C10.6 5.7 8.4 5.2 5.6 5.2c-.6 0-1.1.5-1.1 1.1v10.4c0 .6.5 1.1 1.1 1.1 2.8 0 5 .5 6.4 2 1.4-1.5 3.6-2 6.4-2 .6 0 1.1-.5 1.1-1.1V6.3c0-.6-.5-1.1-1.1-1.1-2.8 0-5 .5-6.4 2Z" />
          <path d="M12 7.2v12.6" />
          <path d="M8.2 10.4v2.4" />
          <path d="M15.8 10.4v2.4" />
        </svg>
      </span>
      {showWordmark && (
        <span className="font-display text-lg font-semibold tracking-tight">
          Audiobook&nbsp;Weaver
        </span>
      )}
    </span>
  );
}
