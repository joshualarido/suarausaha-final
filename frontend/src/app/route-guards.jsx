import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSession } from "@/features/auth/session-context";

function LoadingGate() {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <section className="mx-auto w-full max-w-lg rounded-lg border border-border bg-card p-6">
        <h1 className="text-lg font-semibold">Memuat sesi...</h1>
        <p className="mt-2 text-sm text-muted-foreground">Mohon tunggu sebentar.</p>
      </section>
    </main>
  );
}

function resolveAuthenticatedLanding(session) {
  if (!session.hasBusiness) {
    return "/onboarding/business";
  }

  if (session.onboardingStatus !== "active") {
    return "/onboarding/opening-balance";
  }

  return "/app";
}

export function RootRedirect() {
  const session = useSession();

  if (session.status === "loading") {
    return <LoadingGate />;
  }

  if (session.status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={resolveAuthenticatedLanding(session)} replace />;
}

export function ProtectedRoute() {
  const session = useSession();
  const location = useLocation();

  if (session.status === "loading") {
    return <LoadingGate />;
  }

  if (session.status === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

export function PublicOnlyRoute() {
  const session = useSession();

  if (session.status === "loading") {
    return <LoadingGate />;
  }

  if (session.status === "authenticated") {
    return <Navigate to={resolveAuthenticatedLanding(session)} replace />;
  }

  return <Outlet />;
}

export function OnboardingRouteGate() {
  const session = useSession();
  const location = useLocation();

  if (session.status !== "authenticated") {
    return <Navigate to="/login" replace />;
  }

  if (!session.hasBusiness) {
    if (location.pathname !== "/onboarding/business") {
      return <Navigate to="/onboarding/business" replace />;
    }
    return <Outlet />;
  }

  if (session.onboardingStatus !== "active") {
    if (location.pathname !== "/onboarding/opening-balance") {
      return <Navigate to="/onboarding/opening-balance" replace />;
    }
    return <Outlet />;
  }

  return <Navigate to="/app" replace />;
}

export function ActiveBusinessRoute({ children }) {
  const session = useSession();

  if (session.status !== "authenticated") {
    return <Navigate to="/login" replace />;
  }

  if (!session.hasBusiness) {
    return <Navigate to="/onboarding/business" replace />;
  }

  if (session.onboardingStatus !== "active") {
    return <Navigate to="/onboarding/opening-balance" replace />;
  }

  return children;
}
