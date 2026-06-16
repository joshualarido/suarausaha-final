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
  HandCoins,
  History,
  ListChecks,
  Landmark,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Moon,
  PanelLeftClose,
  Sun,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/session-context";
import { useTheme } from "@/features/app/theme-context";
import { ApiClientError, APP_NOTIFICATION_EVENT } from "@/lib/api-client";
import { signOutUser } from "@/features/auth/auth.api";
import { BrandLogo } from "./BrandLogo";
import { ProductTourOverlay } from "./ProductTourOverlay";

const TOUR_HELP_EVENT = "suarausaha:tour-help-cta";

const navigationGroups = [
  {
    label: null,
    items: [
      { label: "Sura", href: "/app", icon: MessageSquare, end: true },
    ],
  },
  {
    label: "Bisnis",
    items: [
      { label: "Neraca", href: "/app/reports", icon: FileText },
      { label: "Transaksi", href: "/app/transactions", icon: Banknote },
      { label: "Stok", href: "/app/stock", icon: Boxes },
      { label: "Aset", href: "/app/assets", icon: Landmark },
      { label: "Utang", href: "/app/liabilities", icon: HandCoins },
      { label: "Piutang", href: "/app/receivables", icon: BookOpenText },
    ],
  },
  {
    label: "Pengaturan",
    items: [
      { label: "Bisnis", href: "/app/settings/business", icon: Building2 },
      { label: "Akun pembayaran", href: "/app/settings/payment-accounts", icon: Wallet },
      { label: "Katalog", href: "/app/settings/catalog", icon: ListChecks },
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
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isNotificationMenuOpen, setIsNotificationMenuOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [activeNotifications, setActiveNotifications] = useState([]);
  const [notificationQueue, setNotificationQueue] = useState([]);
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now());
  const notificationTimeoutRef = useRef(new Map());
  const closingNotificationRef = useRef(new Set());
  const touchStartRef = useRef(null);

  const userInitial = useMemo(() => getInitial(session.user?.name), [session.user?.name]);
  const businessName = session.businessName ?? "Usaha Kamu";
  const isChatRoute = location.pathname === "/app";
  const shouldShowProductTour = session.hasCompletedProductTour === false;
  const breadcrumbs = useMemo(() => {
    const pathToLabel = {
      app: "Sura",
      reports: "Neraca",
      menu: "Katalog",
      katalog: "Katalog",
      catalog: "Katalog",
      "payment-accounts": "Akun pembayaran",
      stock: "Stok",
      assets: "Aset",
      liabilities: "Utang",
      receivables: "Piutang",
      transactions: "Transaksi",
      settings: "Pengaturan",
      business: "Bisnis",
      user: "Pengguna",
      history: "Riwayat",
    };
    const bisnisSections = new Set(["reports", "transactions", "stock", "assets", "liabilities", "receivables"]);
    const segments = location.pathname.split("/").filter(Boolean).slice(1);
    if (segments.length === 0) {
      return ["Sura"];
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

  function handleTouchStart(event) {
    const touch = event.touches?.[0];
    if (!touch) return;
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  }

  function handleTouchEnd(event) {
    const start = touchStartRef.current;
    const touch = event.changedTouches?.[0];
    touchStartRef.current = null;
    if (!start || !touch) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaY) > 70 || Math.abs(deltaX) < 70) return;

    if (!isMobileSidebarOpen && start.x <= 32 && deltaX > 0) {
      setIsMobileSidebarOpen(true);
    }

    if (isMobileSidebarOpen && deltaX < 0) {
      setIsMobileSidebarOpen(false);
    }
  }

  function renderSidebarContent({ isCollapsed = false, isMobile = false } = {}) {
    return (
      <>
        <div className="flex min-h-16 items-center justify-between gap-2 border-b border-border px-4 py-4">
          {isCollapsed ? (
            <span className="text-lg font-bold text-primary">SU</span>
          ) : (
            <BrandLogo />
          )}
          {isMobile ? (
            <button
              type="button"
              aria-label="Tutup navigasi"
              onClick={() => setIsMobileSidebarOpen(false)}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <X aria-hidden className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              aria-label={isCollapsed ? "Buka sidebar" : "Ciutkan sidebar"}
              onClick={() => setIsSidebarCollapsed((previous) => !previous)}
              className="hidden h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-background hover:text-foreground md:flex"
            >
              <PanelLeftClose
                aria-hidden
                className={["h-5 w-5 transition-transform", isCollapsed ? "rotate-180" : ""].join(" ")}
              />
            </button>
          )}
        </div>

        <div className="su-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-5">
          <nav className="grid gap-5" aria-label="Navigasi aplikasi">
            {navigationGroups.map((group, groupIndex) => {
              const tourTarget =
                group.label === "Bisnis" ? "sidebar-business" : group.label === "Pengaturan" ? "sidebar-settings" : undefined;

              return (
                <section key={group.label ?? "top"} className="grid gap-2" data-tour-target={tourTarget}>
                  {group.label && !isCollapsed ? (
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
                        title={isCollapsed ? item.label : undefined}
                        onClick={() => {
                          if (isMobile) setIsMobileSidebarOpen(false);
                        }}
                        className={({ isActive }) =>
                          [
                            "su-type-ui flex h-11 items-center gap-2.5 rounded-lg transition",
                            isCollapsed ? "justify-center px-0" : "px-3",
                            isActive
                              ? "bg-secondary text-primary shadow-[0_10px_28px_rgba(54,92,145,0.12)]"
                              : "text-muted-foreground hover:bg-background hover:text-foreground",
                          ].join(" ")
                        }
                      >
                        <Icon aria-hidden className="h-5 w-5 shrink-0" />
                        {!isCollapsed ? <span className="truncate">{item.label}</span> : null}
                      </NavLink>
                    );
                  })}

                  {groupIndex === 0 ? <div className="border-t border-border" /> : null}
                </section>
              );
            })}
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
              className={[
                "flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left shadow-sm hover:bg-background",
                isCollapsed ? "justify-center" : "",
              ].join(" ")}
              aria-expanded={isProfileMenuOpen}
              aria-haspopup="menu"
            >
              <div className="su-type-ui flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                {userInitial}
              </div>
              {!isCollapsed ? (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="su-type-ui truncate text-foreground">{session.user?.name ?? "User"}</p>
                    <p className="su-type-helper truncate text-muted-foreground">{session.user?.email ?? "-"}</p>
                  </div>
                  <ChevronDown
                    aria-hidden
                    className={["h-4 w-4 text-muted-foreground transition-transform", isProfileMenuOpen ? "rotate-180" : ""].join(" ")}
                  />
                </>
              ) : null}
            </button>
          </section>
        </div>
      </>
    );
  }

  return (
    <main
      className="h-[100dvh] overflow-hidden bg-background text-foreground"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="flex h-full min-h-0">
        <aside
          className={[
            "sticky top-0 hidden h-screen min-h-0 shrink-0 border-r border-border bg-card transition-[width] duration-200 md:flex md:flex-col",
            isSidebarCollapsed ? "w-[84px]" : "w-[264px]",
          ].join(" ")}
        >
          {renderSidebarContent({ isCollapsed: isSidebarCollapsed })}
        </aside>

        {isMobileSidebarOpen ? (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              aria-label="Tutup navigasi"
              className="absolute inset-0 h-full w-full bg-black/35"
              onClick={() => setIsMobileSidebarOpen(false)}
            />
            <aside className="motion-enter-left relative z-10 flex h-full w-[min(20rem,86vw)] flex-col border-r border-border bg-card shadow-2xl">
              {renderSidebarContent({ isMobile: true })}
            </aside>
          </div>
        ) : null}

        <section className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <header className="sticky top-0 z-20 border-b border-border bg-card px-3 py-3 shadow-sm sm:px-4 md:px-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  aria-label="Buka navigasi"
                  aria-expanded={isMobileSidebarOpen}
                  onClick={() => setIsMobileSidebarOpen(true)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-primary hover:bg-secondary md:hidden"
                >
                  <LayoutDashboard aria-hidden className="h-5 w-5" />
                </button>
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
                  aria-label={isDark ? "Aktifkan mode terang" : "Aktifkan mode gelap"}
                  onClick={toggleTheme}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-card hover:text-foreground"
                >
                  {isDark ? <Sun aria-hidden className="h-5 w-5" /> : <Moon aria-hidden className="h-5 w-5" />}
                </button>

                <button
                  type="button"
                  aria-label="Notifikasi"
                  aria-expanded={isNotificationMenuOpen}
                  onClick={() => setIsNotificationMenuOpen((previous) => !previous)}
                  className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-card hover:text-foreground"
                >
                  <Bell aria-hidden className="h-6 w-6" />
                  {notificationQueue.length > 0 ? (
                    <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-danger-foreground shadow-sm">
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
                              className="h-1 rounded-full bg-danger transition-[width] duration-100 ease-linear"
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
            <div className="min-h-0 flex-1 overflow-hidden sm:px-4 sm:py-4 md:px-6">
              <Outlet />
            </div>
          ) : (
            <div className="su-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              <div className="pb-4 md:pb-6">
                <Outlet />
              </div>
            </div>
          )}
        </section>
      </div>

      {shouldShowProductTour ? (
        <ProductTourOverlay
          onCompleted={session.refreshSession}
          onFinalAction={() => {
            navigate("/app");
            window.setTimeout(() => {
              window.dispatchEvent(new CustomEvent(TOUR_HELP_EVENT));
            }, 80);
          }}
        />
      ) : null}

    </main>
  );
}

export { TOUR_HELP_EVENT };
