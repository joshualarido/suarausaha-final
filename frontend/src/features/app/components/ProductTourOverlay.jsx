import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { completeProductTour } from "@/features/business/business.api";

const tourSteps = [
  {
    target: "sidebar-business",
    title: "Bagian Bisnis",
    description: "Di sini kamu bisa melihat neraca, transaksi, stok, aset, utang, dan piutang usaha.",
  },
  {
    target: "sidebar-settings",
    title: "Bagian Pengaturan",
    description: "Atur profil bisnis, akun pembayaran, dan katalog jualan dari bagian ini.",
  },
  {
    target: "sura-header",
    title: "Kenalan dengan Sura",
    description: "Sura adalah asisten yang membantu mencatat transaksi dan menjawab ringkasan usaha dengan bahasa sederhana.",
  },
  {
    target: "sura-help-cta",
    title: "Mulai perjalanan pembukuan",
    description: "Klik tombol Sura bisa apa? untuk melihat contoh hal yang bisa kamu tanyakan atau catat.",
    isFinal: true,
  },
];

function getTargetRect(target) {
  const element = document.querySelector(`[data-tour-target="${target}"]`);
  if (!element) return null;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function getFocusStyle(rect) {
  const padding = 8;
  return {
    top: Math.max(8, rect.top - padding),
    left: Math.max(8, rect.left - padding),
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function getDialogStyle(rect) {
  if (!rect) {
    return {
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
    };
  }

  const focus = getFocusStyle(rect);
  const dialogWidth = Math.min(360, window.innerWidth - 32);
  const fitsRight = focus.left + focus.width + dialogWidth + 20 <= window.innerWidth;
  const fitsBelow = focus.top + focus.height + 190 <= window.innerHeight;

  if (fitsRight) {
    return {
      top: Math.min(Math.max(16, focus.top), window.innerHeight - 220),
      left: focus.left + focus.width + 16,
    };
  }

  return {
    top: fitsBelow ? focus.top + focus.height + 14 : Math.max(16, focus.top - 206),
    left: Math.min(Math.max(16, focus.left), window.innerWidth - dialogWidth - 16),
  };
}

export function ProductTourOverlay({ onCompleted, onFinalAction }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const step = tourSteps[stepIndex];
  const focusStyle = targetRect ? getFocusStyle(targetRect) : null;
  const dialogStyle = useMemo(() => getDialogStyle(targetRect), [targetRect]);

  useEffect(() => {
    let frameId = 0;

    function updateRect() {
      frameId = window.requestAnimationFrame(() => {
        setTargetRect(getTargetRect(step.target));
      });
    }

    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [step.target]);

  async function finishTour({ runFinalAction = false } = {}) {
    setIsCompleting(true);
    setErrorMessage("");

    try {
      await completeProductTour();
      await onCompleted?.();
      if (runFinalAction) {
        onFinalAction?.();
      }
    } catch (error) {
      const fallback = "Tur belum bisa diselesaikan. Coba lagi sebentar.";
      setErrorMessage(error instanceof Error ? error.message || fallback : fallback);
      setIsCompleting(false);
    }
  }

  function handleNext() {
    if (step.isFinal) {
      void finishTour({ runFinalAction: true });
      return;
    }

    setStepIndex((previous) => Math.min(previous + 1, tourSteps.length - 1));
  }

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-labelledby="product-tour-title">
      <button
        type="button"
        aria-label="Lewati tur"
        className="absolute inset-0 z-0 cursor-default bg-transparent"
        onClick={() => finishTour()}
      />

      {focusStyle ? (
        <div
          className="pointer-events-none fixed z-10 rounded-xl border-2 border-primary bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.68),0_18px_50px_rgba(0,0,0,0.32)] transition-all duration-200"
          style={focusStyle}
        />
      ) : (
        <div className="pointer-events-none fixed inset-0 z-10 bg-black/70" />
      )}

      <section
        className="motion-enter-scale fixed z-20 w-[min(22.5rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-4 text-card-foreground shadow-2xl"
        style={dialogStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="su-type-meta text-primary">
              {stepIndex + 1} dari {tourSteps.length}
            </p>
            <h2 id="product-tour-title" className="su-type-section-title mt-1 text-foreground">
              {step.title}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Lewati tur"
            disabled={isCompleting}
            onClick={() => finishTour()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>

        <p className="su-type-body mt-3 text-muted-foreground">{step.description}</p>

        {errorMessage ? (
          <p className="su-type-helper mt-3 text-danger" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={isCompleting}
            onClick={() => finishTour()}
            className="h-10 px-3"
          >
            Lewati
          </Button>
          <Button type="button" disabled={isCompleting} onClick={handleNext} className="h-10 gap-2 px-4">
            {isCompleting ? (
              "Menyimpan..."
            ) : step.isFinal ? (
              <>
                <CheckCircle2 aria-hidden className="h-4 w-4" />
                Mulai dengan Sura
              </>
            ) : (
              <>
                Lanjut
                <ArrowRight aria-hidden className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </section>
    </div>
  );
}
