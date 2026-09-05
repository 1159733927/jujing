/* @vitest-environment happy-dom */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BirthConfigurationFields,
  buildChartVersionRequest,
  defaultBirth,
  normalizeStoredBirthInput,
} from './main'

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function cleanup(root: Root, container: HTMLElement) {
  act(() => root.unmount())
  container.remove()
}

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function renderBirthConfiguration(initialBirth = defaultBirth) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  function Harness() {
    const [birth, setBirth] = useState(initialBirth)
    return <BirthConfigurationFields
      birth={birth}
      setBirth={setBirth}
      activeRuleProfileVersions={[]}
      selectedRuleProfileVersionId=""
      ruleProfilesLoading={false}
      ruleProfilesError=""
      onSelectRuleProfileVersion={() => undefined}
      onRetryRuleProfiles={() => undefined}
    />
  }

  act(() => root.render(<Harness />))
  return { root, container }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in DOM test'))))
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('true solar time rule version', () => {
  it('defaults birth-data requests to the compatible v2 correction rule', () => {
    expect(defaultBirth.timeCorrectionRuleVersion).toBe('true-solar-v2-zone-meridian-equation-of-time')
    expect(normalizeStoredBirthInput({ ...defaultBirth, timeCorrectionRuleVersion: undefined }).timeCorrectionRuleVersion).toBe('true-solar-v2-zone-meridian-equation-of-time')
    expect(buildChartVersionRequest(defaultBirth, '', undefined)).toMatchObject({
      useTrueSolarTime: true,
      timeCorrectionRuleVersion: 'true-solar-v2-zone-meridian-equation-of-time',
    })
  })

  it('lets a user switch to the v3 trial correction rule and preserves it in the request input', () => {
    const { root, container } = renderBirthConfiguration()
    const select = container.querySelector<HTMLSelectElement>('#true-solar-rule-version')!

    expect(select).toBeTruthy()
    expect(select.disabled).toBe(false)
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      '兼容算法 v2（默认）',
      '精细算法 v3（试验）',
    ])

    act(() => {
      select.value = 'true-solar-v3-standard-time-equation-of-time'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const updated = container.querySelector<HTMLSelectElement>('#true-solar-rule-version')!
    expect(updated.value).toBe('true-solar-v3-standard-time-equation-of-time')
    expect(buildChartVersionRequest({ ...defaultBirth, timeCorrectionRuleVersion: updated.value as typeof defaultBirth.timeCorrectionRuleVersion }, '', undefined)).toMatchObject({
      timeCorrectionRuleVersion: 'true-solar-v3-standard-time-equation-of-time',
    })
    cleanup(root, container)
  })

  it('hides the rule selector when true solar time is disabled without losing the selected version', () => {
    const { root, container } = renderBirthConfiguration({
      ...defaultBirth,
      timeCorrectionRuleVersion: 'true-solar-v3-standard-time-equation-of-time',
    })
    const checkbox = container.querySelector<HTMLInputElement>('.true-solar-toggle input')!

    click(checkbox)

    expect(container.querySelector('#true-solar-rule-version')).toBeNull()

    click(container.querySelector<HTMLInputElement>('.true-solar-toggle input')!)

    expect(container.querySelector<HTMLSelectElement>('#true-solar-rule-version')!.value).toBe('true-solar-v3-standard-time-equation-of-time')
    cleanup(root, container)
  })
})
