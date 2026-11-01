import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import AppLogo from './components/AppLogo';
import AssistantPanel from './components/AssistantPanel';
import PageTransition from './components/PageTransition';
import TopNav from './components/TopNav';
import { AssetsProvider } from './context/AssetsContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { MastersProvider } from './context/MastersContext';
import { ThemeProvider } from './context/ThemeContext';
import ActivityLogPage from './pages/ActivityLogPage';
import ApprovePage from './pages/ApprovePage';
import DashboardPage from './pages/DashboardPage';
import DataEntryPage from './pages/DataEntryPage';
import HistoryDetailPage from './pages/HistoryDetailPage';
import HistoryPage from './pages/HistoryPage';
import InventoryPage from './pages/InventoryPage';
import LoginPage from './pages/LoginPage';
import LookupPage from './pages/LookupPage';
import MasterDataPage from './pages/MasterDataPage';
import NewVsReplacedPage from './pages/NewVsReplacedPage';
import RecordPage from './pages/RecordPage';
import ReportPage from './pages/ReportPage';
import SetPasswordPage from './pages/SetPasswordPage';
import VerificationPage from './pages/VerificationPage';
import './App.css';

function ProtectedLayout() {
  const { isAuthenticated, mustChangePassword, canWrite } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (mustChangePassword) return <SetPasswordPage />;

  return (
    <div className="app-shell">
      <TopNav />
      <div className="app-body">
        <main className="main-content">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>
      </div>
      <AssistantPanel canMakeChanges={canWrite} />
    </div>
  );
}

function AdminRoute({ children }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
}

function SuperadminRoute({ children }) {
  const { isSuperadmin } = useAuth();
  if (!isSuperadmin) return <Navigate to="/" replace />;
  return children;
}

function WriteRoute({ children }) {
  const { canWrite } = useAuth();
  if (!canWrite) return <Navigate to="/" replace />;
  return children;
}

function VerifyRoute({ children }) {
  const { canVerify } = useAuth();
  if (!canVerify) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { isAuthenticated, bootstrapping } = useAuth();

  if (bootstrapping) {
    return (
      <div className="app-boot">
        <div className="page-transition-badge">
          <div className="page-transition-aura" />
          <AppLogo size={58} gradient={true} />
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={!isAuthenticated ? <LoginPage /> : <Navigate to="/" replace />}
      />
      <Route path="/approve/:token" element={<ApprovePage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/data-entry" element={<WriteRoute><DataEntryPage /></WriteRoute>} />
        <Route path="/verification" element={<VerifyRoute><VerificationPage /></VerifyRoute>} />
        <Route path="/report" element={<ReportPage />} />
        <Route path="/report/new-vs-replaced" element={<NewVsReplacedPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/report/:register/:id" element={<RecordPage />} />
        <Route path="/find" element={<LookupPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/history/:assetPk" element={<HistoryDetailPage />} />
        <Route
          path="/masters"
          element={<AdminRoute><MasterDataPage /></AdminRoute>}
        />
        <Route
          path="/users"
          element={<AdminRoute><MasterDataPage initialTab="users" /></AdminRoute>}
        />
        <Route
          path="/activity"
          element={<SuperadminRoute><ActivityLogPage /></SuperadminRoute>}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MastersProvider>
          <AssetsProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </AssetsProvider>
        </MastersProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
