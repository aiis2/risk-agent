import { Suspense, lazy } from 'react';
import { Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sidebar } from './components/Sidebar';
import { ElectronUpdateBanner } from './components/ElectronUpdateBanner';

const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const Scenarios = lazy(() => import('./pages/Scenarios').then((module) => ({ default: module.Scenarios })));
const ScenarioDetail = lazy(() => import('./pages/ScenarioDetail').then((module) => ({ default: module.ScenarioDetail })));
const Rules = lazy(() => import('./pages/Rules').then((module) => ({ default: module.Rules })));
const NewAnalysis = lazy(() => import('./pages/NewAnalysis').then((module) => ({ default: module.NewAnalysis })));
const ChatPage = lazy(() => import('./pages/Chat').then((module) => ({ default: module.ChatPage })));
const CliPage = lazy(() => import('./pages/CliPage').then((module) => ({ default: module.CliPage })));
const Reports = lazy(() => import('./pages/Reports').then((module) => ({ default: module.Reports })));
const ReportDetail = lazy(() => import('./pages/ReportDetail').then((module) => ({ default: module.ReportDetail })));
const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })));
const BrowserWorkspace = lazy(() => import('./pages/BrowserWorkspace').then((module) => ({ default: module.BrowserWorkspacePage })));
const BrowserHost = lazy(() => import('./pages/BrowserHost').then((module) => ({ default: module.BrowserHostPage })));
const Sessions = lazy(() => import('./pages/Sessions').then((module) => ({ default: module.Sessions })));
const Profiles = lazy(() => import('./pages/Profiles').then((module) => ({ default: module.Profiles })));
const KnowledgeGraph = lazy(() => import('./pages/KnowledgeGraph').then((module) => ({ default: module.KnowledgeGraph })));
const RunWorkbench = lazy(() => import('./pages/RunWorkbench').then((module) => ({ default: module.RunWorkbench })));
const Runs = lazy(() => import('./pages/Runs').then((module) => ({ default: module.Runs })));
const ScheduledRuns = lazy(() => import('./pages/ScheduledRuns').then((module) => ({ default: module.ScheduledRuns })));
const RunDetail = lazy(() => import('./pages/RunDetail').then((module) => ({ default: module.RunDetail })));

function RouteLoadingFallback() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-surface px-6">
      <div className="rounded-2xl border border-border-subtle bg-surface-card px-5 py-3 text-sm text-text-muted shadow-[0_12px_30px_rgba(0,0,0,0.18)]">
        {t('app.routeLoading', '正在加载页面…')}
      </div>
    </div>
  );
}

export function App() {
  const location = useLocation();
  const isBrowserHostSurface = location.pathname === '/browser-host';

  if (isBrowserHostSurface) {
    return (
      <div className="flex h-[100dvh] min-h-[100dvh] w-full flex-col overflow-hidden bg-[#0d1019] text-text">
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            <Route path="/browser-host" element={<BrowserHost />} />
          </Routes>
        </Suspense>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] w-full flex-col overflow-hidden bg-surface text-text">
      {/* Electron 自动更新通知横幅（desktop-app.md §5） */}
      <ElectronUpdateBanner />

      {/* Main layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left Sidebar */}
        <Sidebar />

        {/* Main content area */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Suspense fallback={<RouteLoadingFallback />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/cli" element={<CliPage />} />
              <Route path="/scenarios" element={<Scenarios />} />
              <Route path="/scenarios/:id" element={<ScenarioDetail />} />
              <Route path="/rules" element={<Rules />} />
              <Route path="/analyze" element={<NewAnalysis />} />
              <Route path="/sessions" element={<Sessions />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/reports/:id" element={<ReportDetail />} />
              <Route path="/profiles" element={<Profiles />} />
              <Route path="/knowledge-graph" element={<KnowledgeGraph />} />
              <Route path="/browser" element={<BrowserWorkspace />} />
              <Route path="/browser-host" element={<BrowserHost />} />
              <Route path="/workbench" element={<RunWorkbench />} />
              <Route path="/runs" element={<Runs />} />
              <Route path="/scheduled-runs" element={<ScheduledRuns />} />
              <Route path="/runs/:id" element={<RunDetail />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
