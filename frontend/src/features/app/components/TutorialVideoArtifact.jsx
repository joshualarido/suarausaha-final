import { Play, Video } from "lucide-react";
import tutorialGif from "@/assets/suarausaha2.gif";

export function TutorialVideoArtifact({
  title = "Video tutorial Sura",
  description = "Panduan singkat untuk memakai Sura.",
  compact = false,
}) {
  return (
    <article className={compact ? "w-full" : "flex justify-start"}>
      <div className={compact ? "w-full" : "w-full max-w-[94%] sm:max-w-[92%]"}>
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="relative aspect-video bg-muted">
            <img src={tutorialGif} alt={title} className="h-full w-full object-cover" loading="lazy" />
            <div className="pointer-events-none absolute right-3 bottom-3 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-primary shadow-sm backdrop-blur">
              <Play aria-hidden className="ml-0.5 h-4 w-4" />
            </div>
          </div>
          <div className="flex items-start gap-3 border-t border-border px-4 py-3">
            <Video aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="su-type-helper text-muted-foreground">{description}</p>
          </div>
        </div>
      </div>
    </article>
  );
}
