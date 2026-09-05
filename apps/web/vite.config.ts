import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const DEFAULT_API_PROXY_TARGET = 'http://127.0.0.1:3001'

export function resolveApiProxyTarget(rawTarget = process.env.API_PROXY_TARGET): string {
  if (rawTarget === undefined || rawTarget.trim() === '') return DEFAULT_API_PROXY_TARGET

  let url: URL
  try {
    url = new URL(rawTarget)
  } catch {
    throw new Error('Invalid API_PROXY_TARGET: expected an http(s) origin without credentials, path, query, or hash.')
  }

  const isHttpProtocol = url.protocol === 'http:' || url.protocol === 'https:'
  const hasCredentials = url.username !== '' || url.password !== ''
  const hasPath = url.pathname !== '' && url.pathname !== '/'
  const hasSearchOrHash = url.search !== '' || url.hash !== ''

  if (!isHttpProtocol || hasCredentials || hasPath || hasSearchOrHash) {
    throw new Error('Invalid API_PROXY_TARGET: expected an http(s) origin without credentials, path, query, or hash.')
  }

  return url.origin
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4173,
    proxy: {
      '/api': {
        target: resolveApiProxyTarget(),
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, request) => {
            const shareToken = request.headers['x-report-share-token']
            if (typeof shareToken === 'string') proxyReq.setHeader('x-report-share-token', shareToken)
          })
        },
      },
    },
  },
})
