/* @vitest-environment happy-dom */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BirthConfigurationFields, BirthDateTimePicker, BirthplacePicker, defaultBirth } from './main'

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function renderDateTimePicker(setBirth = vi.fn()) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<BirthDateTimePicker birth={defaultBirth} setBirth={setBirth} />)
  })
  return { container, root, setBirth }
}

function renderBirthplacePicker(setBirth = vi.fn()) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<BirthplacePicker birth={defaultBirth} setBirth={setBirth} />)
  })
  return { container, root, setBirth }
}

function renderBirthConfigurationFields(setBirth = vi.fn()) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<BirthConfigurationFields
      birth={defaultBirth}
      setBirth={setBirth}
      activeRuleProfileVersions={[]}
      selectedRuleProfileVersionId=""
      ruleProfilesLoading={false}
      ruleProfilesError=""
      onSelectRuleProfileVersion={vi.fn()}
      onRetryRuleProfiles={vi.fn()}
    />)
  })
  return { container, root, setBirth }
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function buttonInColumn(columnIndex: number, text: string): Element {
  const column = document.querySelectorAll('.picker-column')[columnIndex]
  const button = Array.from(column?.querySelectorAll('button') ?? [])
    .find((candidate) => candidate.textContent === text)
  if (!button) throw new Error(`Could not find picker button ${text} in column ${columnIndex}`)
  return button
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('birth date/time picker interaction', () => {
  it('opens the time picker dialog when the birth date trigger is clicked', () => {
    const { container, root } = renderDateTimePicker()
    const dateTrigger = container.querySelectorAll('button.datetime-trigger')[0]

    click(dateTrigger)

    expect(document.querySelector('[role="dialog"][aria-label="选择出生时间"]')).not.toBeNull()
    cleanup(root, container)
  })

  it('opens the time picker dialog when the birth time trigger is clicked', () => {
    const { container, root } = renderDateTimePicker()
    const timeTrigger = container.querySelectorAll('button.datetime-trigger')[1]

    click(timeTrigger)

    expect(document.querySelector('[role="dialog"][aria-label="选择出生时间"]')).not.toBeNull()
    cleanup(root, container)
  })

  it('commits the selected birth time only after confirmation', () => {
    const { container, root, setBirth } = renderDateTimePicker()
    const timeTrigger = container.querySelectorAll('button.datetime-trigger')[1]
    click(timeTrigger)

    click(buttonInColumn(3, '12'))
    click(buttonInColumn(4, '03'))
    click(document.querySelector('button.picker-confirm')!)

    expect(setBirth).toHaveBeenCalledWith(expect.objectContaining({ time: '12:03' }))
    cleanup(root, container)
  })

  it('keeps the original birth time when the picker is cancelled', () => {
    const { container, root, setBirth } = renderDateTimePicker()
    const timeTrigger = container.querySelectorAll('button.datetime-trigger')[1]
    click(timeTrigger)

    click(buttonInColumn(3, '12'))
    click(Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '取消')!)

    expect(setBirth).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"][aria-label="选择出生时间"]')).toBeNull()
    cleanup(root, container)
  })
})

describe('birthplace picker interaction', () => {
  it('opens a birthplace selector instead of asking users to type coordinates', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        dataset: {
          id: 'test-birthplaces',
          version: 'test-geo-v1',
          label: '测试地点库',
          coverage: 'licensed-partial',
          coordinateSystem: 'WGS84',
          timezonePolicy: 'city-default-iana',
          source: { label: '测试来源', license: 'test-license', notes: 'test-only' },
        },
      }),
    } as Response)
    const { container, root } = renderBirthplacePicker()
    const trigger = container.querySelector('button.birthplace-trigger')

    click(trigger!)

    expect(document.querySelector('[role="dialog"][aria-label="选择出生地点"]')).not.toBeNull()
    expect(document.querySelector('input[aria-label="搜索出生地点"]')).not.toBeNull()
    expect(document.body.textContent).toContain('用户只需要选出生地点')
    cleanup(root, container)
  })

  it('loads the service birthplace tree and fills coordinates from province-city-district selection', async () => {
    const dataset = {
      id: 'test-birthplaces',
      version: 'test-geo-v2',
      label: '测试地点库',
      coverage: 'licensed-partial',
      coordinateSystem: 'WGS84',
      timezonePolicy: 'city-default-iana',
      source: { label: '测试来源', license: 'test-license', notes: 'test-only' },
    }
    const tree = [{
      code: '990000',
      name: '测试省',
      cities: [{
        code: '990100',
        name: '测试市',
        timezone: 'Asia/Shanghai',
        districts: [
          { code: '990101', name: '测试区', longitude: 118.125, latitude: 31.25, coordinate: { sourceLabel: '测试坐标', license: 'test-license', confidence: 'verified' } },
        ],
      }],
    }]
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/v1/birthplaces/tree')) return Response.json({ tree, dataset })
      if (url.includes('/v1/birthplaces/administrative/dataset')) return Response.json({ dataset })
      if (url.includes('/v1/birthplaces/administrative?')) return Response.json({ total: 0, limit: 8, offset: 0, items: [], dataset })
      return Response.json({ birthplace: { province: tree[0], city: tree[0].cities[0], district: tree[0].cities[0].districts[0], selectable: true }, dataset })
    })
    const { container, root, setBirth } = renderBirthplacePicker()
    click(container.querySelector('button.birthplace-trigger')!)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const province = document.querySelector<HTMLSelectElement>('select[aria-label="出生省份"]')!
    expect(Array.from(province.options).map((option) => option.textContent)).toContain('测试省')

    act(() => {
      province.value = '测试省'
      province.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const district = document.querySelector<HTMLSelectElement>('select[aria-label="出生区县"]')!
    act(() => {
      district.value = '测试区'
      district.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(setBirth).toHaveBeenLastCalledWith(expect.objectContaining({
      province: '测试省',
      city: '测试市',
      district: '测试区',
      placeCode: '990101',
      locationName: '测试省 测试市 测试区',
      longitude: 118.125,
      latitude: 31.25,
      timezone: 'Asia/Shanghai',
      geoDataVersion: 'test-geo-v2',
    }))
    cleanup(root, container)
  })
})

describe('birth configuration fields', () => {
  it('keeps algorithm details inside collapsed advanced chart parameters', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ dataset: null }),
    } as Response)
    const { container, root } = renderBirthConfigurationFields()

    const advanced = container.querySelector<HTMLDetailsElement>('.advanced-chart-params')
    expect(advanced).toBeTruthy()
    expect(advanced?.open).toBe(false)
    expect(Array.from(container.querySelectorAll('label')).filter((label) => label.textContent?.includes('起运算法'))).toHaveLength(1)
    expect(container.textContent).toContain('高级排盘参数')
    cleanup(root, container)
  })
})
