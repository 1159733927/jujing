import { describe, expect, it } from 'vitest'
import { professionalReasoningTimeoutMs } from '../src/app.js'

describe('professional reasoning timeout configuration', () => {
  it('keeps the demo report pipeline responsive by default', () => {
    expect(professionalReasoningTimeoutMs({})).toBe(60_000)
  })

  it('accepts bounded overrides', () => {
    expect(professionalReasoningTimeoutMs({ PROFESSIONAL_REASONING_TIMEOUT_MS: '300000' })).toBe(300_000)
  })

  it.each(['4999', '300001', 'invalid'])('falls back for an unsafe override: %s', (value) => {
    expect(professionalReasoningTimeoutMs({ PROFESSIONAL_REASONING_TIMEOUT_MS: value })).toBe(60_000)
  })
})
