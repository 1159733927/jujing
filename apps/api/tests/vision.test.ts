import { mkdtemp } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaStore } from '../src/media.js'
import { DeepSeekVisionAnalyzer, deepSeekApiKey, deepSeekVisionModel } from '../src/vision.js'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

afterEach(() => vi.unstubAllEnvs())

async function fixture(fetchImpl: typeof fetch) {
  const directory = await mkdtemp(join(tmpdir(), 'fengshui-vision-'))
  const media = new MediaStore(directory)
  const { fileId } = await media.save({ filename: 'room.png', mimetype: 'image/png', bytes: png, ownerId: randomUUID() })
  const analyzer = new DeepSeekVisionAnalyzer(media, fetchImpl, async () => 'test-key')
  return { analyzer, photo: { fileId, room: 'living-room' as const, facing: 'south' as const, note: '面向阳台' } }
}

describe('DeepSeek vision adapter', () => {
  it('requires explicit process environment injection instead of reading project files', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    await expect(deepSeekApiKey()).rejects.toThrow('DEEPSEEK_API_KEY is not configured')
    vi.stubEnv('DEEPSEEK_API_KEY', ' injected-key ')
    await expect(deepSeekApiKey()).resolves.toBe('injected-key')
  })

  it('returns schema-validated v2 observations with controlled fact codes', async () => {
    let requestedUrl = ''
    let requestedModel = ''
    const { analyzer, photo } = await fixture(async (url, init) => {
      requestedUrl = String(url)
      requestedModel = JSON.parse(init?.body as string).model
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        schemaVersion: 'vision-observation-v2',
        modelVersion: 'deepseek-v4-flash-vision-exp',
        promptVersion: 'residence-facts-v2',
        summary: '明亮客厅',
        observedElements: ['窗户'],
        uncertainties: ['窗外方向'],
        facts: [{ code: 'window.visible', confidence: 0.82, evidence: '画面右侧可见窗户', scope: 'visible-detail', source: 'vision-model' }],
      }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    await expect(analyzer.analyze([photo])).resolves.toMatchObject([{
      schemaVersion: 'vision-observation-v2',
      promptVersion: 'residence-facts-v2',
      summary: '明亮客厅',
      observedElements: ['窗户'],
      facts: [{ code: 'window.visible', confidence: 0.82, evidence: '画面右侧可见窗户', scope: 'visible-detail', source: 'vision-model' }],
    }])
    expect(requestedUrl).toBe('https://api.deepseek.com/chat/completions')
    expect(requestedModel).toBe('deepseek-v4-flash-vision-exp')
  })

  it('backfills observedElements from v2 facts for display compatibility', async () => {
    const { analyzer, photo } = await fixture(async () => Response.json({ choices: [{ message: { content: JSON.stringify({
      schemaVersion: 'vision-observation-v2',
      modelVersion: 'deepseek-v4-flash-vision-exp',
      promptVersion: 'residence-facts-v2',
      summary: '可见阳台',
      facts: [{ code: 'balcony.visible', confidence: 0.71, evidence: '客厅外侧可见阳台', scope: 'visible-detail', source: 'vision-model' }],
      uncertainties: [],
    }) } }] }))

    await expect(analyzer.analyze([photo])).resolves.toMatchObject([{
      observedElements: ['客厅外侧可见阳台'],
      facts: [{ code: 'balcony.visible' }],
    }])
  })

  it('uses DEEPSEEK_VISION_MODEL only for vision requests', async () => {
    vi.stubEnv('DEEPSEEK_VISION_MODEL', ' deepseek-custom-vision ')
    expect(deepSeekVisionModel()).toBe('deepseek-custom-vision')

    let requestedModel = ''
    const { analyzer, photo } = await fixture(async (_url, init) => {
      requestedModel = JSON.parse(init?.body as string).model
      return Response.json({ choices: [{ message: { content: JSON.stringify({ schemaVersion: 'vision-observation-v2', modelVersion: 'deepseek-custom-vision', promptVersion: 'residence-facts-v2', summary: '空间', facts: [], observedElements: [], uncertainties: [] }) } }] })
    })

    await analyzer.analyze([photo])
    expect(requestedModel).toBe('deepseek-custom-vision')
  })

  it('falls back to the default vision model for blank DEEPSEEK_VISION_MODEL', async () => {
    vi.stubEnv('DEEPSEEK_VISION_MODEL', '   ')
    expect(deepSeekVisionModel()).toBe('deepseek-v4-flash-vision-exp')

    let requestedModel = ''
    const { analyzer, photo } = await fixture(async (_url, init) => {
      requestedModel = JSON.parse(init?.body as string).model
      return Response.json({ choices: [{ message: { content: JSON.stringify({ schemaVersion: 'vision-observation-v2', modelVersion: 'deepseek-v4-flash-vision-exp', promptVersion: 'residence-facts-v2', summary: '空间', facts: [], observedElements: [], uncertainties: [] }) } }] })
    })

    await analyzer.analyze([photo])
    expect(requestedModel).toBe('deepseek-v4-flash-vision-exp')
  })

  it('limits concurrent vision requests to three', async () => {
    let active = 0
    let peak = 0
    const { analyzer, photo } = await fixture(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return Response.json({ choices: [{ message: { content: JSON.stringify({ schemaVersion: 'vision-observation-v2', modelVersion: 'deepseek-v4-flash-vision-exp', promptVersion: 'residence-facts-v2', summary: '空间', facts: [], observedElements: [], uncertainties: [] }) } }] })
    })
    await analyzer.analyze(Array.from({ length: 7 }, (_, index) => ({ ...photo, fileId: photo.fileId, note: String(index) })))
    expect(peak).toBe(3)
  })

  it('keeps the report pipeline alive when the provider rejects one image', async () => {
    const { analyzer, photo } = await fixture(async () => new Response('rate limited', { status: 429 }))
    await expect(analyzer.analyze([photo])).resolves.toMatchObject([{
      summary: '本图未产生可发布的自动视觉事实；报告仅可引用用户标注与文字说明。',
      observedElements: [],
      uncertainties: [expect.stringContaining('status 429')],
    }])
  })

  it('includes a safe provider error message in the unavailable observation', async () => {
    const { analyzer, photo } = await fixture(async () => new Response(JSON.stringify({ error: { message: 'invalid image format' } }), { status: 400 }))
    await expect(analyzer.analyze([photo])).resolves.toMatchObject([{
      observedElements: [],
      uncertainties: [expect.stringContaining('status 400: invalid image format')],
    }])
  })

  it('marks malformed model output as unavailable instead of inventing facts', async () => {
    const { analyzer, photo } = await fixture(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":3}' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(analyzer.analyze([photo])).resolves.toMatchObject([{
      summary: '本图未产生可发布的自动视觉事实；报告仅可引用用户标注与文字说明。',
      observedElements: [],
      uncertainties: [expect.stringContaining('outside the required schema')],
      facts: [],
    }])
  })

  it('fails closed when the provider returns facts outside the controlled code whitelist', async () => {
    const { analyzer, photo } = await fixture(async () => Response.json({ choices: [{ message: { content: JSON.stringify({
      schemaVersion: 'vision-observation-v2',
      modelVersion: 'deepseek-v4-flash-vision-exp',
      promptVersion: 'residence-facts-v2',
      summary: '空间',
      facts: [{ code: 'sofa.visible', confidence: 0.8, evidence: '可见沙发', scope: 'visible-detail', source: 'vision-model' }],
      observedElements: ['可见沙发'],
      uncertainties: [],
    }) } }] }))

    await expect(analyzer.analyze([photo])).resolves.toMatchObject([{
      observedElements: [],
      uncertainties: [expect.stringContaining('outside the required schema')],
      facts: [],
    }])
  })

  it('fails closed when topology facts are returned for non-overview photos', async () => {
    const { analyzer, photo } = await fixture(async () => Response.json({ choices: [{ message: { content: JSON.stringify({
      schemaVersion: 'vision-observation-v2',
      modelVersion: 'deepseek-v4-flash-vision-exp',
      promptVersion: 'residence-facts-v2',
      summary: '空间',
      facts: [{ code: 'bathroom.near-center', confidence: 0.8, evidence: '卫生间靠近户型中心', scope: 'floor-plan-topology', source: 'vision-model' }],
      observedElements: ['卫生间靠近户型中心'],
      uncertainties: [],
    }) } }] }))

    await expect(analyzer.analyze([photo])).resolves.toMatchObject([{
      observedElements: [],
      uncertainties: [expect.stringContaining('outside the required schema')],
      facts: [],
    }])
  })

  it('allows topology facts only for overview floor plans', async () => {
    const { analyzer, photo } = await fixture(async () => Response.json({ choices: [{ message: { content: JSON.stringify({
      schemaVersion: 'vision-observation-v2',
      modelVersion: 'deepseek-v4-flash-vision-exp',
      promptVersion: 'residence-facts-v2',
      summary: '户型总图',
      facts: [
        { code: 'kitchen.south', confidence: 0.76, evidence: '厨房位于户型南侧', scope: 'floor-plan-topology', source: 'vision-model' },
        { code: 'bathroom.near-center', confidence: 0.68, evidence: '卫生间接近平面中心', scope: 'floor-plan-topology', source: 'vision-model' },
      ],
      observedElements: ['厨房位于户型南侧', '卫生间接近平面中心'],
      uncertainties: [],
    }) } }] }))

    await expect(analyzer.analyze([{ ...photo, room: 'overview' }])).resolves.toMatchObject([{
      facts: [{ code: 'kitchen.south' }, { code: 'bathroom.near-center' }],
    }])
  })

  it('fails closed when fact evidence is blank or too long', async () => {
    const longEvidence = '过长'.repeat(41)
    const { analyzer, photo } = await fixture(async () => Response.json({ choices: [{ message: { content: JSON.stringify({
      schemaVersion: 'vision-observation-v2',
      modelVersion: 'deepseek-v4-flash-vision-exp',
      promptVersion: 'residence-facts-v2',
      summary: '空间',
      facts: [{ code: 'window.visible', confidence: 0.8, evidence: longEvidence, scope: 'visible-detail', source: 'vision-model' }],
      observedElements: [longEvidence],
      uncertainties: [],
    }) } }] }))

    await expect(analyzer.analyze([photo])).resolves.toMatchObject([{ observedElements: [], facts: [] }])
  })
})
