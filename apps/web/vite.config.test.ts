import { describe, expect, it } from 'vitest'

import { resolveApiProxyTarget } from './vite.config'

describe('resolveApiProxyTarget', () => {
  it('defaults to the local API server when API_PROXY_TARGET is not set', () => {
    expect(resolveApiProxyTarget(undefined)).toBe('http://127.0.0.1:3001')
    expect(resolveApiProxyTarget('')).toBe('http://127.0.0.1:3001')
  })

  it('accepts http and https origins', () => {
    expect(resolveApiProxyTarget('http://127.0.0.1:3002')).toBe('http://127.0.0.1:3002')
    expect(resolveApiProxyTarget('https://api.example.test')).toBe('https://api.example.test')
  })

  it('rejects non-http protocols, credentials, paths, queries, and hashes without echoing the value', () => {
    const invalidTargets = [
      'ws://127.0.0.1:3001',
      'http://user:password@127.0.0.1:3001',
      'http://127.0.0.1:3001/api',
      'http://127.0.0.1:3001?token=secret',
      'http://127.0.0.1:3001#secret',
      'not a url',
    ]

    for (const target of invalidTargets) {
      expect(() => resolveApiProxyTarget(target)).toThrow(/Invalid API_PROXY_TARGET/u)
      expect(() => resolveApiProxyTarget(target)).not.toThrow(target)
    }
  })
})
