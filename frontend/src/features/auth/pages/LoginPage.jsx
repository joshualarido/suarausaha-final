import { useState } from "react";
import { FcGoogle } from "react-icons/fc";
import { FiLock, FiShield } from "react-icons/fi";
import { Button } from "@/components/ui/button";
import { ApiClientError, startGoogleSignIn } from "@/lib/api-client";

function BrandLogo() {
  return (
    <div className="flex items-center gap-3">
      <div
        aria-hidden
        className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground shadow-sm"
      >
        ru
      </div>
      <span className="text-2xl font-bold tracking-tight text-primary">SuaraUsaha</span>
    </div>
  );
}

export function LoginPage() {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleGoogleSignIn() {
    setIsSigningIn(true);
    setErrorMessage("");

    try {
      await startGoogleSignIn("/onboarding/business");
    } catch (error) {
      const fallback = "Gagal memulai login Google. Coba lagi.";
      const message =
        error instanceof ApiClientError || error instanceof Error ? error.message || fallback : fallback;
      setErrorMessage(message);
      setIsSigningIn(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl flex-col items-center justify-center">
        <section className="grid w-full grid-cols-1 overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:grid-cols-2">
          <div className="flex flex-col gap-8 p-8 md:p-12">
            <BrandLogo />

            <div className="space-y-4">
              <h1 className="text-2xl leading-tight font-bold text-foreground md:text-3xl">
                Catat transaksi usaha
                <br />
                lewat chat, semudah ngobrol.
              </h1>
              <p className="text-base leading-relaxed text-muted-foreground">
                Aplikasi pembukuan sederhana untuk warung makan dan UMKM makanan.
              </p>
            </div>

            <div className="mt-auto flex items-center gap-3 rounded-xl bg-secondary/50 p-4">
              <FiShield aria-hidden className="h-5 w-5 shrink-0 text-primary" />
              <p className="text-sm leading-relaxed text-foreground/80">
                Data usaha kamu aman dan hanya bisa diakses oleh akun kamu.
              </p>
            </div>
          </div>

          <div className="flex flex-col justify-center gap-6 border-t border-border p-8 md:border-t-0 md:border-l md:p-12">
            <div className="space-y-2 text-center">
              <h2 className="text-2xl font-bold text-foreground">Masuk ke SuaraUsaha</h2>
              <p className="text-sm text-muted-foreground">Mulai catat transaksi usaha kamu.</p>
            </div>

            <Button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isSigningIn}
              variant="outline"
              className="h-11 w-full justify-center gap-3 rounded-xl px-4 text-sm font-semibold"
            >
              <FcGoogle aria-hidden className="h-5 w-5" />
              {isSigningIn ? "Mengarahkan ke Google..." : "Masuk dengan Google"}
            </Button>

            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <FiLock aria-hidden className="h-3.5 w-3.5" />
              <span>Kami tidak akan memposting apa pun ke Google.</span>
            </div>

            {errorMessage ? (
              <p className="text-center text-sm text-danger" role="alert">
                {errorMessage}
              </p>
            ) : null}
          </div>
        </section>

        <footer className="mt-8 flex w-full flex-col items-center justify-between gap-3 px-2 text-xs text-muted-foreground sm:flex-row">
          <p>© 2026 SuaraUsaha. Semua hak dilindungi.</p>
          <div className="flex items-center gap-4">
            <a href="#" className="hover:text-foreground">
              Privasi
            </a>
            <span aria-hidden className="text-border">
              |
            </span>
            <a href="#" className="hover:text-foreground">
              Ketentuan
            </a>
          </div>
        </footer>
      </div>
    </main>
  );
}
