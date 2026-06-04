import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Banknote,
  Bell,
  Boxes,
  BookOpenText,
  Building2,
  ChevronDown,
  FileText,
  FlaskConical,
  HandCoins,
  History,
  ListChecks,
  Landmark,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/session-context";
import { ApiClientError, APP_NOTIFICATION_EVENT } from "@/lib/api-client";
import { signOutUser } from "@/features/auth/auth.api";
import { debugResetOnboarding } from "@/features/business/business.api";
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
      { label: "Transaksi", href: "/app/transactions", icon: Banknote },
      { label: "Katalog", href: "/app/catalog", icon: ListChecks },
      { label: "Stok", href: "/app/stock", icon: Boxes },
      { label: "Aset", href: "/app/assets", icon: Landmark },
      { label: "Liabilitas", href: "/app/liabilities", icon: HandCoins },
      { label: "Piutang", href: "/app/receivables", icon: BookOpenText },
    ],
  },
  {
    label: "Pengaturan",
    items: [
      { label: "Bisnis", href: "/app/settings/business", icon: Building2 },
    ],
  },
];

const DEFAULT_NOTIFICATION_DURATION_MS = 7000;
const NOTIFICATION_TICK_MS = 120;
const NOTIFICATION_DISMISS_ANIMATION_MS = 220;
const NOTIFICATION_QUEUE_LIMIT = 5;

function toRemainingPercent(expiresAt, createdAt, nowTimestamp, durationMs) {
  if (durationMs <= 0) return 0;
  const elapsed = Math.max(0, nowTimestamp - createdAt);
  const ratio = Math.max(0, Math.min(1, 1 - elapsed / durationMs));
  return ratio * 100;
}

function getInitial(name) {
  return name?.trim()?.charAt(0)?.toUpperCase() || "U";
}

