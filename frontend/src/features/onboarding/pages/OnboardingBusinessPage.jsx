import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChefHat, CheckCircle2, Landmark, Lock, LogOut, Plus, ShieldCheck, Trash2, Wallet } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSession } from "@/features/auth/session-context";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api-client";
import { signOutUser } from "@/features/auth/auth.api";
import { createBusinessProfile, getBusinessProfile, updateBusinessProfile } from "@/features/business/business.api";
import { confirmOpeningBalance, previewOpeningBalance } from "@/features/onboarding/opening-balance.api";
import { createMenuItem, updateMenuItem } from "@/features/catalog/menu-items.api";
import { TutorialVideoArtifact } from "@/features/app/components/TutorialVideoArtifact";

const rupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const detailGroups = [
  {
    key: "inventoryItems",
    title: "Persediaan / stok awal",
    amountLabel: "Nilai",
    amountField: "value",
    isSingleEstimate: true,
  },
  {
    key: "assetItems",
    title: "Aset usaha",
    nameLabel: "Nama aset",
    amountLabel: "Nilai",
    nameField: "name",
    amountField: "value",
    placeholder: "Peralatan awal",
  },
  {
    key: "liabilityItems",
    title: "Utang",
    nameLabel: "Pemberi utang",
    amountLabel: "Jumlah",
    nameField: "lenderName",
    amountField: "amount",
    placeholder: "Supplier ayam",
  },
  {
    key: "receivableItems",
    title: "Piutang",
    nameLabel: "Nama pelanggan",
    amountLabel: "Jumlah",
    nameField: "customerName",
    amountField: "amount",
    placeholder: "Budi",
  },
];

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function createDetailRow(group) {
  const row = {
    id: createId(),
    [group.amountField]: "",
  };
  if (group.nameField) {
    row[group.nameField] = "";
  }
  return row;
}

function createInitialDetailRows() {
  return detailGroups.reduce((result, group) => {
    result[group.key] = [createDetailRow(group)];
    return result;
  }, {});
}

function createCatalogRow() {
  return {
    id: createId(),
    savedId: "",
    name: "",
    defaultPriceText: "",
    aliasesText: "",
  };
}

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

