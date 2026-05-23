import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Lock, LogOut, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSession } from "@/features/auth/session-context";
import { Button } from "@/components/ui/button";
import {
  ApiClientError,
  confirmOpeningBalance,
  createBusinessProfile,
  getBusinessProfile,
  previewOpeningBalance,
  signOutUser,
  updateBusinessProfile,
} from "@/lib/api-client";

const moneyFields = [
  {
    id: "cashBalance",
    label: "Saldo Kas",
    helper: "Uang tunai di kas usaha saat ini",
  },
  {
    id: "inventoryValue",
    label: "Nilai Persediaan",
    helper: "Perkiraan nilai stok bahan baku / barang dagangan",
  },
  {
    id: "assetValue",
    label: "Nilai Aset Usaha",
    helper: "Perkiraan nilai aset seperti peralatan, meja, kulkas, dll",
  },
  {
    id: "debtValue",
    label: "Utang",
    helper: "Total utang usaha yang masih harus dibayar",
  },
  {
    id: "receivableValue",
    label: "Piutang",
    helper: "Total piutang pelanggan yang belum dibayar",
  },
];

const initialMoneyValues = {
  cashBalance: "",
  inventoryValue: "",
  assetValue: "",
  debtValue: "",
  receivableValue: "",
};

const rupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

function formatRupiah(value) {
  return rupiahFormatter.format(value).replace(/\s+/g, " ");
}

function normalizeMoneyInput(value) {
  if (value === "") return "";

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) return "0";

  return String(Math.floor(numberValue));
}

function toMoneyNumber(value) {
  if (value === "") return 0;

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) return 0;

  return Math.floor(numberValue);
}

function toOpeningBalancePayload(moneyValues) {
  return {
    cashBalance: toMoneyNumber(moneyValues.cashBalance),
    nonCashBalance: 0,
    inventoryValue: toMoneyNumber(moneyValues.inventoryValue),
    assetValue: toMoneyNumber(moneyValues.assetValue),
    debtValue: toMoneyNumber(moneyValues.debtValue),
    receivableValue: toMoneyNumber(moneyValues.receivableValue),
  };
}

function BrandLogo() {
  return (
    <div className="flex items-center gap-3">
      <div
        aria-hidden
        className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"
      >
        <span className="flex h-5 items-end gap-1">
          <span className="block h-2 w-1.5 rounded-full bg-current" />
          <span className="block h-3.5 w-1.5 rounded-full bg-current" />
          <span className="block h-5 w-1.5 rounded-full bg-current" />
        </span>
      </div>
      <span className="text-2xl font-bold text-primary">SuaraUsaha</span>
    </div>
  );
}

function MoneyInput({ field, value, onChange, disabled }) {
  return (
    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)] md:items-center">
      <label htmlFor={field.id} className="min-w-0">
        <span className="block text-sm font-semibold text-foreground">{field.label}</span>
        <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{field.helper}</span>
      </label>

      <div className="flex h-12 overflow-hidden rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-ring/20">
        <span className="flex w-12 shrink-0 items-center justify-center border-r border-border bg-background text-sm text-muted-foreground">
          Rp
        </span>
        <input
          id={field.id}
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(field.id, event.target.value)}
          className="min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70"
        />
      </div>
    </div>
  );
}