export function DashboardLayout() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isResettingOnboarding, setIsResettingOnboarding] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isNotificationMenuOpen, setIsNotificationMenuOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [activeNotifications, setActiveNotifications] = useState([]);
  const [notificationQueue, setNotificationQueue] = useState([]);
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now());
  const notificationTimeoutRef = useRef(new Map());
  const closingNotificationRef = useRef(new Set());

  const userInitial = useMemo(() => getInitial(session.user?.name), [session.user?.name]);
  const businessName = session.businessName ?? "Usaha Kamu";
  const isChatRoute = location.pathname === "/app";
  const breadcrumbs = useMemo(() => {
    const pathToLabel = {
      app: "Obrolan",
      overview: "Overview",
      reports: "Laporan",
      menu: "Katalog",
      katalog: "Katalog",
      stock: "Stok",
      assets: "Aset",
      liabilities: "Liabilitas",
      receivables: "Piutang",
      transactions: "Transaksi",
      settings: "Pengaturan",
      business: "Bisnis",
      user: "Pengguna",
      history: "Riwayat",
    };
    const bisnisSections = new Set(["reports", "transactions", "catalog", "menu", "stock", "assets", "liabilities", "receivables"]);
    const segments = location.pathname.split("/").filter(Boolean).slice(1);
    if (segments.length === 0) {
      return ["Obrolan"];
    }
    if (bisnisSections.has(segments[0])) {
      return ["Bisnis", pathToLabel[segments[0]] ?? segments[0]];
    }
    return segments.map((segment) => pathToLabel[segment] ?? segment);
  }, [location.pathname]);

  function finalizeRemoveNotification(notificationId) {
    const timeoutHandle = notificationTimeoutRef.current.get(notificationId);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      notificationTimeoutRef.current.delete(notificationId);
    }

    closingNotificationRef.current.delete(notificationId);
    setActiveNotifications((previous) => previous.filter((notification) => notification.id !== notificationId));
  }

  function removeNotification(notificationId) {
    if (closingNotificationRef.current.has(notificationId)) return;
    closingNotificationRef.current.add(notificationId);

    setActiveNotifications((previous) =>
      previous.map((notification) =>
        notification.id === notificationId ? { ...notification, isClosing: true, expiresAt: Date.now() } : notification,
      ),
    );

    setTimeout(() => {
      finalizeRemoveNotification(notificationId);
    }, NOTIFICATION_DISMISS_ANIMATION_MS);
  }

  function addNotification(notificationInput) {
    const durationMs = Math.max(2000, Number(notificationInput?.durationMs ?? DEFAULT_NOTIFICATION_DURATION_MS));
    const createdAt = Date.now();
    const notificationId =
      notificationInput?.id && typeof notificationInput.id === "string" ? notificationInput.id : crypto.randomUUID();

    const notification = {
      id: notificationId,
      title: typeof notificationInput?.title === "string" && notificationInput.title.trim()
        ? notificationInput.title.trim()
        : "Proses selesai",
      description: typeof notificationInput?.description === "string" && notificationInput.description.trim()
        ? notificationInput.description.trim()
        : "Proses berhasil dijalankan.",
      createdAt,
      durationMs,
      expiresAt: createdAt + durationMs,
      isClosing: false,
    };

    setActiveNotifications((previous) => [notification, ...previous].slice(0, NOTIFICATION_QUEUE_LIMIT));
    setNotificationQueue((previous) => {
      const next = [notification, ...previous];
      return next.slice(0, NOTIFICATION_QUEUE_LIMIT);
    });

    const timeoutHandle = setTimeout(() => {
      removeNotification(notificationId);
    }, durationMs);

    notificationTimeoutRef.current.set(notificationId, timeoutHandle);
  }

  useEffect(() => {
    function handleNotificationEvent(event) {
      const detail = event?.detail && typeof event.detail === "object" ? event.detail : {};
      addNotification(detail);
    }

    window.addEventListener(APP_NOTIFICATION_EVENT, handleNotificationEvent);
    return () => {
      window.removeEventListener(APP_NOTIFICATION_EVENT, handleNotificationEvent);
    };
  }, []);

  useEffect(() => {
    if (activeNotifications.length === 0) return;

    const timer = setInterval(() => {
      setNowTimestamp(Date.now());
    }, NOTIFICATION_TICK_MS);

    return () => {
      clearInterval(timer);
    };
  }, [activeNotifications.length]);

  function removeNotificationFromQueue(notificationId) {
    setNotificationQueue((previous) => previous.filter((notification) => notification.id !== notificationId));
    removeNotification(notificationId);
  }

  useEffect(() => {
    return () => {
      notificationTimeoutRef.current.forEach((timeoutHandle) => {
        clearTimeout(timeoutHandle);
      });
      notificationTimeoutRef.current.clear();
    };
  }, []);

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
        <aside className="sticky top-0 hidden h-screen min-h-0 border-r border-border bg-card lg:flex lg:flex-col">
          <div className="border-b border-border px-4 py-4">
            <BrandLogo />
          </div>

          <div className="su-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6">
            <nav className="grid gap-6" aria-label="Navigasi aplikasi">
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
                            "su-type-ui flex h-11 items-center gap-2.5 rounded-lg px-6 transition",
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

            <section className="relative mt-auto pt-6">
              {isProfileMenuOpen ? (
                <div
                  className="motion-enter-up absolute right-0 bottom-full left-0 z-20 mb-1 rounded-lg border border-border bg-card p-3 shadow-lg"
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
          </div>
        </aside>

        <section className="flex min-h-0 h-full flex-col overflow-hidden">
          <header className="sticky top-0 z-20 border-b border-l border-border bg-card px-4 py-4 shadow-sm md:px-6">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-4 lg:hidden">
                  <BrandLogo />
                </div>
                <p className="su-type-ui truncate text-foreground">
                  <span className="font-semibold">{businessName}</span>
                  {breadcrumbs.length > 0 ? (
                    <span className="ml-2 text-muted-foreground">/ {breadcrumbs.join(" / ")}</span>
                  ) : null}
                </p>
              </div>

              <div className="relative flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Notifikasi"
                  aria-expanded={isNotificationMenuOpen}
                  onClick={() => setIsNotificationMenuOpen((previous) => !previous)}
                  className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-card hover:text-foreground"
                >
                  <Bell aria-hidden className="h-6 w-6" />
                  {notificationQueue.length > 0 ? (
                    <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                      {notificationQueue.length > 9 ? "9+" : notificationQueue.length}
                    </span>
                  ) : null}
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
                      {notificationQueue.length === 0 ? (
                        <article className="rounded-md bg-background p-3">
                          <p className="su-type-helper text-muted-foreground">Belum ada notifikasi baru.</p>
                        </article>
                      ) : (
                        notificationQueue.map((notification) => {
                          return (
                            <article
                              key={notification.id}
                              className={[
                                "relative overflow-hidden rounded-md bg-background p-3 pb-4 transition-all duration-200",
                                "translate-y-0 scale-100 opacity-100",
                              ].join(" ")}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <h3 className="su-type-ui text-foreground">{notification.title}</h3>
                                <button
                                  type="button"
                                  aria-label="Tutup notifikasi"
                                  className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
                                  onClick={() => removeNotificationFromQueue(notification.id)}
                                >
                                  <X aria-hidden className="h-4 w-4" />
                                </button>
                              </div>
                              <p className="su-type-helper mt-1 text-muted-foreground">{notification.description}</p>
                            </article>
                          );
                        })
                      )}
                    </div>
                  </section>
                ) : null}

                {activeNotifications.length > 0 ? (
                  <section className="pointer-events-none absolute top-[calc(100%+0.75rem)] right-0 z-20 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
                    {activeNotifications.slice(0, NOTIFICATION_QUEUE_LIMIT).map((notification) => {
                      const remainingPercent = toRemainingPercent(
                        notification.expiresAt,
                        notification.createdAt,
                        nowTimestamp,
                        notification.durationMs,
                      );

                      return (
                        <article
                          key={notification.id}
                          className={[
                            "pointer-events-auto relative overflow-hidden rounded-lg border border-border bg-card p-3 pb-4 shadow-lg transition-all duration-200",
                            notification.isClosing ? "translate-y-1 scale-[0.98] opacity-0" : "translate-y-0 scale-100 opacity-100",
                          ].join(" ")}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="su-type-ui truncate text-foreground">{notification.title}</h3>
                              <p className="su-type-helper mt-1 text-muted-foreground">{notification.description}</p>
                            </div>
                            <button
                              type="button"
                              aria-label="Tutup notifikasi"
                              className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                              onClick={() => removeNotification(notification.id)}
                            >
                              <X aria-hidden className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="pointer-events-none absolute right-0 bottom-0 left-0 overflow-hidden bg-border/70">
                            <div
                              className="h-1 rounded-full bg-primary transition-[width] duration-100 ease-linear"
                              style={{ width: `${remainingPercent}%` }}
                            />
                          </div>
                        </article>
                      );
                    })}
                  </section>
                ) : null}
              </div>
            </div>
          </header>

          {isChatRoute ? (
            <div className="min-h-0 flex-1 overflow-hidden px-4 py-4 md:px-6">
              <Outlet />
            </div>
          ) : (
            <div className="su-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
              <div className="pb-4 md:pb-6">
                <Outlet />
              </div>
            </div>
          )}
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
