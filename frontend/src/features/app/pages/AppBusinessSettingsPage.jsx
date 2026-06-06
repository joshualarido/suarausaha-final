import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Building2, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/features/app/components/LoadingState";
import { useSession } from "@/features/auth/session-context";
import { ApiClientError } from "@/lib/api-client";
import { signOutUser } from "@/features/auth/auth.api";
import { debugResetOnboarding, getBusinessProfile, updateBusinessProfile } from "@/features/business/business.api";

function normalizeError(error, fallback) {
  if (error instanceof ApiClientError || error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}

export function AppBusinessSettingsPage() {
  const navigate = useNavigate();
  const session = useSession();
  const [isLoading, setIsLoading] = useState(true);
  const [businessName, setBusinessName] = useState("");
  const [savedBusinessName, setSavedBusinessName] = useState("");
  const [isSavingBusinessName, setIsSavingBusinessName] = useState(false);
  const [isDeletingBusiness, setIsDeletingBusiness] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [pageError, setPageError] = useState("");
  const [businessMessage, setBusinessMessage] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      setIsLoading(true);
      setPageError("");

      try {
        const businessPayload = await getBusinessProfile();
        if (!mounted) return;

        const name = businessPayload?.data?.name ?? "";
        setBusinessName(name);
        setSavedBusinessName(name);
      } catch (error) {
        if (!mounted) return;
        setPageError(normalizeError(error, "Gagal memuat data pengaturan usaha."));
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  const isBusinessNameChanged = useMemo(
    () => businessName.trim() !== "" && businessName.trim() !== savedBusinessName,
    [businessName, savedBusinessName],
  );

  async function handleSaveBusinessName() {
    const trimmedName = businessName.trim();

    if (!trimmedName) {
      setBusinessMessage("Nama usaha wajib diisi.");
      return;
    }

    setIsSavingBusinessName(true);
    setBusinessMessage("");

    try {
      const payload = await updateBusinessProfile(trimmedName);
      const nextName = payload?.data?.name ?? trimmedName;

      setBusinessName(nextName);
      setSavedBusinessName(nextName);
      setBusinessMessage("Nama usaha berhasil diperbarui.");
    } catch (error) {
      setBusinessMessage(normalizeError(error, "Gagal menyimpan nama usaha."));
    } finally {
      setIsSavingBusinessName(false);
    }
  }

  async function handleDeleteBusiness() {
    setIsDeletingBusiness(true);
    setDeleteMessage("");

    try {
      await debugResetOnboarding();
      await signOutUser();
      await session.refreshSession();
      navigate("/login", { replace: true });
    } catch (error) {
      setDeleteMessage(normalizeError(error, "Gagal menghapus bisnis. Coba lagi."));
      setIsDeletingBusiness(false);
    }
  }

  if (isLoading) {
    return <LoadingState title="Memuat pengaturan usaha..." description="Mohon tunggu sebentar." />;
  }

  return (
    <div className="grid gap-6">
      <section className="motion-enter-up rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-primary">
            <Building2 aria-hidden className="h-5 w-5" />
          </div>
          <div>
            <h2 className="su-type-section-title text-foreground">Profil usaha</h2>
            <p className="su-type-helper text-muted-foreground">Lihat dan ubah nama usaha kamu.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="grid gap-2">
            <span className="su-type-ui text-foreground">Nama usaha</span>
            <input
              type="text"
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              className="su-type-field h-11 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:ring-2 focus:ring-ring/20"
            />
          </label>

          <Button
            type="button"
            disabled={!isBusinessNameChanged || isSavingBusinessName}
            onClick={handleSaveBusinessName}
            className="h-11 gap-2 px-4"
          >
            <Save aria-hidden className="h-4 w-4" />
            {isSavingBusinessName ? "Menyimpan..." : "Simpan"}
          </Button>
        </div>

        {businessMessage ? <p className="su-type-helper mt-3 text-muted-foreground">{businessMessage}</p> : null}
      </section>

      {pageError ? (
        <section className="motion-enter-up rounded-lg border border-danger/40 bg-card p-4">
          <p className="su-type-helper text-danger">{pageError}</p>
        </section>
      ) : null}

      <section className="motion-enter-up rounded-lg border border-destructive/30 bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <AlertTriangle aria-hidden className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="su-type-section-title text-foreground">Zona berbahaya</h2>
            <p className="su-type-helper mt-1 text-muted-foreground">
              Hapus bisnis akan menghapus data usaha untuk akun ini dan mengembalikan kamu ke proses awal.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="su-type-helper text-muted-foreground">
            Gunakan ini hanya kalau kamu ingin mulai ulang data usaha.
          </p>
          <Button
            type="button"
            variant="destructive"
            disabled={isDeletingBusiness}
            onClick={() => setIsDeleteConfirmOpen(true)}
            className="h-11 gap-2 px-4"
          >
            <Trash2 aria-hidden className="h-4 w-4" />
            {isDeletingBusiness ? "Menghapus..." : "Hapus bisnis"}
          </Button>
        </div>

        {deleteMessage ? <p className="su-type-helper mt-3 text-destructive">{deleteMessage}</p> : null}
      </section>

      {isDeleteConfirmOpen ? (
        <div className="motion-enter-up fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4">
          <section className="motion-enter-scale w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl">
            <h2 className="su-type-ui text-foreground">Hapus bisnis?</h2>
            <p className="su-type-helper mt-2 text-muted-foreground">
              Data usaha saat ini akan dihapus lalu akun ini langsung logout.
            </p>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={isDeletingBusiness}
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="h-11 px-4"
              >
                Batal
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={isDeletingBusiness}
                className="h-11 gap-2 px-4"
                onClick={handleDeleteBusiness}
              >
                <Trash2 aria-hidden className="h-4 w-4" />
                {isDeletingBusiness ? "Menghapus..." : "Ya, hapus bisnis"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
