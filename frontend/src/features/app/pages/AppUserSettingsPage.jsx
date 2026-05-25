import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/session-context";
import { ApiClientError, updateCurrentUserProfile } from "@/lib/api-client";

export function AppUserSettingsPage() {
  const session = useSession();
  const [name, setName] = useState(session.user?.name ?? "");
  const [savedName, setSavedName] = useState(session.user?.name ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const email = session.user?.email ?? "";

  async function handleSave(event) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMessage("Nama pengguna wajib diisi.");
      return;
    }

    if (trimmedName === savedName) {
      setSuccessMessage("Tidak ada perubahan.");
      return;
    }

    setIsSaving(true);
    try {
      const payload = await updateCurrentUserProfile(trimmedName);
      const updatedName = payload?.data?.name ?? trimmedName;
      setName(updatedName);
      setSavedName(updatedName);
      setSuccessMessage("Nama pengguna berhasil diperbarui.");
      await session.refreshSession();
    } catch (error) {
      const fallback = "Gagal menyimpan perubahan pengguna.";
      const message =
        error instanceof ApiClientError || error instanceof Error ? error.message || fallback : fallback;
      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="motion-enter-up max-w-2xl rounded-lg border border-border bg-card p-5 md:p-6">
      <header>
        <h2 className="su-type-section-title text-foreground">Pengaturan Pengguna</h2>
        <p className="su-type-helper mt-1 text-muted-foreground">Lihat detail akun kamu dan ubah nama pengguna.</p>
      </header>

        <form onSubmit={handleSave} className="mt-6 grid gap-5">
          <div className="grid gap-2">
            <label htmlFor="user-email" className="su-type-ui text-foreground">
              Email
            </label>
            <input
              id="user-email"
              type="email"
              value={email}
              readOnly
              className="su-type-field h-11 rounded-md border border-border bg-background px-3 text-muted-foreground"
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="user-name" className="su-type-ui text-foreground">
              Nama Pengguna
            </label>
            <input
              id="user-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="su-type-field h-11 rounded-md border border-border bg-background px-3 text-foreground ring-0 transition outline-none focus:border-primary"
              placeholder="Masukkan nama pengguna"
            />
          </div>

          {errorMessage ? <p className="su-type-helper text-danger">{errorMessage}</p> : null}
          {successMessage ? <p className="su-type-helper text-success">{successMessage}</p> : null}

          <div className="ml-auto">
            <Button type="submit" disabled={isSaving} className="h-11 gap-2 px-4">
              {isSaving ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          </div>
        </form>
    </section>
  );
}