function PreviewRow({ label, value, tone = "default" }) {
  const valueClassName = tone === "warning" ? "text-warning" : "text-foreground";

  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-right text-sm font-bold ${valueClassName}`}>{formatRupiah(value)}</span>
    </div>
  );
}

export function OnboardingBusinessPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState("");
  const [moneyValues, setMoneyValues] = useState(initialMoneyValues);
  const [hasBusinessForSubmit, setHasBusinessForSubmit] = useState(session.hasBusiness);
  const [previewData, setPreviewData] = useState(null);
  const [step, setStep] = useState("input");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const openingBalancePayload = useMemo(() => toOpeningBalancePayload(moneyValues), [moneyValues]);

  useEffect(() => {
    let mounted = true;

    async function loadBusinessName() {
      if (!session.hasBusiness) return;

      setHasBusinessForSubmit(true);

      try {
        const payload = await getBusinessProfile();
        if (!mounted) return;
        setBusinessName(payload?.data?.name ?? "");
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error("Failed to load business profile.", error);
        }
      }
    }

    loadBusinessName();

    return () => {
      mounted = false;
    };
  }, [session.hasBusiness]);

  function updateMoneyValue(fieldId, value) {
    setMoneyValues((previous) => ({
      ...previous,
      [fieldId]: normalizeMoneyInput(value),
    }));
    setPreviewData(null);
  }

  async function handleSignOut() {
    setIsSigningOut(true);
    setErrorMessage("");

    try {
      await signOutUser();
      await session.refreshSession();
      navigate("/login", { replace: true });
    } catch (error) {
      const fallback = "Gagal keluar akun. Coba lagi.";
      const message =
        error instanceof ApiClientError || error instanceof Error ? error.message || fallback : fallback;
      setErrorMessage(message);
      setIsSigningOut(false);
    }
  }

  async function handlePreview(event) {
    event.preventDefault();

    const trimmedName = businessName.trim();
    if (!trimmedName) {
      setErrorMessage("Nama usaha wajib diisi.");
      return;
    }

    setIsPreviewing(true);
    setErrorMessage("");

    try {
      if (hasBusinessForSubmit) {
        await updateBusinessProfile(trimmedName);
      } else {
        await createBusinessProfile(trimmedName);
        setHasBusinessForSubmit(true);
      }

      const payload = await previewOpeningBalance(openingBalancePayload);
      setPreviewData(payload?.data ?? null);
      setStep("preview");
    } catch (error) {
      const fallback = "Gagal menyiapkan ringkasan saldo awal. Coba lagi.";
      const message =
        error instanceof ApiClientError || error instanceof Error ? error.message || fallback : fallback;
      setErrorMessage(message);
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleConfirm() {
    setIsConfirming(true);
    setErrorMessage("");

    try {
      await confirmOpeningBalance(openingBalancePayload);
      await session.refreshSession();
      navigate("/app", { replace: true });
    } catch (error) {
      let message = "Gagal menyimpan saldo awal. Pastikan kamu meninjau ringkasan lalu konfirmasi sekali.";
      if (error instanceof ApiClientError && error.status === 409) {
        await session.refreshSession();
        navigate("/app", { replace: true });
        return;
      } else if (error instanceof ApiClientError || error instanceof Error) {
        message = error.message || message;
      }
      setErrorMessage(message);
      setIsConfirming(false);
    }
  }

  function handleBackToInput() {
    setStep("input");
    setErrorMessage("");
  }

  const isBusy = isPreviewing || isConfirming || isSigningOut;
  const displayedPreview = previewData ?? {
    ...openingBalancePayload,
    openingEquity:
      openingBalancePayload.cashBalance +
      openingBalancePayload.inventoryValue +
      openingBalancePayload.assetValue +
      openingBalancePayload.receivableValue -
      openingBalancePayload.debtValue,
  };

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground md:py-10">
      <section className="motion-enter-scale mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-7xl overflow-hidden rounded-xl border border-border bg-card shadow-[0_18px_55px_rgba(17,24,39,0.08)] md:min-h-[calc(100vh-5rem)] md:grid-cols-[0.9fr_1.7fr]">
        <aside className="motion-enter-right flex flex-col gap-8 border-b border-border p-8 md:border-r md:border-b-0 md:p-10 lg:p-12">
          <BrandLogo />

          <div className="mt-4 space-y-6 md:mt-12">
            <span className="inline-flex rounded-full bg-secondary px-3 py-1 text-sm font-semibold text-primary">
              Langkah {step === "preview" ? "2" : "1"} dari 2
            </span>

            <div className="space-y-4">
              <h1 className="max-w-sm text-3xl leading-tight font-bold text-foreground">
                Siapkan data usaha kamu
              </h1>
              <p className="max-w-md text-base leading-relaxed text-muted-foreground">
                Isi data usaha dan saldo awal. Kami akan tampilkan ringkasan sebelum data disimpan.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 rounded-lg bg-secondary/50 p-4 text-sm text-foreground/80">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card text-primary">
              <ShieldCheck aria-hidden className="h-5 w-5" />
            </div>
            <p className="leading-relaxed">Saldo awal baru disimpan setelah kamu menekan tombol konfirmasi.</p>
          </div>

          <Button
            type="button"
            variant="destructive"
            onClick={handleSignOut}
            disabled={isBusy}
            className="mt-auto h-11 w-full justify-center gap-2 rounded-md border border-destructive/30"
          >
            <LogOut aria-hidden className="h-4 w-4" />
            {isSigningOut ? "Keluar..." : "Keluar"}
          </Button>
        </aside>

        <form onSubmit={handlePreview} className="motion-enter-up p-8 md:p-10 lg:p-12">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-2xl font-bold text-foreground">Profil Bisnis</h2>

            <div className="mt-7">
              <label htmlFor="business-name" className="text-sm font-semibold text-foreground">
                Nama Usaha
              </label>
              <input
                id="business-name"
                type="text"
                value={businessName}
                disabled={isBusy || step === "preview"}
                onChange={(event) => setBusinessName(event.target.value)}
                placeholder="Contoh: Warung Ayam Geprek Josh"
                className="mt-2 h-12 w-full rounded-md border border-border bg-card px-4 text-sm text-foreground transition outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-70"
                required
              />
            </div>

            <h3 className="mt-10 text-xl font-bold text-foreground">Saldo Awal</h3>

            <div className="mt-6 grid gap-5">
              {moneyFields.map((field) => (
                <MoneyInput
                  key={field.id}
                  field={field}
                  value={moneyValues[field.id]}
                  disabled={isBusy || step === "preview"}
                  onChange={updateMoneyValue}
                />
              ))}
            </div>

            {step === "preview" ? (
              <section className="motion-enter-up mt-8 rounded-lg border border-border bg-background p-5" aria-live="polite">
                <div className="flex items-center gap-3">
                  <CheckCircle2 aria-hidden className="h-5 w-5 text-success" />
                  <h3 className="text-lg font-bold text-foreground">Ringkasan Saldo Awal</h3>
                </div>

                <div className="mt-4">
                  <PreviewRow label="Kas" value={displayedPreview.cashBalance} />
                  <PreviewRow label="Persediaan" value={displayedPreview.inventoryValue} />
                  <PreviewRow label="Aset usaha" value={displayedPreview.assetValue} />
                  <PreviewRow label="Piutang" value={displayedPreview.receivableValue} />
                  <PreviewRow label="Utang" value={displayedPreview.debtValue} tone="warning" />
                  <PreviewRow label="Modal awal" value={displayedPreview.openingEquity} />
                </div>
              </section>
            ) : null}

            <div className="mt-8 border-t border-border pt-5">
              <div className="flex flex-col gap-4 rounded-lg bg-background p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-base font-bold text-foreground">Modal Awal</p>
                  <p className="mt-1 text-sm text-muted-foreground">Aset Awal - Utang</p>
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {formatRupiah(displayedPreview.openingEquity)}
                </p>
              </div>
            </div>

            {step === "preview" ? (
              <div className="mt-7 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleBackToInput}
                  disabled={isBusy}
                  className="h-11 justify-center gap-2 rounded-md px-5"
                >
                  <ArrowLeft aria-hidden className="h-4 w-4" />
                  Edit
                </Button>
                <Button
                  type="button"
                  onClick={handleConfirm}
                  disabled={isBusy}
                  className="h-11 w-full justify-center rounded-md px-4 text-sm font-bold"
                >
                  {isConfirming ? "Menyimpan..." : "Konfirmasi Saldo Awal"}
                </Button>
              </div>
            ) : (
              <Button
                type="submit"
                disabled={isBusy}
                className="mt-7 h-11 w-full rounded-md px-4 text-sm font-bold"
              >
                {isPreviewing ? "Menyiapkan ringkasan..." : "Lihat Ringkasan"}
              </Button>
            )}

            <p className="mt-4 flex items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <Lock aria-hidden className="h-4 w-4" />
              <span>Data kamu aman. Data finansial baru tersimpan setelah kamu menekan konfirmasi.</span>
            </p>

            {errorMessage ? (
              <p className="mt-4 text-center text-sm text-danger" role="alert">
                {errorMessage}
              </p>
            ) : null}
          </div>
        </form>
      </section>
    </main>
  );
}
