import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getSession, login as loginRequest, logout as logoutRequest } from './api'
import type { AdminSession } from './types'

type AdminAuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

type AdminAuthValue = {
  session: AdminSession | null
  status: AdminAuthStatus
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null)

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(null)
  const [status, setStatus] = useState<AdminAuthStatus>('loading')

  useEffect(() => {
    let active = true
    getSession()
      .then((restored) => {
        if (!active) return
        setSession(restored)
        setStatus('authenticated')
      })
      .catch(() => {
        if (!active) return
        setSession(null)
        setStatus('unauthenticated')
      })
    return () => {
      active = false
    }
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const created = await loginRequest(username, password)
    setSession(created)
    setStatus('authenticated')
  }, [])

  const logout = useCallback(async () => {
    try {
      await logoutRequest()
    } finally {
      setSession(null)
      setStatus('unauthenticated')
    }
  }, [])

  const value = useMemo(() => ({ session, status, login, logout }), [session, status, login, logout])
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

export function useAdminSession(): AdminAuthValue {
  const context = useContext(AdminAuthContext)
  if (!context) throw new Error('useAdminSession 必须在 AdminAuthProvider 内部使用')
  return context
}
