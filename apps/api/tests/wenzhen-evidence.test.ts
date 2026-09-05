import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { ChartRepository } from '../src/charts.js'
import { KnowledgeRepository } from '../src/knowledge.js'
import { MediaStore } from '../src/media.js'
import { ReportRepository } from '../src/repository.js'
import { BaziRuleProfileRepository } from '../src/rule-profiles.js'
import { FileWenzhenEvidenceStore, WENZHEN_EVIDENCE_MAX_BYTES } from '../src/wenzhen-evidence-store.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2ZAAAAABJRU5ErkJggg==', 'base64')
const authorization = { authorization: 'Bearer evidence-admin-token' }

function multipart(bytes: Buffer, mimeType: string, boundary = `wenzhen-evidence-${crypto.randomUUID()}`) {
  return {
    headers: { ...authorization, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="capture.bin"\r\nContent-Type: ${mimeType}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  }
}

async function evidenceApp() {
  const directory = await mkdtemp(join(tmpdir(), 'fengshui-wenzhen-evidence-'))
  const evidenceDirectory = join(directory, 'evidence')
  return {
    directory: evidenceDirectory,
    app: buildApp(
      new ReportRepository(join(directory, 'reports.json')),
      new MediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => '测试报告',
      { analyze: async () => [] },
      new ChartRepository(join(directory, 'charts.json')),
      new BaziRuleProfileRepository(join(directory, 'rules.json')),
      join(directory, 'fixtures.json'),
      new FileWenzhenEvidenceStore(evidenceDirectory),
    ),
  }
}

function fixturePayload(evidenceRef: string, sampleId = 'wz-evidence-001') {
  return {
    sampleId,
    source: 'wenzhen-admin-manual-capture',
    capturedAt: '2026-09-01T05:00:00Z',
    evidenceRef,
    birth: { date: '1992-08-21', time: '12:03', calendarSystem: 'solar', placeCode: '330106', useTrueSolarTime: true, dstPolicy: 'auto', dayBoundary: 'midnight', luckMethod: 'sect1', gender: 'male' },
    expected: { pillars: ['壬申', '戊申', '己巳', '庚午'] },
  }
}

afterEach(() => vi.unstubAllEnvs())

describe('WenZhen evidence uploads', () => {
  it('requires administrator authorization', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'evidence-admin-token')
    const { app } = await evidenceApp()
    const request = multipart(png, 'image/png')
    const response = await app.inject({ method: 'POST', url: '/v1/bazi/wenzhen/evidence', headers: { 'content-type': request.headers['content-type'] }, payload: request.payload })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('stores valid evidence by content hash and treats repeated content idempotently', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'evidence-admin-token')
    const { app, directory } = await evidenceApp()
    const first = await app.inject({ method: 'POST', url: '/v1/bazi/wenzhen/evidence', ...multipart(png, 'image/png') })
    const second = await app.inject({ method: 'POST', url: '/v1/bazi/wenzhen/evidence', ...multipart(png, 'image/png') })
    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(second.json()).toEqual(first.json())
    expect(first.json()).toMatchObject({
      evidenceRef: expect.stringMatching(/^evidence\/wenzhen\/sha256-[a-f0-9]{64}\.png$/),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      mimeType: 'image/png',
      size: png.length,
    })
    expect(await readdir(directory)).toEqual([basename(first.json().evidenceRef)])
    await app.close()
  })

  it('rejects unsupported MIME, MIME/signature mismatches, and oversized files', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'evidence-admin-token')
    const { app } = await evidenceApp()
    const unsupported = await app.inject({ method: 'POST', url: '/v1/bazi/wenzhen/evidence', ...multipart(Buffer.from('plain text'), 'text/plain') })
    expect(unsupported.statusCode).toBe(400)
    const mismatched = await app.inject({ method: 'POST', url: '/v1/bazi/wenzhen/evidence', ...multipart(png, 'image/jpeg') })
    expect(mismatched.statusCode).toBe(400)
    const oversizedBytes = Buffer.alloc(WENZHEN_EVIDENCE_MAX_BYTES + 1)
    png.copy(oversizedBytes)
    const oversized = await app.inject({ method: 'POST', url: '/v1/bazi/wenzhen/evidence', ...multipart(oversizedBytes, 'image/png') })
    expect(oversized.statusCode).toBe(413)
    await app.close()
  })

  it('rejects missing, forged, and hash-tampered evidence references before fixture persistence', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'evidence-admin-token')
    const { app, directory } = await evidenceApp()
    const missingRef = `evidence/wenzhen/sha256-${'a'.repeat(64)}.png`
    const missing = await app.inject({ method: 'POST', url: '/v1/bazi/wenzhen/fixtures', headers: authorization, payload: fixturePayload(missingRef, 'wz-evidence-missing') })
    expect(missing.statusCode).toBe(400)
    expect(missing.json().error).toContain('does not exist')

    const forged = await app.inject({ method: 'POST', url: '/v1/bazi/wenzhen/fixtures', headers: authorization, payload: fixturePayload('../../forged.png', 'wz-evidence-forged') })
    expect(forged.statusCode).toBe(400)
    expect(forged.json().error).toContain('server-issued')

    const uploaded = await app.inject({ method: 'POST', url: '/v1/bazi/wenzhen/evidence', ...multipart(png, 'image/png') })
    const evidenceRef = uploaded.json().evidenceRef as string
    const tamperedBytes = Buffer.from(png)
    tamperedBytes[20] = tamperedBytes[20]! ^ 0x01
    await writeFile(join(directory, basename(evidenceRef)), tamperedBytes)
    const tampered = await app.inject({ method: 'POST', url: '/v1/bazi/wenzhen/fixtures', headers: authorization, payload: fixturePayload(evidenceRef, 'wz-evidence-tampered') })
    expect(tampered.statusCode).toBe(400)
    expect(tampered.json().error).toContain('hash does not match')
    await app.close()
  })

  it('persists a fixture only when its server-issued evidence remains intact', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'evidence-admin-token')
    const { app } = await evidenceApp()
    const uploaded = await app.inject({ method: 'POST', url: '/v1/bazi/wenzhen/evidence', ...multipart(png, 'image/png') })
    const created = await app.inject({ method: 'POST', url: '/v1/bazi/wenzhen/fixtures', headers: authorization, payload: fixturePayload(uploaded.json().evidenceRef) })
    expect(created.statusCode).toBe(201)
    expect(created.json().fixture).toMatchObject({ sampleId: 'wz-evidence-001', evidenceRef: uploaded.json().evidenceRef })
    await app.close()
  })
})
