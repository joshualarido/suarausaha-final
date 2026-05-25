import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Bell,
  Boxes,
  BookOpenText,
  Building2,
  ChevronDown,
  FileText,
  FlaskConical,
  HandCoins,
  History,
  Landmark,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/session-context";
import { ApiClientError, debugResetOnboarding, signOutUser } from "@/lib/api-client";
import { BrandLogo } from "./BrandLogo";

const navigationGroups = [
  {
    label: null,
    items: [
      { label: "Obrolan", href: "/app", icon: MessageSquare, end: true },
      { label: "Ringkasan", href: "/app/overview", icon: LayoutDashboard },
    ],
  },
  {
    label: "Bisnis",
    items: [
      { label: "Laporan", href: "/app/reports", icon: FileText },
      { label: "Stok", href: "/app/stock", icon: Boxes },
      { label: "Aset", href: "/app/assets", icon: Landmark },
      { label: "Liabilitas", href: "/app/liabilities", icon: HandCoins },
    ],
  },
  {
    label: "Pengaturan",
    items: [
      { label: "Pengaturan Bisnis", href: "/app/settings/business", icon: Building2 },
      { label: "Pengaturan Pengguna", href: "/app/settings/user", icon: User },
    ],
  },
];

const demoNotifications = [
  {
    id: "opening-balance",
    title: "Saldo awal siap",
    description: "Kas awal sudah menjadi titik mulai pencatatan.",
  },
  {
    id: "phase-two",
    title: "Berikutnya: chat",
    description: "Parser dan kartu konfirmasi akan masuk di fase berikutnya.",
  },
  {
    id: "report-reminder",
    title: "Laporan belum dibuat",
    description: "Neraca akan tersedia setelah data transaksi terkonfirmasi.",
  },
];

function getInitial(name) {
  return name?.trim()?.charAt(0)?.toUpperCase() || "U";
}

