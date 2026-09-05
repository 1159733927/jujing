import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export const DEFAULT_API_PROXY_TARGET = 'http://127.0.0.1:3001'
const INVALID_API_PROXY_TARGET_MESSAGE =
  'Invalid API_PROXY_TARGET: expected a valid http(s) origin without credentials, path, query, or hash'

export function resolveApiProxyTarget(rawTarget = process.env.API_PROXY_TARGET): string {
  const candidate = rawTarget?.trim() || DEFAULT_API_PROXY_TARGET

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error(INVALID_API_PROXY_TARGET_MESSAGE)
  }

  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    !['', '/'].includes(parsed.pathname) ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(INVALID_API_PROXY_TARGET_MESSAGE)
  }

  return parsed.href.replace(/\/$/, '')
}

const apiProxyTarget = resolveApiProxyTarget()

export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  build: {
    // Route-level lazy loading keeps each admin page small. The remaining large
    // asset is the shared Ant Design vendor graph; forcing it into smaller
    // manual chunks creates circular Rollup chunks, so keep the graph intact
    // and make the accepted local-admin vendor budget explicit.
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 4174,
    proxy: { '/api': { target: apiProxyTarget, changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, '') } },
  },
})
