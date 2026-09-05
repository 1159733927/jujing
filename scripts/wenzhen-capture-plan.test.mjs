import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { groupCapturesByBatch, isMainModule, pendingWenzhenCaptures, renderWenzhenCapturePlan } from './wenzhen-capture-plan.mjs'

describe('WenZhen capture plan helper', () => {
  it('recognizes its CLI entrypoint', () => {
    assert.equal(isMainModule(new URL('./wenzhen-capture-plan.mjs', import.meta.url).href, 'scripts/wenzhen-capture-plan.mjs'), true)
    assert.equal(isMainModule(new URL('./wenzhen-capture-plan.mjs', import.meta.url).href, 'scripts/not-wenzhen-capture-plan.mjs'), false)
  })

  it('keeps only pending-capture rows and groups them by batch', () => {
    const captures = pendingWenzhenCaptures([
      { id: 'done', status: 'verified', batch: 'a' },
      { id: 'p1', status: 'pending-capture', batch: 'a' },
      { id: 'p2', status: 'pending-capture', batch: 'b' },
    ])

    assert.deepEqual(captures.map((item) => item.id), ['p1', 'p2'])
    assert.deepEqual(Object.fromEntries([...groupCapturesByBatch(captures)].map(([batch, items]) => [batch, items.map((item) => item.id)])), {
      a: ['p1'],
      b: ['p2'],
    })
  })

  it('renders a human capture checklist without inventing expected pillars', () => {
    const plan = renderWenzhenCapturePlan([{
      id: 'wz-test',
      status: 'pending-capture',
      batch: 'solar-term-boundaries',
      scenario: '立春后边界',
      birth: {
        calendarSystem: 'solar',
        date: '2024-02-04',
        time: '16:40',
        gender: 'male',
        locationName: '北京市 北京市 海淀区',
        useTrueSolarTime: true,
        dayBoundary: 'midnight',
        luckMethod: 'sect1',
        dstPolicy: 'auto',
      },
      capture: ['交节时刻', '四柱', '真太阳时'],
      risk: 'solar-term-boundary',
    }])

    assert.match(plan, /问真待采集清单/)
    assert.match(plan, /wz-test/)
    assert.match(plan, /公历 2024-02-04 16:40/)
    assert.match(plan, /必看字段：交节时刻、四柱、真太阳时/)
    assert.match(plan, /只录问真页面真实显示结果/)
    assert.equal(/甲子|乙丑|丙寅|丁卯/u.test(plan), false)
  })
})
