import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('bazi runtime metadata', () => {
  it('returns only the public timezone runtime versions', async () => {
    const app = await buildApp()
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/v1/bazi/runtime' })
    const payload = response.json()

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('public, max-age=3600')
    expect(payload.runtime).toEqual({
      provider: 'node-intl',
      ...(process.versions.tz ? { tzdbVersion: process.versions.tz } : {}),
      ...(process.versions.icu ? { icuVersion: process.versions.icu } : {}),
    })
    expect(payload.runtime).not.toHaveProperty('nodeVersion')
    expect(payload.runtime).not.toHaveProperty('unicodeVersion')
    expect(payload.runtime).not.toHaveProperty('cldrVersion')
  })
})