export function DashboardLayout() {
  const session = useSession();
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isResettingOnboarding, setIsResettingOnboarding] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isNotificationMenuOpen, setIsNotificationMenuOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const userInitial = useMemo(() => getInitial(session.user?.name), [session.user?.name]);
  const businessName = session.businessName ?? "Usaha Kamu";

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

  async function handleDebugResetOnboarding() {
    setIsResettingOnboarding(true);
    setErrorMessage("");

    try {
      await debugResetOnboarding();
      await signOutUser();
      await session.refreshSession();
      navigate("/login", { replace: true });
      return true;
    } catch (error) {
      const fallback = "Gagal reset onboarding debug. Coba lagi.";
      const message =
        error instanceof ApiClientError || error instanceof Error ? error.message || fallback : fallback;
      setErrorMessage(message);
      setIsResettingOnboarding(false);
      return false;
    }
  }

  return (
    <main className="h-[100dvh] overflow-hidden bg-background text-foreground">
      <div className="grid h-full min-h-0 lg:grid-cols-[264px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-screen border-r border-border bg-card px-4 py-6 lg:flex lg:flex-col">
          <BrandLogo />

          <nav className="mt-12 grid gap-6" aria-label="Navigasi aplikasi">
            {navigationGroups.map((group, groupIndex) => (
              <section key={group.label ?? "top"} className="grid gap-2">
                {group.label ? (
                  <p className="su-type-meta px-3 text-muted-foreground">
                    {group.label}
                  </p>
                ) : null}

                {group.items.map((item) => {
                  const Icon = item.icon;

                  return (
                    <NavLink
                      key={item.href}
                      to={item.href}
                      end={item.end}
                      className={({ isActive }) =>
                        [
                          "su-type-ui flex h-11 items-center gap-2.5 rounded-lg px-3 transition",
                          isActive
                            ? "bg-secondary text-primary shadow-[0_10px_28px_rgba(54,92,145,0.12)]"
                            : "text-muted-foreground hover:bg-background hover:text-foreground",
                        ].join(" ")
                      }
                    >
                      <Icon aria-hidden className="h-5 w-5" />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}

                {groupIndex === 0 ? <div className="border-t border-border" /> : null}
              </section>
            ))}
          </nav>

          <section className="relative mt-auto">
            {isProfileMenuOpen ? (
              <div
                className="motion-enter-up absolute right-0 bottom-[calc(100%+0.5rem)] left-0 z-20 rounded-lg border border-border bg-card p-3 shadow-lg"
                role="menu"
              >
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="h-11 w-full justify-start gap-2 rounded-md px-3"
                >
                  <LogOut aria-hidden className="h-4 w-4" />
                  {isSigningOut ? "Keluar..." : "Keluar"}
                </Button>
                {errorMessage ? (
                  <p className="su-type-helper mt-2 text-danger" role="alert">
                    {errorMessage}
                  </p>
                ) : null}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => setIsProfileMenuOpen((previous) => !previous)}
              className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left shadow-sm hover:bg-background"
              aria-expanded={isProfileMenuOpen}
              aria-haspopup="menu"
            >
              <div className="su-type-ui flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                {userInitial}
              </div>
              <div className="min-w-0 flex-1">
                <p className="su-type-ui truncate text-foreground">{session.user?.name ?? "User"}</p>
                <p className="su-type-helper truncate text-muted-foreground">{session.user?.email ?? "-"}</p>
              </div>
              <ChevronDown
                aria-hidden
                className={["h-4 w-4 text-muted-foreground transition-transform", isProfileMenuOpen ? "rotate-180" : ""].join(" ")}
              />
            </button>
          </section>
        </aside>

        <section className="flex min-h-0 h-full flex-col overflow-hidden px-4 py-6 md:px-8 lg:px-10">
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-8 lg:hidden">
                <BrandLogo />
              </div>
              <h1 className="su-type-page-title truncate text-foreground">{businessName}</h1>
              <p className="su-type-page-subtitle mt-2 text-muted-foreground">Catat transaksi usaha lewat chat.</p>
            </div>

            <div className="relative flex items-center gap-2">
              <button
                type="button"
                aria-label="Notifikasi"
                aria-expanded={isNotificationMenuOpen}
                onClick={() => setIsNotificationMenuOpen((previous) => !previous)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-card hover:text-foreground"
              >
                <Bell aria-hidden className="h-6 w-6" />
              </button>

              <button
                type="button"
                aria-label="Riwayat"
                onClick={() => navigate("/app/history")}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-card hover:text-foreground"
              >
                <History aria-hidden className="h-6 w-6" />
              </button>

              {isNotificationMenuOpen ? (
                <section className="motion-enter-up absolute top-[calc(100%+0.75rem)] right-0 z-30 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-4 text-left shadow-lg">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="su-type-ui text-foreground">Notifikasi terbaru</h2>
                    <BookOpenText aria-hidden className="h-4 w-4 text-muted-foreground" />
                  </div>

                  <div className="mt-3 grid gap-3">
                    {demoNotifications.map((notification) => (
                      <article key={notification.id} className="rounded-md bg-background p-3">
                        <h3 className="su-type-ui text-foreground">{notification.title}</h3>
                        <p className="su-type-helper mt-1 text-muted-foreground">
                          {notification.description}
                        </p>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </header>

          <div className="mt-10 min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </div>
        </section>
      </div>

      {import.meta.env.DEV ? (
        <Button
          type="button"
          variant="destructive"
          disabled={isResettingOnboarding}
          onClick={() => setIsResetConfirmOpen(true)}
          className="fixed right-4 bottom-4 z-50 h-11 gap-2 rounded-full px-4 shadow-lg md:right-6 md:bottom-6"
        >
          <FlaskConical aria-hidden className="h-4 w-4" />
          {isResettingOnboarding ? "Reset..." : "Reset Onboarding"}
        </Button>
      ) : null}

      {isResetConfirmOpen ? (
        <div className="motion-enter-up fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4">
          <section className="motion-enter-scale w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl">
            <h2 className="su-type-ui text-foreground">Reset onboarding?</h2>
            <p className="su-type-helper mt-2 text-muted-foreground">
              Data usaha saat ini akan dihapus lalu akun ini langsung logout. Ini khusus untuk debugging.
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isResettingOnboarding}
                onClick={() => setIsResetConfirmOpen(false)}
                className="h-11 px-4"
              >
                Batal
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={isResettingOnboarding}
                className="h-11 px-4"
                onClick={async () => {
                  const isSuccess = await handleDebugResetOnboarding();
                  if (isSuccess) {
                    setIsResetConfirmOpen(false);
                  }
                }}
              >
                {isResettingOnboarding ? "Reset..." : "Ya, reset"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
