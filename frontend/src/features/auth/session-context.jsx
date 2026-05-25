import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiClientError, getBusinessProfile, getCurrentUser } from "@/lib/api-client";

const SessionContext = createContext(null);

const INITIAL_SESSION_STATE = {
  status: "loading",
  user: null,
  hasBusiness: false,
  businessId: null,
  businessName: null,
  onboardingStatus: null,
};

function normalizeAuthenticatedSession(userPayload, businessPayload) {
  const data = userPayload && typeof userPayload === "object" ? userPayload.data : null;
  const businessData = businessPayload && typeof businessPayload === "object" ? businessPayload.data : null;

  return {
    status: "authenticated",
    user: data
      ? {
          id: data.id,
          name: data.name,
          email: data.email,
        }
      : null,
    hasBusiness: Boolean(data?.hasBusiness),
    businessId: data?.businessId ?? null,
    businessName: businessData?.name ?? null,
    onboardingStatus: data?.onboardingStatus ?? null,
  };
}

function unauthenticatedSession() {
  return {
    status: "unauthenticated",
    user: null,
    hasBusiness: false,
    businessId: null,
    businessName: null,
    onboardingStatus: null,
  };
}

export function SessionProvider({ children }) {
  const [session, setSession] = useState(INITIAL_SESSION_STATE);

  const refreshSession = useCallback(async () => {
    setSession((previous) => ({
      ...previous,
      status: "loading",
    }));

    try {
      const [userPayload, businessPayload] = await Promise.all([
        getCurrentUser(),
        getBusinessProfile().catch(() => null),
      ]);
      setSession(normalizeAuthenticatedSession(userPayload, businessPayload));
      return;
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        setSession(unauthenticatedSession());
        return;
      }

      setSession(unauthenticatedSession());
      if (import.meta.env.DEV) {
        // Keep auth failures visible in local dev without crashing the app shell.
        console.error("Failed to resolve session state.", error);
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      try {
        const [userPayload, businessPayload] = await Promise.all([
          getCurrentUser(),
          getBusinessProfile().catch(() => null),
        ]);
        if (!mounted) return;
        setSession(normalizeAuthenticatedSession(userPayload, businessPayload));
      } catch (error) {
        if (!mounted) return;

        if (error instanceof ApiClientError && error.status === 401) {
          setSession(unauthenticatedSession());
          return;
        }

        setSession(unauthenticatedSession());
      }
    }

    loadSession();

    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo(
    () => ({
      ...session,
      refreshSession,
    }),
    [refreshSession, session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error("useSession must be used inside SessionProvider.");
  }

  return context;
}
