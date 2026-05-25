import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import {
  ActiveBusinessRoute,
  OnboardingRouteGate,
  ProtectedRoute,
  PublicOnlyRoute,
  RootRedirect,
} from "@/app/route-guards";
import { DashboardLayout } from "@/features/app/components/DashboardLayout";
import { AppAssetsPage } from "@/features/app/pages/AppAssetsPage";
import { AppBusinessSettingsPage } from "@/features/app/pages/AppBusinessSettingsPage";
import { AppCatalogPage } from "@/features/app/pages/AppCatalogPage";
import { AppChatPage } from "@/features/app/pages/AppChatPage";
import { AppHistoryPage } from "@/features/app/pages/AppHistoryPage";
import { AppLiabilitiesPage } from "@/features/app/pages/AppLiabilitiesPage";
import { AppOverviewPage } from "@/features/app/pages/AppOverviewPage";
import { AppReceivablesPage } from "@/features/app/pages/AppReceivablesPage";
import { AppReportsPage } from "@/features/app/pages/AppReportsPage";
import { AppStockPage } from "@/features/app/pages/AppStockPage";
import { AppTransactionsPage } from "@/features/app/pages/AppTransactionsPage";
import { LoginPage } from "@/features/auth/pages/LoginPage";
import { ApiTesterPage } from "@/features/docs/ApiTesterPage";
import { OnboardingBusinessPage } from "@/features/onboarding/pages/OnboardingBusinessPage";

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/docs" element={<ApiTesterPage />} />

        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<LoginPage />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route element={<OnboardingRouteGate />}>
            <Route path="/onboarding/business" element={<OnboardingBusinessPage />} />
            <Route path="/onboarding/opening-balance" element={<OnboardingBusinessPage />} />
          </Route>

          <Route
            path="/app"
            element={
              <ActiveBusinessRoute>
                <DashboardLayout />
              </ActiveBusinessRoute>
            }
          >
            <Route index element={<AppChatPage />} />
            <Route path="overview" element={<AppOverviewPage />} />
            <Route path="reports" element={<AppReportsPage />} />
            <Route path="catalog" element={<AppCatalogPage />} />
            <Route path="stock" element={<AppStockPage />} />
            <Route path="assets" element={<AppAssetsPage />} />
            <Route path="liabilities" element={<AppLiabilitiesPage />} />
            <Route path="receivables" element={<AppReceivablesPage />} />
            <Route path="settings/business" element={<AppBusinessSettingsPage />} />
            <Route path="history" element={<AppHistoryPage />} />
            <Route path="transactions" element={<AppTransactionsPage />} />
            <Route path="menu" element={<Navigate to="/app/catalog" replace />} />
            <Route path="neraca" element={<Navigate to="/app/reports" replace />} />
            <Route path="business" element={<Navigate to="/app/settings/business" replace />} />
            <Route path="settings/user" element={<Navigate to="/app/settings/business" replace />} />
            <Route path="settings" element={<Navigate to="/app/settings/business" replace />} />
          </Route>
        </Route>

        <Route path="/" element={<RootRedirect />} />
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}
