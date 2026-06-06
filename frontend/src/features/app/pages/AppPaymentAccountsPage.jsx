import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Star, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/features/app/components/LoadingState";
import { ApiClientError } from "@/lib/api-client";
import {
  createPaymentAccount,
  getPaymentAccounts,
  removePaymentAccount,
  setDefaultPaymentAccount,
  updatePaymentAccountName,
} from "@/features/payment-accounts/payment-accounts.api";

function normalizeError(error, fallback) {
  if (error instanceof ApiClientError || error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}

export function AppPaymentAccountsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [accountDraftNames, setAccountDraftNames] = useState({});
  const [newAccountName, setNewAccountName] = useState("");
  const [savingAccountId, setSavingAccountId] = useState("");
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [settingDefaultAccountId, setSettingDefaultAccountId] = useState("");
  const [removingAccountId, setRemovingAccountId] = useState("");
  const [pendingDeleteAccountId, setPendingDeleteAccountId] = useState("");
  const [pageError, setPageError] = useState("");
  const [accountsMessage, setAccountsMessage] = useState("");

  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }),
    [],
  );

  useEffect(() => {
    let mounted = true;

    async function loadPaymentAccounts() {
      setIsLoading(true);
      setPageError("");

      try {
        const accountsPayload = await getPaymentAccounts();
        if (!mounted) return;

        const accountList = Array.isArray(accountsPayload?.data) ? accountsPayload.data : [];
        const drafts = accountList.reduce((result, account) => {
          result[account.id] = account.name ?? "";
          return result;
        }, {});

        setAccounts(accountList);
        setAccountDraftNames(drafts);
      } catch (error) {
        if (!mounted) return;
        setPageError(normalizeError(error, "Gagal memuat akun pembayaran."));
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadPaymentAccounts();

    return () => {
      mounted = false;
    };
  }, []);

  async function handleSavePaymentAccountName(accountId) {
    const currentName = accountDraftNames[accountId] ?? "";
    const trimmedName = currentName.trim();

    if (!trimmedName) {
      setAccountsMessage("Nama akun pembayaran wajib diisi.");
      return;
    }

    setSavingAccountId(accountId);
    setAccountsMessage("");

    try {
      const payload = await updatePaymentAccountName(accountId, trimmedName);
      const updated = payload?.data;

      setAccounts((previous) =>
        previous.map((account) =>
          account.id === accountId
            ? {
                ...account,
                name: updated?.name ?? trimmedName,
              }
            : account,
        ),
      );
      setAccountDraftNames((previous) => ({
        ...previous,
        [accountId]: updated?.name ?? trimmedName,
      }));
      setAccountsMessage("Akun pembayaran berhasil diperbarui.");
    } catch (error) {
      setAccountsMessage(normalizeError(error, "Gagal menyimpan akun pembayaran."));
    } finally {
      setSavingAccountId("");
    }
  }

  async function handleAddPaymentAccount() {
    const trimmedName = newAccountName.trim();

    if (!trimmedName) {
      setAccountsMessage("Nama akun pembayaran wajib diisi.");
      return;
    }

    setIsAddingAccount(true);
    setAccountsMessage("");

    try {
      const payload = await createPaymentAccount(trimmedName);
      const created = payload?.data;

      if (!created) {
        throw new Error("Akun pembayaran gagal dibuat.");
      }

      setAccounts((previous) => [...previous, created]);
      setAccountDraftNames((previous) => ({
        ...previous,
        [created.id]: created.name ?? trimmedName,
      }));
      setNewAccountName("");
      setAccountsMessage("Akun pembayaran berhasil ditambahkan.");
    } catch (error) {
      setAccountsMessage(normalizeError(error, "Gagal menambahkan akun pembayaran."));
    } finally {
      setIsAddingAccount(false);
    }
  }

  async function handleRemovePaymentAccount(accountId) {
    setRemovingAccountId(accountId);
    setAccountsMessage("");

    try {
      await removePaymentAccount(accountId);
      setAccounts((previous) => previous.filter((account) => account.id !== accountId));
      setAccountDraftNames((previous) => {
        const next = { ...previous };
        delete next[accountId];
        return next;
      });
      setAccountsMessage("Akun pembayaran berhasil dihapus.");
      return true;
    } catch (error) {
      setAccountsMessage(normalizeError(error, "Gagal menghapus akun pembayaran."));
      return false;
    } finally {
      setRemovingAccountId("");
    }
  }

  async function handleSetDefaultPaymentAccount(accountId) {
    setSettingDefaultAccountId(accountId);
    setAccountsMessage("");

    try {
      const payload = await setDefaultPaymentAccount(accountId);
      const updated = payload?.data;

      setAccounts((previous) =>
        previous.map((account) => ({
          ...account,
          isDefault: account.id === accountId,
        })),
      );

      if (updated?.name) {
        setAccountsMessage(`Akun default diubah ke ${updated.name}.`);
      } else {
        setAccountsMessage("Akun default berhasil diperbarui.");
      }
    } catch (error) {
      setAccountsMessage(normalizeError(error, "Gagal memperbarui akun default."));
    } finally {
      setSettingDefaultAccountId("");
    }
  }

  if (isLoading) {
    return <LoadingState title="Memuat akun pembayaran..." description="Mohon tunggu sebentar." />;
  }

  return (
    <div className="grid gap-6">
      <section className="motion-enter-up rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-primary">
            <Wallet aria-hidden className="h-5 w-5" />
          </div>
          <div>
            <h2 className="su-type-section-title text-foreground">Akun pembayaran</h2>
            <p className="su-type-helper text-muted-foreground">Kelola sumber pembayaran yang dipakai saat mencatat transaksi.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="grid gap-2">
            <span className="su-type-ui text-foreground">Tambah akun pembayaran</span>
            <input
              type="text"
              value={newAccountName}
              onChange={(event) => setNewAccountName(event.target.value)}
              placeholder="Contoh: Bank BCA / QRIS"
              className="su-type-field h-11 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:ring-2 focus:ring-ring/20"
            />
          </label>

          <Button type="button" onClick={handleAddPaymentAccount} disabled={isAddingAccount} className="h-11 gap-2 px-4">
            <Plus aria-hidden className="h-4 w-4" />
            {isAddingAccount ? "Menambahkan..." : "Tambah"}
          </Button>
        </div>

        {accountsMessage ? <p className="su-type-helper mt-3 text-muted-foreground">{accountsMessage}</p> : null}
      </section>

      <section className="motion-enter-up rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="su-type-section-title text-foreground">Daftar akun aktif</h2>
            <p className="su-type-helper text-muted-foreground">Saldo ini dipakai untuk validasi uang masuk dan keluar.</p>
          </div>
          <span className="su-type-meta rounded-full bg-secondary px-3 py-1 text-primary">{accounts.length} akun</span>
        </div>

        <div className="mt-5 grid gap-4">
          {accounts.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-background p-5">
              <p className="su-type-helper text-muted-foreground">Belum ada akun pembayaran aktif.</p>
            </div>
          ) : null}

          {accounts.map((account) => (
            <article
              key={account.id}
              className={`group rounded-lg border p-5 ${
                account.isDefault ? "border-primary bg-primary/5" : "border-border bg-background"
              }`}
            >
              <div className="grid gap-5 lg:grid-cols-[minmax(14rem,0.9fr)_minmax(0,1fr)] lg:items-start">
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="su-type-meta text-muted-foreground">Saldo saat ini</p>
                    {account.isDefault ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                        <Star aria-hidden className="h-3.5 w-3.5" />
                        Default
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-3xl font-bold tracking-normal text-foreground md:text-4xl">
                    {currencyFormatter.format(account.currentBalance ?? 0)}
                  </p>
                  <p className="su-type-helper mt-2 text-muted-foreground">{account.name}</p>
                </div>

                <div className="grid gap-3">
                  <label className="grid gap-2">
                    <span className="su-type-ui text-foreground">Nama akun</span>
                    <input
                      type="text"
                      value={accountDraftNames[account.id] ?? ""}
                      onChange={(event) =>
                        setAccountDraftNames((previous) => ({
                          ...previous,
                          [account.id]: event.target.value,
                        }))
                      }
                      className="su-type-field h-11 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:ring-2 focus:ring-ring/20"
                    />
                  </label>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        savingAccountId === account.id ||
                        removingAccountId === account.id ||
                        settingDefaultAccountId === account.id
                      }
                      onClick={() => handleSavePaymentAccountName(account.id)}
                      className="h-11 gap-2 px-4"
                    >
                      <Save aria-hidden className="h-4 w-4" />
                      {savingAccountId === account.id ? "Menyimpan..." : "Simpan"}
                    </Button>

                    {!account.isDefault ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          savingAccountId === account.id ||
                          removingAccountId === account.id ||
                          settingDefaultAccountId === account.id
                        }
                        onClick={() => handleSetDefaultPaymentAccount(account.id)}
                        className="h-11 gap-2 px-4"
                      >
                        <Star aria-hidden className="h-4 w-4" />
                        {settingDefaultAccountId === account.id ? "Menyimpan..." : "Jadikan default"}
                      </Button>
                    ) : null}

                    {!account.isDefault ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          savingAccountId === account.id ||
                          removingAccountId === account.id ||
                          settingDefaultAccountId === account.id
                        }
                        onClick={() => setPendingDeleteAccountId(account.id)}
                        className="h-11 gap-2 px-4 text-danger hover:text-danger"
                      >
                        <Trash2 aria-hidden className="h-4 w-4" />
                        {removingAccountId === account.id ? "Menghapus..." : "Hapus"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {pageError ? (
        <section className="motion-enter-up rounded-lg border border-danger/40 bg-card p-4">
          <p className="su-type-helper text-danger">{pageError}</p>
        </section>
      ) : null}

      {pendingDeleteAccountId ? (
        <div className="motion-enter-up fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4">
          <section className="motion-enter-scale w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl">
            <h2 className="su-type-ui text-foreground">Hapus akun pembayaran?</h2>
            <p className="su-type-helper mt-2 text-muted-foreground">Akun ini akan dihapus dari daftar aktif.</p>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(removingAccountId)}
                onClick={() => setPendingDeleteAccountId("")}
                className="h-11 px-4"
              >
                Batal
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={Boolean(removingAccountId)}
                className="h-11 px-4"
                onClick={async () => {
                  const isSuccess = await handleRemovePaymentAccount(pendingDeleteAccountId);
                  if (isSuccess) {
                    setPendingDeleteAccountId("");
                  }
                }}
              >
                {removingAccountId === pendingDeleteAccountId ? "Menghapus..." : "Ya, hapus"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
