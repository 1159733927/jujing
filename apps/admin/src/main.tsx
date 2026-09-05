import { lazy, StrictMode, Suspense, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { App as AntdApp, ConfigProvider, Spin, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'antd/dist/reset.css'
import './styles.css'
import { AdminAuthProvider, useAdminSession } from './auth'
import AdminLayout from './components/AdminLayout'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const UserAccountsPage = lazy(() => import('./pages/UserAccountsPage'))
const KnowledgePage = lazy(() => import('./pages/KnowledgePage'))
const RuleProfilesPage = lazy(() => import('./pages/RuleProfilesPage'))
const WenzhenPage = lazy(() => import('./pages/WenzhenPage'))

const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

function FullPageSpinner({ label = '正在校验登录状态…' }: { label?: string }) {
  const { token } = theme.useToken()
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        alignItems: 'center',
        justifyContent: 'center',
        background: token.colorBgLayout,
        color: token.colorTextSecondary,
      }}
    >
      <Spin size="large" />
      <span>{label}</span>
    </div>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAdminSession()
  if (status === 'loading') return <FullPageSpinner />
  if (status === 'unauthenticated') return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminRoutes() {
  return (
    <Suspense fallback={<FullPageSpinner label="正在加载后台页面…" />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <AdminLayout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="users" element={<UserAccountsPage />} />
          <Route path="knowledge" element={<KnowledgePage />} />
          <Route path="rule-profiles" element={<RuleProfilesPage />} />
          <Route path="wenzhen" element={<WenzhenPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

function AdminApp() {
  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#244b3b', borderRadius: 8 } }}>
      <AntdApp>
        <BrowserRouter basename={routerBasename}>
          <AdminAuthProvider>
            <AdminRoutes />
          </AdminAuthProvider>
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  )
}

const rootElement = document.getElementById('root')
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <AdminApp />
    </StrictMode>,
  )
}