function parseOptionalPrice(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed.replace(/[^\d]/g, ""));
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function textToAliases(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeError(error, fallback) {
  if (error instanceof ApiClientError || error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}

function BrandLogo() {
  return (
    <div className="flex items-center">
      <span className="text-2xl font-bold text-primary">SuaraUsaha</span>
    </div>
  );
}

function MoneyField({ id, label, value, onChange, disabled, readOnly = false, required = true }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <div className="flex h-12 overflow-hidden rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-ring/20">
        <span className="flex w-12 shrink-0 items-center justify-center border-r border-border bg-background text-sm text-muted-foreground">
          Rp
        </span>
        <input
          id={id}
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70"
          required={required}
        />
      </div>
    </label>
  );
}

function TextField({ id, label, value, onChange, disabled, placeholder, readOnly = false }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <input
        id={id}
        type="text"
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-12 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-70"
        required
      />
    </label>
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

function ItemListPreview({ title, items, nameField, amountField }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <h4 className="text-sm font-bold text-foreground">{title}</h4>
      <div className="mt-2 grid gap-2">
        {items.map((item, index) => (
          <div key={`${title}-${index}`} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-muted-foreground">{nameField ? item[nameField] : title}</span>
            <span className="shrink-0 font-semibold text-foreground">{formatRupiah(item[amountField])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OnboardingBusinessPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState("");
  const [hasBusinessForSubmit, setHasBusinessForSubmit] = useState(session.hasBusiness);
  const [paymentAccounts, setPaymentAccounts] = useState([
    { id: "cash", name: "Kas", type: "cash", openingBalance: "" },
    { id: createId(), name: "", type: "non_cash", openingBalance: "" },
  ]);
  const [catalogRows, setCatalogRows] = useState([createCatalogRow()]);
  const [detailRows, setDetailRows] = useState(createInitialDetailRows);
  const [previewData, setPreviewData] = useState(null);
  const [step, setStep] = useState("profile");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

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

  const openingBalancePayload = useMemo(() => {
    return {
      paymentAccounts: paymentAccounts.map((account) => ({
        name: account.name.trim(),
        type: account.type,
        openingBalance: toMoneyNumber(account.openingBalance),
      })),
      inventoryItems: detailRows.inventoryItems.map((item) => ({
        value: toMoneyNumber(item.value),
      })),
      assetItems: detailRows.assetItems.map((item) => ({
        name: item.name.trim(),
        value: toMoneyNumber(item.value),
      })),
      liabilityItems: detailRows.liabilityItems.map((item) => ({
        lenderName: item.lenderName.trim(),
        amount: toMoneyNumber(item.amount),
      })),
      receivableItems: detailRows.receivableItems.map((item) => ({
        customerName: item.customerName.trim(),
        amount: toMoneyNumber(item.amount),
      })),
    };
  }, [detailRows, paymentAccounts]);

  const displayedPreview = previewData ?? {
    ...openingBalancePayload,
    cashBalance: openingBalancePayload.paymentAccounts
      .filter((account) => account.type === "cash")
      .reduce((sum, account) => sum + account.openingBalance, 0),
    nonCashBalance: openingBalancePayload.paymentAccounts
      .filter((account) => account.type === "non_cash")
      .reduce((sum, account) => sum + account.openingBalance, 0),
    inventoryValue: openingBalancePayload.inventoryItems.reduce((sum, item) => sum + item.value, 0),
    assetValue: openingBalancePayload.assetItems.reduce((sum, item) => sum + item.value, 0),
    debtValue: openingBalancePayload.liabilityItems.reduce((sum, item) => sum + item.amount, 0),
    receivableValue: openingBalancePayload.receivableItems.reduce((sum, item) => sum + item.amount, 0),
  };

  const openingAssets =
    displayedPreview.cashBalance +
    displayedPreview.nonCashBalance +
    displayedPreview.inventoryValue +
    displayedPreview.assetValue +
    displayedPreview.receivableValue;
  const openingLiabilities = displayedPreview.debtValue;
  const openingEquity = displayedPreview.openingEquity ?? openingAssets - openingLiabilities;
  const isBusy = isPreviewing || isConfirming || isSigningOut;

  async function ensureBusinessProfile() {
    const trimmedName = businessName.trim();
    if (hasBusinessForSubmit) {
      await updateBusinessProfile(trimmedName);
      return;
    }

    await createBusinessProfile(trimmedName);
    setHasBusinessForSubmit(true);
  }

  function validateCurrentStep() {
    if (step === "profile" && !businessName.trim()) {
      return "Nama usaha wajib diisi.";
    }

    if (step === "catalog") {
      if (catalogRows.length === 0) return "Isi minimal satu item katalog.";
      const invalidRow = catalogRows.find((row) => !row.name.trim());
      if (invalidRow) return "Nama item katalog wajib diisi.";
      const invalidPrice = catalogRows.find((row) => row.defaultPriceText.trim() && parseOptionalPrice(row.defaultPriceText) === null);
      if (invalidPrice) return "Harga katalog harus berupa angka lebih dari 0.";
    }

    if (step === "accounts") {
      const hasInvalidAccount = paymentAccounts.some((account) => !account.name.trim() || account.openingBalance === "");
      if (hasInvalidAccount) return "Nama dan saldo setiap akun pembayaran wajib diisi.";
    }

    if (step === "details") {
      for (const group of detailGroups) {
        const hasInvalidRow = detailRows[group.key].some((row) => {
          const missingName = group.nameField ? !row[group.nameField].trim() : false;
          return missingName || row[group.amountField] === "";
        });
        if (hasInvalidRow) return `Nama dan nilai ${group.title.toLowerCase()} wajib diisi.`;
      }
    }

    return "";
  }

  async function goToStep(nextStep) {
    const validationError = validateCurrentStep();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setErrorMessage("");

    if (step === "profile" && nextStep === "catalog") {
      setIsPreviewing(true);
      try {
        await ensureBusinessProfile();
      } catch (error) {
        setErrorMessage(normalizeError(error, "Gagal menyimpan profil usaha."));
        return;
      } finally {
        setIsPreviewing(false);
      }
    }

    if (step === "catalog" && nextStep === "accounts") {
      setIsPreviewing(true);
      try {
        await saveCatalogRows();
      } catch (error) {
        setErrorMessage(normalizeError(error, "Gagal menyimpan katalog."));
        return;
      } finally {
        setIsPreviewing(false);
      }
    }

    setStep(nextStep);
  }

  async function handleSignOut() {
    setIsSigningOut(true);
    setErrorMessage("");

    try {
      await signOutUser();
      await session.refreshSession();
      navigate("/login", { replace: true });
    } catch (error) {
      setErrorMessage(normalizeError(error, "Gagal keluar akun. Coba lagi."));
      setIsSigningOut(false);
    }
  }

  function updatePaymentAccount(accountId, field, value) {
    setPaymentAccounts((previous) =>
      previous.map((account) =>
        account.id === accountId
          ? {
              ...account,
              [field]: field === "openingBalance" ? normalizeMoneyInput(value) : value,
            }
          : account,
      ),
    );
    setPreviewData(null);
  }

  function addPaymentAccount() {
    setPaymentAccounts((previous) => [...previous, { id: createId(), name: "", type: "non_cash", openingBalance: "" }]);
    setPreviewData(null);
  }

  function removePaymentAccount(accountId) {
    setPaymentAccounts((previous) => previous.filter((account) => account.id !== accountId || account.type === "cash"));
    setPreviewData(null);
  }

  function updateCatalogRow(rowId, field, value) {
    setCatalogRows((previous) =>
      previous.map((row) =>
        row.id === rowId
          ? {
              ...row,
              [field]: field === "defaultPriceText" ? normalizeMoneyInput(value) : value,
            }
          : row,
      ),
    );
  }

  function addCatalogRow() {
    setCatalogRows((previous) => [...previous, createCatalogRow()]);
  }

  function removeCatalogRow(rowId) {
    setCatalogRows((previous) => previous.filter((row) => row.id !== rowId));
  }

  async function saveCatalogRows() {
    const createdRows = await Promise.all(
      catalogRows.map(async (row) => {
        if (row.savedId) return row;

        const payload = {
          name: row.name.trim(),
          aliases: textToAliases(row.aliasesText),
          defaultPrice: parseOptionalPrice(row.defaultPriceText),
        };

        if (row.savedId) {
          await updateMenuItem(row.savedId, payload);
          return row;
        }

        const response = await createMenuItem(payload);
        return {
          ...row,
          savedId: response?.data?.id ?? row.savedId,
        };
      }),
    );

    setCatalogRows(createdRows);
  }

  function updateDetailRow(group, rowId, field, value) {
    setDetailRows((previous) => ({
      ...previous,
      [group.key]: previous[group.key].map((row) =>
        row.id === rowId
          ? {
              ...row,
              [field]: field === group.amountField ? normalizeMoneyInput(value) : value,
            }
          : row,
      ),
    }));
    setPreviewData(null);
  }

  function addDetailRow(group) {
    setDetailRows((previous) => ({
      ...previous,
      [group.key]: [...previous[group.key], createDetailRow(group)],
    }));
    setPreviewData(null);
  }

  function removeDetailRow(group, rowId) {
    setDetailRows((previous) => ({
      ...previous,
      [group.key]: previous[group.key].filter((row) => row.id !== rowId),
    }));
    setPreviewData(null);
  }

  async function handlePreview() {
    const validationError = validateCurrentStep();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setIsPreviewing(true);
    setErrorMessage("");

    try {
      await ensureBusinessProfile();

      const payload = await previewOpeningBalance(openingBalancePayload);
      setPreviewData(payload?.data ?? null);
      setStep("preview");
    } catch (error) {
      setErrorMessage(normalizeError(error, "Gagal menyiapkan ringkasan saldo awal. Coba lagi."));
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
      if (error instanceof ApiClientError && error.status === 409) {
        await session.refreshSession();
        navigate("/app", { replace: true });
        return;
      }
      setErrorMessage(normalizeError(error, "Gagal menyimpan saldo awal. Pastikan kamu meninjau ringkasan lalu konfirmasi sekali."));
      setIsConfirming(false);
    }
  }

  function stepLabel() {
    if (step === "preview") return "Ringkasan";
    if (step === "profile") return "Langkah 1 dari 4";
    if (step === "catalog") return "Langkah 2 dari 4";
    if (step === "accounts") return "Langkah 3 dari 4";
    return "Langkah 4 dari 4";
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground md:py-10">
      <section className="motion-enter-scale mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-7xl overflow-hidden rounded-xl border border-border bg-card shadow-[0_18px_55px_rgba(17,24,39,0.08)] md:min-h-[calc(100vh-5rem)] md:grid-cols-[0.9fr_1.7fr]">
        <aside className="motion-enter-right flex flex-col gap-8 border-b border-border p-8 md:border-r md:border-b-0 md:p-10 lg:p-12">
          <BrandLogo />

          <div className="mt-4 space-y-6 md:mt-12">
            <span className="inline-flex rounded-full bg-secondary px-3 py-1 text-sm font-semibold text-primary">
              {stepLabel()}
            </span>

            <div className="space-y-4">
              <h1 className="max-w-sm text-3xl leading-tight font-bold text-foreground">
                Siapkan data usaha kamu
              </h1>
              <p className="max-w-md text-base leading-relaxed text-muted-foreground">
                Isi saldo awal per akun dan per nama. Kami akan tampilkan ringkasan sebelum data disimpan.
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

        <div className="motion-enter-up p-8 md:p-10 lg:p-12">
          <div className="mx-auto max-w-4xl">
            {step === "profile" ? (
              <section>
                <h2 className="text-2xl font-bold text-foreground">Profil Bisnis</h2>
                <div className="mt-6">
                  <TutorialVideoArtifact
                    compact
                    title="Tutorial setup Sura"
                    description="Placeholder video end-to-end untuk membantu pengguna memahami setup awal."
                  />
                </div>
                <div className="mt-7">
                  <TextField
                    id="business-name"
                    label="Nama Usaha"
                    value={businessName}
                    disabled={isBusy}
                    onChange={setBusinessName}
                    placeholder="Contoh: Warung Ayam Geprek Josh"
                  />
                </div>
                <Button
                  type="button"
                  disabled={isBusy}
                  onClick={() => goToStep("catalog")}
                  className="mt-8 h-11 w-full rounded-md px-4 text-sm font-bold"
                >
                  {isPreviewing ? "Menyimpan..." : "Lanjut ke Katalog"}
                </Button>
              </section>
            ) : null}

            {step === "catalog" ? (
              <section>
                <div className="flex items-center gap-3">
                  <ChefHat aria-hidden className="h-5 w-5 text-primary" />
                  <h2 className="text-2xl font-bold text-foreground">Katalog Jualan</h2>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Penjualan harus cocok dengan item katalog. Biaya tetap bisa dicatat bebas lewat chat.
                </p>

                <div className="mt-6 grid gap-4">
                  {catalogRows.map((row) => (
                    <article key={row.id} className="rounded-lg border border-border bg-background p-4">
                      <div className="grid gap-3 lg:grid-cols-[minmax(12rem,1.3fr)_minmax(10rem,0.7fr)_minmax(12rem,1fr)_auto] lg:items-end">
                        <TextField
                          id={`catalog-name-${row.id}`}
                          label="Nama item"
                          value={row.name}
                          disabled={isBusy}
                          onChange={(value) => updateCatalogRow(row.id, "name", value)}
                          placeholder="Ayam Geprek / Es Teh"
                        />
                        <MoneyField
                          id={`catalog-price-${row.id}`}
                          label="Harga"
                          value={row.defaultPriceText}
                          disabled={isBusy}
                          required={false}
                          onChange={(value) => updateCatalogRow(row.id, "defaultPriceText", value)}
                        />
                        <TextField
                          id={`catalog-alias-${row.id}`}
                          label="Alias"
                          value={row.aliasesText}
                          disabled={isBusy}
                          onChange={(value) => updateCatalogRow(row.id, "aliasesText", value)}
                          placeholder="geprek, ayam"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          disabled={isBusy || catalogRows.length === 1}
                          onClick={() => removeCatalogRow(row.id)}
                          className="h-11 gap-2 text-danger hover:text-danger"
                        >
                          <Trash2 aria-hidden className="h-4 w-4" />
                          Hapus
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>

                <Button type="button" variant="outline" disabled={isBusy} onClick={addCatalogRow} className="mt-4 h-11 gap-2">
                  <Plus aria-hidden className="h-4 w-4" />
                  Tambah Item Katalog
                </Button>

                <div className="mt-8 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                  <Button type="button" variant="secondary" disabled={isBusy} onClick={() => setStep("profile")} className="h-11 gap-2">
                    <ArrowLeft aria-hidden className="h-4 w-4" />
                    Kembali
                  </Button>
                  <Button type="button" disabled={isBusy} onClick={() => goToStep("accounts")} className="h-11 font-bold">
                    {isPreviewing ? "Menyimpan katalog..." : "Lanjut ke Akun Pembayaran"}
                  </Button>
                </div>
              </section>
            ) : null}

            {step === "accounts" ? (
              <section>
                <div className="flex items-center gap-3">
                  <Wallet aria-hidden className="h-5 w-5 text-primary" />
                  <h2 className="text-2xl font-bold text-foreground">Akun Pembayaran</h2>
                </div>
                <div className="mt-6 grid gap-4">
                  {paymentAccounts.map((account) => (
                    <article key={account.id} className="rounded-lg border border-border bg-background p-4">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.7fr)_auto] md:items-end">
                        <TextField
                          id={`account-name-${account.id}`}
                          label={account.type === "cash" ? "Kas" : "Nama akun"}
                          value={account.name}
                          disabled={isBusy}
                          readOnly={account.type === "cash"}
                          onChange={(value) => updatePaymentAccount(account.id, "name", value)}
                          placeholder="Bank BCA / QRIS / GoPay"
                        />
                        <MoneyField
                          id={`account-balance-${account.id}`}
                          label="Saldo awal"
                          value={account.openingBalance}
                          disabled={isBusy}
                          onChange={(value) => updatePaymentAccount(account.id, "openingBalance", value)}
                        />
                        {account.type === "non_cash" ? (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() => removePaymentAccount(account.id)}
                            className="h-11 gap-2 text-danger hover:text-danger"
                          >
                            <Trash2 aria-hidden className="h-4 w-4" />
                            Hapus
                          </Button>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>

                <Button type="button" variant="outline" disabled={isBusy} onClick={addPaymentAccount} className="mt-4 h-11 gap-2">
                  <Plus aria-hidden className="h-4 w-4" />
                  Tambah Bank / QRIS / E-wallet
                </Button>

                <div className="mt-8 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                  <Button type="button" variant="secondary" disabled={isBusy} onClick={() => setStep("catalog")} className="h-11 gap-2">
                    <ArrowLeft aria-hidden className="h-4 w-4" />
                    Kembali
                  </Button>
                  <Button type="button" disabled={isBusy} onClick={() => goToStep("details")} className="h-11 font-bold">
                    Lanjut ke Rincian Saldo
                  </Button>
                </div>
              </section>
            ) : null}

            {step === "details" ? (
              <section>
                <div className="flex items-center gap-3">
                  <Landmark aria-hidden className="h-5 w-5 text-primary" />
                  <h2 className="text-2xl font-bold text-foreground">Rincian Saldo Awal</h2>
                </div>

                <div className="mt-6 grid gap-5">
                  {detailGroups.map((group) => (
                    <section key={group.key} className="rounded-lg border border-border bg-background p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-bold text-foreground">{group.title}</h3>
                          {group.isSingleEstimate ? (
                            <p className="mt-1 text-sm text-muted-foreground">
                              Persediaan dicatat sebagai satu estimasi nilai, bukan daftar barang.
                            </p>
                          ) : null}
                        </div>
                        {!group.isSingleEstimate ? (
                          <Button type="button" variant="outline" disabled={isBusy} onClick={() => addDetailRow(group)} className="h-10 gap-2">
                            <Plus aria-hidden className="h-4 w-4" />
                            Tambah
                          </Button>
                        ) : null}
                      </div>

                      <div className="mt-4 grid gap-3">
                        {detailRows[group.key].map((row) => (
                          <article
                            key={row.id}
                            className={`grid gap-3 md:items-end ${
                              group.nameField
                                ? "md:grid-cols-[minmax(0,1fr)_minmax(180px,0.7fr)_auto]"
                                : "md:grid-cols-[minmax(180px,0.7fr)]"
                            }`}
                          >
                            {group.nameField ? (
                              <TextField
                                id={`${group.key}-name-${row.id}`}
                                label={group.nameLabel}
                                value={row[group.nameField]}
                                disabled={isBusy}
                                onChange={(value) => updateDetailRow(group, row.id, group.nameField, value)}
                                placeholder={group.placeholder}
                              />
                            ) : null}
                            <MoneyField
                              id={`${group.key}-amount-${row.id}`}
                              label={group.amountLabel}
                              value={row[group.amountField]}
                              disabled={isBusy}
                              onChange={(value) => updateDetailRow(group, row.id, group.amountField, value)}
                            />
                            {!group.isSingleEstimate ? (
                              <Button
                                type="button"
                                variant="outline"
                                disabled={isBusy || detailRows[group.key].length === 1}
                                onClick={() => removeDetailRow(group, row.id)}
                                className="h-11 gap-2 text-danger hover:text-danger"
                              >
                                <Trash2 aria-hidden className="h-4 w-4" />
                                Hapus
                              </Button>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>

                <div className="mt-8 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                  <Button type="button" variant="secondary" disabled={isBusy} onClick={() => setStep("accounts")} className="h-11 gap-2">
                    <ArrowLeft aria-hidden className="h-4 w-4" />
                    Kembali
                  </Button>
                  <Button type="button" disabled={isBusy} onClick={handlePreview} className="h-11 font-bold">
                    {isPreviewing ? "Menyiapkan ringkasan..." : "Lihat Ringkasan"}
                  </Button>
                </div>
              </section>
            ) : null}

            {step === "preview" ? (
              <section className="motion-enter-up">
                <div className="flex items-center gap-3">
                  <CheckCircle2 aria-hidden className="h-5 w-5 text-success" />
                  <h2 className="text-2xl font-bold text-foreground">Ringkasan Saldo Awal</h2>
                </div>

                <div className="mt-5 rounded-lg border border-border bg-background p-5" aria-live="polite">
                  <PreviewRow label="Kas" value={displayedPreview.cashBalance} />
                  <PreviewRow label="Bank / QRIS / E-wallet" value={displayedPreview.nonCashBalance} />
                  <PreviewRow label="Persediaan" value={displayedPreview.inventoryValue} />
                  <PreviewRow label="Aset usaha" value={displayedPreview.assetValue} />
                  <PreviewRow label="Piutang" value={displayedPreview.receivableValue} />
                  <PreviewRow label="Total Aktiva" value={openingAssets} />
                  <PreviewRow label="Utang" value={displayedPreview.debtValue} tone="warning" />
                  <PreviewRow label="Total Pasiva Awal" value={openingLiabilities} tone="warning" />
                  <PreviewRow label="Modal awal" value={openingEquity} />
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <ItemListPreview title="Akun pembayaran" items={openingBalancePayload.paymentAccounts} nameField="name" amountField="openingBalance" />
                  {detailGroups.map((group) => (
                    <ItemListPreview
                      key={group.key}
                      title={group.title}
                      items={openingBalancePayload[group.key]}
                      nameField={group.nameField}
                      amountField={group.amountField}
                    />
                  ))}
                </div>

                <div className="mt-8 rounded-lg bg-background p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-base font-bold text-foreground">Modal Awal</p>
                      <p className="mt-1 text-sm text-muted-foreground">Total Aktiva - Total Utang</p>
                    </div>
                    <p className="text-2xl font-bold text-foreground">{formatRupiah(openingEquity)}</p>
                  </div>
                </div>

                <div className="mt-7 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                  <Button type="button" variant="secondary" onClick={() => setStep("details")} disabled={isBusy} className="h-11 gap-2 px-5">
                    <ArrowLeft aria-hidden className="h-4 w-4" />
                    Edit
                  </Button>
                  <Button type="button" onClick={handleConfirm} disabled={isBusy} className="h-11 w-full rounded-md px-4 text-sm font-bold">
                    {isConfirming ? "Menyimpan..." : "Konfirmasi Saldo Awal"}
                  </Button>
                </div>
              </section>
            ) : null}

            <p className="mt-4 flex items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <Lock aria-hidden className="h-4 w-4" />
              <span>Data finansial baru tersimpan setelah kamu menekan konfirmasi.</span>
            </p>

            {errorMessage ? (
              <p className="mt-4 text-center text-sm text-danger" role="alert">
                {errorMessage}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
