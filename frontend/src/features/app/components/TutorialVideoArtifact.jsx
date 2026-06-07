import { Play, Video } from "lucide-react";

export function TutorialVideoArtifact({
  title = "Video tutorial Sura",
  description = "Mock video untuk konsep panduan penggunaan.",
  compact = false,
}) {
  return (
    <article className={compact ? "w-full" : "flex justify-start"}>
      <div className={compact ? "w-full" : "w-full max-w-[94%] sm:max-w-[92%]"}>
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="relative aspect-video bg-muted">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                <Play aria-hidden className="ml-0.5 h-6 w-6" />
              </div>
              <div>
                <p className="su-type-ui text-foreground">{title}</p>
                <p className="su-type-helper mt-1 text-muted-foreground">Mock 16:9 video</p>
              </div>
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
