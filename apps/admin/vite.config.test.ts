import { describe, expect, it } from 'vitest'
import { DEFAULT_API_PROXY_TARGET, resolveApiProxyTarget } from './vite.config'

describe('admin API proxy target config', () => {
  it('uses the local API port by default', () => {
    expect(resolveApiProxyTarget(undefined)).toBe(DEFAULT_API_PROXY_TARGET)
    expect(resolveApiProxyTarget('')).toBe(DEFAULT_API_PROXY_TARGET)
  })

  it('accepts http and https origins', () => {
    expect(resolveApiProxyTarget('http://localhost:3002')).toBe('http://localhost:3002')
    expect(resolveApiProxyTarget('https://api.example.com')).toBe('https://api.example.com')
  })

  it('fails closed for malicious or non-origin targets without echoing the value', () => {
    const invalidTargets = [
      'ftp://127.0.0.1:3001',
      'http://user:pass@127.0.0.1:3001',
      'http://127.0.0.1:3001/api',
      'http://127.0.0.1:3001?token=secret',
      'http://127.0.0.1:3001#secret',
      'not a url',
    ]

    for (const target of invalidTargets) {
      expect(() => resolveApiProxyTarget(target)).toThrow(
        'Invalid API_PROXY_TARGET: expected a valid http(s) origin without credentials, path, query, or hash',
      )
      expect(() => resolveApiProxyTarget(target)).not.toThrow(target)
    }
  })
})
