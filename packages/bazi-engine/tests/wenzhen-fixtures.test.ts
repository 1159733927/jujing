import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { calculateBazi, calculateBaziFlow } from '../src/index.js'
import {
  assertWenzhenStage1Ready,
  createWenzhenFixtureReport,
  compareWenzhenExpected,
  deriveWenzhenAssertionCoverage,
  deriveWenzhenScenarioRequirement,
  generateWenzhenFixtureReports,
  validateWenzhenCaptureMatrix,
  validateWenzhenEvidenceManifest,
  validateWenzhenFixture,
  type AcceptedDifferenceWenzhenFixture,
  type VerifiedWenzhenFixture,
  type WenzhenExpected,
} from '../src/wenzhen-fixtures.js'

const roots: string[] = []
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wenzhen-fixtures-'))
  roots.push(root)
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const currentDir = dirname(fileURLToPath(import.meta.url))
const evidenceBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const evidenceHash = createHash('sha256').update(evidenceBytes).digest('hex')
const evidenceRef = `evidence/wenzhen/sha256-${evidenceHash}.png`
const legacyTimeCorrectionRuleVersion = 'true-solar-v2-zone-meridian-equation-of-time'

const birth = {
  calendarSystem: 'solar' as const,
  date: '1992-08-21',
  time: '12:03',
  locationName: '浙江省 杭州市 西湖区',
  longitude: 120.1302,
  latitude: 30.2595,
  timezone: 'Asia/Shanghai',
  useTrueSolarTime: true,
  dstPolicy: 'auto' as const,
  dayBoundary: 'midnight' as const,
  luckMethod: 'sect1' as const,
  gender: 'male' as const,
}

function capturedExpected(): WenzhenExpected {
  const actual = calculateBazi(birth)
  return {
    pillars: [...actual.pillars],
    timeCorrectionRuleVersion: actual.timeCorrectionRuleVersion,
    correctedLocalTime: actual.correctedLocalTime,
    correctionMinutes: actual.correctionMinutes,
    timeProfile: { timezone: actual.timeProfile!.timezone, standardMeridian: actual.timeProfile!.standardMeridian },
    pillarDetails: [{ pillar: actual.pillarDetails![0].pillar, hiddenStems: [{ stem: actual.pillarDetails![0].hiddenStems[0].stem }] }] as WenzhenExpected['pillarDetails'],
    luckCycles: [{ pillar: actual.luckCycles![0].pillar, direction: actual.luckCycles![0].direction }] as WenzhenExpected['luckCycles'],
  }
}
const flowQuery = { targetDate: '2026-09-01', targetTime: '15:30' }
function capturedFlowExpected(): WenzhenExpected {
  const flow = calculateBaziFlow(birth, flowQuery)
  const currentAnnual = flow.annualCycles.find((cycle) => cycle.year === flow.selection.year)!
  const currentMonthly = flow.monthlyCycles.find((cycle) => cycle.month === flow.selection.month && cycle.year === flow.selection.year)!
  const currentDaily = flow.dailyCycles.find((cycle) => cycle.date === flow.selection.date)!
  const currentHourly = flow.hourlyCycles.find((cycle) => cycle.startHour === flow.selection.hourSlotStart)!
  return {
    ...capturedExpected(),
    annualCycles: [{ year: currentAnnual.year, pillar: currentAnnual.pillar }] as WenzhenExpected['annualCycles'],
    monthlyCycles: [{ year: currentMonthly.year, month: currentMonthly.month, pillar: currentMonthly.pillar }] as WenzhenExpected['monthlyCycles'],
    dailyCycles: [{ date: currentDaily.date, pillar: currentDaily.pillar }] as WenzhenExpected['dailyCycles'],
    hourlyCycles: [{ startHour: currentHourly.startHour, earthlyBranch: currentHourly.earthlyBranch, pillar: currentHourly.pillar }] as WenzhenExpected['hourlyCycles'],
  }
}

function fixture(overrides: Partial<VerifiedWenzhenFixture> = {}): VerifiedWenzhenFixture {
  return {
    sampleId: 'wz-test-001',
    source: 'wenzhen-manual-capture',
    sourceUrl: 'https://pcbz.iwzwh.com/#/paipan/index',
    capturedAt: '2026-08-31T10:20:30+08:00',
    evidenceRef,
    status: 'verified',
    birth,
    expected: capturedExpected(),
    ...overrides,
  }
}
function evidenceManifest(ref = evidenceRef, overrides: Record<string, unknown> = {}) {
  const hash = /^evidence\/wenzhen\/sha256-([a-f0-9]{64})\./.exec(ref)?.[1] ?? evidenceHash
  return {
    schemaVersion: 'wenzhen-evidence-manifest-v1',
    evidence: [{
      evidenceRef: ref,
      sha256: hash,
      mimeType: 'image/png',
      size: evidenceBytes.byteLength,
      capturedAt: '2026-08-31T10:20:30+08:00',
      captureMethod: 'manual-test-capture',
      ...overrides,
    }],
  }
}
async function writeEvidenceManifest(input: string, value = evidenceManifest()): Promise<void> {
  await writeFile(join(input, 'evidence-manifest.json'), JSON.stringify(value))
}
async function writeEvidenceBody(directory: string, ref = evidenceRef, bytes = evidenceBytes): Promise<void> {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, ref.split('/').at(-1)!), bytes)
}

describe('WenZhen fixture runtime schema and recursive report', () => {
  it('validates a complete captured fixture and compares every supported nested section', () => {
    const checked = validateWenzhenFixture(fixture({ flowQuery, expected: capturedFlowExpected() }))
    expect(checked.status).toBe('verified')
    const report = createWenzhenFixtureReport(checked as VerifiedWenzhenFixture)
    expect(report).toMatchObject({
      matched: true,
      outcome: 'passed',
      differences: [],
      assertionCoverage: {
        categories: ['pillars', 'time-correction', 'professional-table', 'luck-cycles', 'dynamic-cycles'],
        partial: true,
      },
    })
  })

  it('derives assertion coverage from expected fields without allowing a fixture to overclaim', () => {
    const expected = capturedFlowExpected()
    expect(deriveWenzhenAssertionCoverage({ pillars: expected.pillars })).toEqual({
      categories: ['pillars'],
      assertedTopLevelFields: ['pillars'],
      assertedLeafPaths: ['pillars[0]', 'pillars[1]', 'pillars[2]', 'pillars[3]'],
      partial: true,
    })
    expect(deriveWenzhenAssertionCoverage({
      pillars: expected.pillars,
      correctedLocalTime: expected.correctedLocalTime,
      pillarDetails: expected.pillarDetails,
      luckCycles: expected.luckCycles,
      hourlyCycles: expected.hourlyCycles,
    }).categories).toEqual(['pillars', 'time-correction', 'professional-table', 'luck-cycles', 'dynamic-cycles'])
  })

  it('preserves a legacy fixture payload while calculating it with the v2 default', () => {
    const checked = validateWenzhenFixture(fixture()) as VerifiedWenzhenFixture

    expect(checked.birth.timeCorrectionRuleVersion).toBeUndefined()
    expect(checked.flowQuery).toBeUndefined()
    expect(createWenzhenFixtureReport(checked)).toMatchObject({ matched: true, differences: [] })
  })

  it('compares dynamic expectations against the selected flow query rows instead of legacy birth-chart indexes', () => {
    const flow = calculateBaziFlow(birth, flowQuery)
    const expected: WenzhenExpected = {
      pillars: [...calculateBazi(birth).pillars],
      annualCycles: [{ year: flow.selection.year, pillar: flow.annualCycles.find((cycle) => cycle.year === flow.selection.year)!.pillar }],
      monthlyCycles: [{ year: flow.selection.year, month: flow.selection.month, pillar: flow.monthlyCycles.find((cycle) => cycle.month === flow.selection.month)!.pillar }],
      dailyCycles: [{ date: flow.selection.date, pillar: flow.dailyCycles.find((cycle) => cycle.date === flow.selection.date)!.pillar }],
      hourlyCycles: [{ startHour: flow.selection.hourSlotStart, pillar: flow.hourlyCycles.find((cycle) => cycle.startHour === flow.selection.hourSlotStart)!.pillar }],
    }
    const report = createWenzhenFixtureReport(fixture({ flowQuery, expected }))

    expect(flow.annualCycles[0].year).not.toBe(flow.selection.year)
    expect(report).toMatchObject({ matched: true, outcome: 'passed', differences: [] })
  })

  it('validates all dynamic WenZhen rows by their stable selection keys', () => {
    const flow = calculateBaziFlow(birth, flowQuery)
    const annual = flow.annualCycles.find((cycle) => cycle.year === flow.selection.year)!
    const monthly = flow.monthlyCycles.find((cycle) => cycle.year === flow.selection.year && cycle.month === flow.selection.month)!
    const daily = flow.dailyCycles.find((cycle) => cycle.date === flow.selection.date)!
    const hourly = flow.hourlyCycles.find((cycle) => cycle.startHour === flow.selection.hourSlotStart)!
    const expected: WenzhenExpected = {
      pillars: [...calculateBazi(birth).pillars],
      annualCycles: [{ year: annual.year, pillar: annual.pillar }],
      monthlyCycles: [{ year: monthly.year, month: monthly.month, pillar: monthly.pillar }],
      dailyCycles: [{ date: daily.date, pillar: daily.pillar }],
      hourlyCycles: [{ dateTime: hourly.dateTime, pillar: hourly.pillar }],
    }

    expect(validateWenzhenFixture(fixture({ flowQuery, expected }))).toMatchObject({ status: 'verified' })
    expect(createWenzhenFixtureReport(fixture({ flowQuery, expected }))).toMatchObject({ matched: true, outcome: 'passed' })
  })

  it('uses selection.monthYear for Li Chun monthly stable keys before the solar year changes', () => {
    const januaryQuery = { targetDate: '2024-01-15', targetTime: '12:00' }
    const flow = calculateBaziFlow(birth, januaryQuery)
    const monthly = flow.monthlyCycles.find((cycle) => cycle.year === flow.selection.monthYear && cycle.month === flow.selection.month)!
    const expected: WenzhenExpected = {
      pillars: [...calculateBazi(birth).pillars],
      monthlyCycles: [{ year: flow.selection.monthYear, month: flow.selection.month, pillar: monthly.pillar }],
    }

    expect(flow.selection).toMatchObject({ year: 2024, monthYear: 2023, month: 12 })
    expect(createWenzhenFixtureReport(fixture({ sampleId: 'wz-synthetic-lichun-monthyear', flowQuery: januaryQuery, expected }))).toMatchObject({ matched: true, outcome: 'passed' })
  })

  it('reports a missing monthly row when a Li Chun fixture uses selection.year instead of monthYear', () => {
    const januaryQuery = { targetDate: '2024-01-15', targetTime: '12:00' }
    const flow = calculateBaziFlow(birth, januaryQuery)
    const monthly = flow.monthlyCycles.find((cycle) => cycle.year === flow.selection.monthYear && cycle.month === flow.selection.month)!
    const report = createWenzhenFixtureReport(fixture({
      sampleId: 'wz-synthetic-lichun-wrong-year',
      flowQuery: januaryQuery,
      expected: {
        pillars: [...calculateBazi(birth).pillars],
        monthlyCycles: [{ year: flow.selection.year, month: flow.selection.month, pillar: monthly.pillar }],
      },
    }))

    expect(report.differences).toContainEqual({
      path: 'monthlyCycles{year=2024,month=12}',
      category: 'monthly-cycle',
      kind: 'missing',
      expected: { year: 2024, month: 12, pillar: monthly.pillar },
      actual: null,
      accepted: false,
    })
  })

  it('reports a missing daily row at the requested stable key path', () => {
    const report = createWenzhenFixtureReport(fixture({
      sampleId: 'wz-synthetic-missing-daily',
      flowQuery,
      expected: { ...capturedExpected(), dailyCycles: [{ date: '2026-10-01', pillar: '甲子' }] },
    }))

    expect(report.differences).toContainEqual({
      path: 'dailyCycles{date=2026-10-01}',
      category: 'daily-cycle',
      kind: 'missing',
      expected: { date: '2026-10-01', pillar: '甲子' },
      actual: null,
      accepted: false,
    })
  })

  it('selects hourly rows by dateTime before startHour when both keys are present', () => {
    const flow = calculateBaziFlow(birth, flowQuery)
    const byDateTime = flow.hourlyCycles.find((cycle) => cycle.startHour === 15)!
    const byStartHour = flow.hourlyCycles.find((cycle) => cycle.startHour === 17)!
    const report = createWenzhenFixtureReport(fixture({
      sampleId: 'wz-synthetic-hourly-datetime-priority',
      flowQuery,
      expected: {
        ...capturedExpected(),
        hourlyCycles: [{ dateTime: byDateTime.dateTime, startHour: byStartHour.startHour, pillar: byStartHour.pillar }],
      },
    }))

    expect(report.differences.map((difference) => difference.path)).toEqual([
      `hourlyCycles{dateTime=${byDateTime.dateTime}}.startHour`,
      `hourlyCycles{dateTime=${byDateTime.dateTime}}.pillar`,
    ])
  })

  it('fails closed when dynamic expectations omit or cannot calculate a flow query', () => {
    expect(() => validateWenzhenFixture(fixture({ expected: capturedFlowExpected() }))).toThrow(/flowQuery is required/)
    expect(() => validateWenzhenFixture(fixture({ flowQuery: { targetDate: '2023-02-29' }, expected: capturedFlowExpected() }))).toThrow(/flowQuery is not calculable/)
  })

  it('reports a difference when the expected time-correction rule version disagrees', () => {
    const report = createWenzhenFixtureReport(fixture({
      expected: { ...capturedExpected(), timeCorrectionRuleVersion: 'true-solar-v3-standard-time-equation-of-time' },
    }))

    expect(report.outcome).toBe('failed')
    expect(report.differences).toContainEqual({
      path: 'timeCorrectionRuleVersion',
      category: 'time-correction',
      kind: 'value',
      expected: 'true-solar-v3-standard-time-equation-of-time',
      actual: legacyTimeCorrectionRuleVersion,
      accepted: false,
    })
  })

  it('validates the evidence manifest without storing screenshots or account identifiers', () => {
    expect(validateWenzhenEvidenceManifest(evidenceManifest())).toMatchObject({
      schemaVersion: 'wenzhen-evidence-manifest-v1',
      evidence: [expect.objectContaining({ evidenceRef, sha256: evidenceHash, mimeType: 'image/png' })],
    })
    expect(() => validateWenzhenEvidenceManifest({ ...evidenceManifest(), accountId: 'hidden' })).toThrow(/unknown field/)
    expect(() => validateWenzhenEvidenceManifest(evidenceManifest(evidenceRef, { sourceUrl: 'https://pcbz.iwzwh.com' }))).toThrow(/unknown field/)
  })

  it('rejects template evidence and incomplete rule parameters instead of treating types as validation', () => {
    expect(() => validateWenzhenFixture(fixture({ capturedAt: 'YYYY-MM-DD' }))).toThrow(/capturedAt/)
    const incomplete = fixture() as unknown as Record<string, unknown>
    incomplete.birth = { ...birth, dayBoundary: undefined }
    expect(() => validateWenzhenFixture(incomplete)).toThrow(/birth.dayBoundary/)
    expect(() => validateWenzhenFixture(fixture({ expected: { ...capturedExpected(), pillars: ['待', '待', '待', '待'] } as unknown as WenzhenExpected }))).toThrow(/four real Gan-Zhi/)
    expect(() => validateWenzhenFixture(fixture({
      flowQuery,
      expected: { ...capturedExpected(), annualCycles: [{ year: 2026, pillar: '' }] } as unknown as WenzhenExpected,
    }))).toThrow(/annualCycles\[0\]\.pillar must be a non-empty captured value/)
    expect(() => validateWenzhenFixture(fixture({
      flowQuery,
      expected: { ...capturedExpected(), dailyCycles: [{ date: '2026-09-01', pillar: '待填写' }] } as unknown as WenzhenExpected,
    }))).toThrow(/dailyCycles\[0\]\.pillar contains a template placeholder/)
    expect(() => validateWenzhenFixture(fixture({
      flowQuery,
      expected: { ...capturedExpected(), monthlyCycles: [{ year: 2026, month: 9, pillar: '不是干支' }] } as unknown as WenzhenExpected,
    }))).toThrow(/monthlyCycles\[0\]\.pillar must be a real Gan-Zhi pillar/)
    expect(() => validateWenzhenFixture(fixture({
      flowQuery,
      expected: { ...capturedExpected(), annualCycles: [] } as unknown as WenzhenExpected,
    }))).toThrow(/annualCycles must contain at least one captured cycle/)
    expect(() => validateWenzhenFixture(fixture({
      flowQuery,
      expected: { ...capturedExpected(), annualCycles: [{ pillar: '丙午' }] } as unknown as WenzhenExpected,
    }))).toThrow(/annualCycles\[0\]\.year must be a positive integer/)
    expect(() => validateWenzhenFixture(fixture({
      flowQuery,
      expected: { ...capturedExpected(), monthlyCycles: [{ year: 2026, pillar: '壬申' }] } as unknown as WenzhenExpected,
    }))).toThrow(/monthlyCycles\[0\]\.month must be a positive integer/)
    expect(() => validateWenzhenFixture(fixture({
      flowQuery,
      expected: { ...capturedExpected(), dailyCycles: [{ pillar: '甲子' }] } as unknown as WenzhenExpected,
    }))).toThrow(/dailyCycles\[0\]\.date must be a non-empty string/)
    expect(() => validateWenzhenFixture(fixture({
      flowQuery,
      expected: { ...capturedExpected(), hourlyCycles: [{ pillar: '庚申' }] } as unknown as WenzhenExpected,
    }))).toThrow(/hourlyCycles\[0\] must include dateTime or startHour/)
    expect(() => validateWenzhenFixture(fixture({
      flowQuery,
      expected: { ...capturedExpected(), hourlyCycles: [{ startHour: 2, pillar: '庚申' }] } as unknown as WenzhenExpected,
    }))).toThrow(/hourlyCycles\[0\]\.startHour must be a supported two-hour slot start/)
  })

  it('rejects monthly dynamic stable keys outside the supported month range', () => {
    expect(() => validateWenzhenFixture(fixture({
      flowQuery,
      expected: { ...capturedExpected(), monthlyCycles: [{ year: 2026, month: 13, pillar: '壬申' }] } as unknown as WenzhenExpected,
    }))).toThrow(/monthlyCycles\[0\]\.month must be between 1 and 12/)
  })

  it('rejects an empty hourly dateTime even when startHour is present', () => {
    expect(() => validateWenzhenFixture(fixture({
      flowQuery,
      expected: { ...capturedExpected(), hourlyCycles: [{ dateTime: '', startHour: 15, pillar: '庚申' }] } as unknown as WenzhenExpected,
    }))).toThrow(/hourlyCycles\[0\]\.dateTime must be a non-empty string/)
  })

  it('emits recursive machine-readable paths and accepts only explicitly reviewed differences', () => {
    const expected = capturedExpected()
    const expectedWithDifferences: WenzhenExpected = {
      ...expected,
      timeProfile: { ...expected.timeProfile!, standardMeridian: 999 },
      dailyCycles: [{ date: '2026-09-01', pillar: '甲子' }],
    }
    const reviewed: AcceptedDifferenceWenzhenFixture = {
      ...fixture({ flowQuery, expected: expectedWithDifferences }),
      status: 'accepted-difference',
      acceptedAt: '2026-08-31T11:30:00+08:00',
      acceptedBy: 'expert-review-001',
      acceptedDifferences: [{ path: 'timeProfile.standardMeridian', reason: '问真固定采用东八区中央经线展示' }],
    }
    const report = createWenzhenFixtureReport(reviewed)
    expect(report.differences.map((item) => item.path)).toEqual(expect.arrayContaining(['timeProfile.standardMeridian', 'dailyCycles{date=2026-09-01}.pillar']))
    expect(report.differences.find((item) => item.path === 'timeProfile.standardMeridian')?.accepted).toBe(true)
    expect(report.differences.find((item) => item.path === 'dailyCycles{date=2026-09-01}.pillar')?.accepted).toBe(false)
    expect(report.outcome).toBe('failed')
  })

  it('uses the same recursive leaf paths for previews and persisted reports', () => {
    const expected = capturedExpected()
    const expectedWithPillarDifferences: WenzhenExpected = {
      ...expected,
      pillars: ['甲子', '乙丑', expected.pillars[2], expected.pillars[3]],
    }
    const preview = compareWenzhenExpected('wz-preview-paths', 'admin-preview', birth, expectedWithPillarDifferences)
    const persisted = createWenzhenFixtureReport(fixture({ expected: expectedWithPillarDifferences }))

    expect(preview).toMatchObject({
      sampleId: 'wz-preview-paths',
      source: 'admin-preview',
      matched: false,
      comparedPaths: expect.arrayContaining(['pillars']),
      pathSemantics: 'wenzhen-leaf-v1',
    })
    expect(preview.mismatches.map((item) => item.path)).toEqual(['pillars[0]', 'pillars[1]'])
    expect(preview.mismatches.map((item) => item.path)).toEqual(persisted.differences.map((item) => item.path))
  })

  it('is mutation-sensitive to one asserted nested leaf and reports its exact path', () => {
    const expected = capturedExpected()
    const report = createWenzhenFixtureReport(fixture({
      expected: {
        ...expected,
        timeProfile: { ...expected.timeProfile!, standardMeridian: 999 },
      },
    }))

    expect(report.differences).toHaveLength(1)
    expect(report.differences[0]).toMatchObject({
      path: 'timeProfile.standardMeridian',
      category: 'time-profile',
      kind: 'value',
    })
  })

  it('accepts classified compatibility differences, preserves legacy records, and never accepts a bug classification', () => {
    const expected = capturedExpected()
    const expectedWithOneDifference: WenzhenExpected = {
      ...expected,
      timeProfile: { ...expected.timeProfile!, standardMeridian: 999 },
    }
    const base: AcceptedDifferenceWenzhenFixture = {
      ...fixture({ expected: expectedWithOneDifference }),
      status: 'accepted-difference',
      acceptedAt: '2026-08-31T11:30:00+08:00',
      acceptedBy: 'expert-review-001',
      acceptedDifferences: [{ path: 'timeProfile.standardMeridian', reason: '问真展示采用不同中央经线口径' }],
    }
    expect(createWenzhenFixtureReport(base).outcome).toBe('accepted-difference')
    expect(createWenzhenFixtureReport({
      ...base,
      acceptedDifferences: [{ ...base.acceptedDifferences[0], classification: 'school-rule' }],
    }).outcome).toBe('accepted-difference')
    expect(() => validateWenzhenFixture({
      ...base,
      acceptedDifferences: [{ ...base.acceptedDifferences[0], classification: 'unknown' }],
    })).toThrow(/classification is unsupported/)
    expect(() => validateWenzhenFixture({
      ...base,
      acceptedDifferences: [{ ...base.acceptedDifferences[0], classification: 'bug' }],
    })).toThrow(/bug cannot be accepted/)
  })

  it('handles an ambiguous civil time deterministically when every rule parameter is explicit', () => {
    const ambiguousBirth = { ...birth, date: '2023-11-05', time: '01:30', locationName: 'New York', longitude: -74.006, latitude: 40.7128, timezone: 'America/New_York' }
    const actual = calculateBazi(ambiguousBirth)
    const checked = validateWenzhenFixture(fixture({ sampleId: 'wz-ambiguous-001', birth: ambiguousBirth, expected: { pillars: [...actual.pillars], timeProfile: { utcOffsetMinutes: actual.timeProfile!.utcOffsetMinutes } } as WenzhenExpected }))
    expect(createWenzhenFixtureReport(checked as VerifiedWenzhenFixture).outcome).toBe('passed')
  })
})

describe('WenZhen fixture directory generator', () => {
  it('writes a manifest and per-sample reports while pending is only counted', async () => {
    const root = await tempRoot(); const input = join(root, 'fixtures'); const output = join(root, 'result'); const evidenceDirectory = join(root, 'evidence')
    await mkdir(input)
    await writeFile(join(input, 'samples.json'), JSON.stringify({ samples: [fixture({ flowQuery, expected: capturedFlowExpected() }), { sampleId: 'wz-pending-001', source: 'wenzhen-manual-capture', status: 'pending-manual-verification' }] }))
    await writeEvidenceManifest(input)
    await writeEvidenceBody(evidenceDirectory)
    await writeFile(join(input, 'capture-matrix.json'), JSON.stringify([
      {
        id: 'wz-test-001',
        status: 'verified',
        scenario: 'baseline fixture',
        birth: { ...birth, timeCorrectionRuleVersion: legacyTimeCorrectionRuleVersion },
        flowQuery,
        capture: ['四柱', '流年'],
        risk: 'baseline',
        batch: 'unit',
        evidenceRef,
      },
      {
        id: 'wz-pending-matrix-001',
        status: 'pending-capture',
        scenario: 'pending fixture',
        birth: { ...birth, timeCorrectionRuleVersion: legacyTimeCorrectionRuleVersion },
        capture: ['流日'],
        risk: 'fine-cycles',
        batch: 'unit',
      },
    ]))
    await writeFile(join(input, 'matrix.json'), JSON.stringify([{ id: 'not-a-fixture' }]))
    const manifest = await generateWenzhenFixtureReports({ inputDirectory: input, outputDirectory: output, evidenceDirectory, now: () => new Date('2026-08-31T00:00:00Z') })
    expect(manifest.totals).toMatchObject({ fixtures: 2, pending: 1, verified: 1, passed: 1, failed: 0, ignoredJsonFiles: 3 })
    expect(manifest.captureMatrix).toMatchObject({
      totalPlanned: 2,
      verifiedPlanned: 1,
      pendingCapture: 1,
      passedFixtures: 1,
      pendingCaptureIds: ['wz-pending-matrix-001'],
      readiness: {
        allPlannedCaptured: false,
        everyVerifiedPlanHasPassingFixture: true,
        noUnplannedFixtures: true,
        noFailedFixtures: true,
        stage1ParityClaimReady: false,
      },
    })
    expect(manifest.captureMatrix?.coverageByRisk).toMatchObject({
      baseline: { planned: 1, verified: 1, pending: 0 },
      'fine-cycles': { planned: 1, verified: 0, pending: 1 },
    })
    expect(manifest.totals.coverage).toEqual({
      pillars: 1,
      'time-correction': 1,
      'professional-table': 1,
      'luck-cycles': 1,
      'dynamic-cycles': 1,
    })
    expect(manifest.totals.fieldCoverage).toEqual({
      timeCorrection: { ruleVersion: 1, correctedLocalTime: 1, correctionMinutes: 1, timeProfile: 1 },
      professional: { pillarDetails: 1 },
      luck: { luckCycles: 1 },
      dynamic: { annualCycles: 1, monthlyCycles: 1, dailyCycles: 1, hourlyCycles: 1 },
    })
    expect(manifest.reports[0]?.assertionCoverage).toMatchObject({
      assertedTopLevelFields: expect.arrayContaining(['timeCorrectionRuleVersion', 'pillarDetails', 'luckCycles', 'annualCycles']),
      assertedLeafPaths: expect.arrayContaining(['timeCorrectionRuleVersion', 'pillarDetails[0].pillar', 'luckCycles[0].pillar', 'annualCycles[0].pillar']),
    })
    expect(manifest.evidenceVerification).toMatchObject({ manifestEntries: 1, bodiesVerified: 1 })
    expect(manifest.totals.passed).not.toBe(manifest.totals.fixtures)
    expect(JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8')).generatedAt).toBe('2026-08-31T00:00:00.000Z')
    expect(JSON.parse(await readFile(join(output, 'reports', 'wz-test-001.json'), 'utf8')).outcome).toBe('passed')
    await expect(readFile(join(output, 'reports', 'wz-pending-001.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('ignores the reusable template instead of counting it as pending evidence', async () => {
    const root = await tempRoot(); const input = join(root, 'fixtures'); const output = join(root, 'result')
    await mkdir(input)
    await writeFile(join(input, 'template.json'), JSON.stringify({ sampleId: 'wenzhen-manual-000', source: 'wenzhen-manual-capture', status: 'pending-manual-verification' }))
    await writeFile(join(input, 'samples.json'), JSON.stringify({ samples: [{ sampleId: 'wz-pending-001', source: 'wenzhen-manual-capture', status: 'pending-manual-verification' }] }))

    const manifest = await generateWenzhenFixtureReports({ inputDirectory: input, outputDirectory: output })

    expect(manifest.totals).toMatchObject({ jsonFiles: 2, ignoredJsonFiles: 1, fixtures: 1, pending: 1 })
  })

  it('fails on malformed fixture files before creating output', async () => {
    const root = await tempRoot(); const input = join(root, 'fixtures'); const output = join(root, 'result')
    await mkdir(input); await writeFile(join(input, 'broken.json'), '{nope')
    await expect(generateWenzhenFixtureReports({ inputDirectory: input, outputDirectory: output })).rejects.toThrow(/cannot read JSON fixture file/)
    await expect(readFile(join(output, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses existing output and surfaces output filesystem failures', async () => {
    const root = await tempRoot(); const input = join(root, 'fixtures'); const existing = join(root, 'existing')
    await mkdir(input); await writeFile(join(input, 'sample.json'), JSON.stringify(fixture()))
    await writeEvidenceManifest(input)
    await mkdir(existing)
    await expect(generateWenzhenFixtureReports({ inputDirectory: input, outputDirectory: existing })).rejects.toThrow(/refusing to overwrite/)
    const blocker = join(root, 'regular-file'); await writeFile(blocker, 'not a directory')
    await expect(generateWenzhenFixtureReports({ inputDirectory: input, outputDirectory: join(blocker, 'result') })).rejects.toThrow()
  })

  it('fails verified fixtures without a matching evidence manifest entry', async () => {
    const root = await tempRoot(); const input = join(root, 'fixtures'); const output = join(root, 'result')
    await mkdir(input); await writeFile(join(input, 'sample.json'), JSON.stringify(fixture()))
    await expect(generateWenzhenFixtureReports({ inputDirectory: input, outputDirectory: output })).rejects.toThrow(/evidence-manifest\.json is required/)
    await writeEvidenceManifest(input, { schemaVersion: 'wenzhen-evidence-manifest-v1', evidence: [] })
    await expect(generateWenzhenFixtureReports({ inputDirectory: input, outputDirectory: output })).rejects.toThrow(/missing from evidence-manifest/)
  })

  it('fails on evidence manifest digest mismatches, duplicates, and orphan entries', async () => {
    const root = await tempRoot(); const input = join(root, 'fixtures'); const output = join(root, 'result')
    await mkdir(input); await writeFile(join(input, 'sample.json'), JSON.stringify(fixture()))
    await writeEvidenceManifest(input, evidenceManifest(evidenceRef, { sha256: 'b'.repeat(64) }))
    await expect(generateWenzhenFixtureReports({ inputDirectory: input, outputDirectory: output })).rejects.toThrow(/sha256 must match/)

    await writeEvidenceManifest(input, { schemaVersion: 'wenzhen-evidence-manifest-v1', evidence: [evidenceManifest().evidence[0], evidenceManifest().evidence[0]] })
    await expect(generateWenzhenFixtureReports({ inputDirectory: input, outputDirectory: output })).rejects.toThrow(/duplicate evidenceRef/)

    const orphanHash = 'b'.repeat(64)
    await writeEvidenceManifest(input, { schemaVersion: 'wenzhen-evidence-manifest-v1', evidence: [evidenceManifest().evidence[0], evidenceManifest(`evidence/wenzhen/sha256-${orphanHash}.png`, { sha256: orphanHash }).evidence[0]] })
    await expect(generateWenzhenFixtureReports({ inputDirectory: input, outputDirectory: output })).rejects.toThrow(/orphan evidenceRef/)
  })

  it('verifies immutable evidence bodies and fails closed when a screenshot is missing', async () => {
    const root = await tempRoot()
    const input = join(root, 'fixtures')
    const evidenceDirectory = join(root, 'evidence')
    const output = join(root, 'result')
    const missingOutput = join(root, 'missing-result')
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    const hash = createHash('sha256').update(bytes).digest('hex')
    const ref = `evidence/wenzhen/sha256-${hash}.png`

    await mkdir(input)
    await mkdir(evidenceDirectory)
    await writeFile(join(input, 'sample.json'), JSON.stringify(fixture({ evidenceRef: ref })))
    await writeEvidenceManifest(input, evidenceManifest(ref, { sha256: hash, size: bytes.byteLength }))
    await writeFile(join(evidenceDirectory, `sha256-${hash}.png`), bytes)

    const manifest = await generateWenzhenFixtureReports({ inputDirectory: input, outputDirectory: output, evidenceDirectory })
    expect(manifest.evidenceVerification).toMatchObject({ manifestEntries: 1, bodiesVerified: 1, directory: evidenceDirectory })

    await rm(join(evidenceDirectory, `sha256-${hash}.png`))
    await expect(generateWenzhenFixtureReports({ inputDirectory: input, outputDirectory: missingOutput, evidenceDirectory })).rejects.toThrow(/cannot read WenZhen evidence body/)
  })

  it('rejects evidence bodies whose digest or MIME signature does not match the manifest', async () => {
    const root = await tempRoot()
    const input = join(root, 'fixtures')
    const evidenceDirectory = join(root, 'evidence')
    const hashOutput = join(root, 'hash-result')
    const mimeOutput = join(root, 'mime-result')
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const hash = createHash('sha256').update(bytes).digest('hex')
    const ref = `evidence/wenzhen/sha256-${hash}.png`

    await mkdir(input)
    await mkdir(evidenceDirectory)
    await writeFile(join(input, 'sample.json'), JSON.stringify(fixture({ evidenceRef: ref })))
    await writeEvidenceManifest(input, evidenceManifest(ref, { sha256: hash, size: bytes.byteLength }))
    await writeFile(join(evidenceDirectory, `sha256-${hash}.png`), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b]))
    await expect(generateWenzhenFixtureReports({ inputDirectory: input, outputDirectory: hashOutput, evidenceDirectory })).rejects.toThrow(/SHA-256 does not match/)

    const invalidImage = Buffer.alloc(bytes.byteLength, 0)
    const invalidHash = createHash('sha256').update(invalidImage).digest('hex')
    const invalidRef = `evidence/wenzhen/sha256-${invalidHash}.png`
    await writeFile(join(input, 'sample.json'), JSON.stringify(fixture({ evidenceRef: invalidRef })))
    await writeEvidenceManifest(input, evidenceManifest(invalidRef, { sha256: invalidHash, size: invalidImage.byteLength }))
    await writeFile(join(evidenceDirectory, `sha256-${invalidHash}.png`), invalidImage)
    await expect(generateWenzhenFixtureReports({ inputDirectory: input, outputDirectory: mimeOutput, evidenceDirectory })).rejects.toThrow(/body signature does not match image\/png/)
  })
})

describe('WenZhen capture matrix governance', () => {
  it('validates every checked-in WenZhen fixture and its evidence binding with production parsers', async () => {
    const fixtureDirectory = join(currentDir, 'fixtures', 'wenzhen')
    const rawSamples = JSON.parse(await readFile(join(fixtureDirectory, 'samples.json'), 'utf8')) as { samples?: unknown[] }
    const rawManifest = JSON.parse(await readFile(join(fixtureDirectory, 'evidence-manifest.json'), 'utf8'))
    const manifest = validateWenzhenEvidenceManifest(rawManifest)
    const evidenceRefs = new Set(manifest.evidence.map((item) => item.evidenceRef))

    expect(Array.isArray(rawSamples.samples)).toBe(true)
    const samples = rawSamples.samples!.map((sample, index) => validateWenzhenFixture(sample, `samples.json#samples[${index}]`))
    expect(samples.length).toBeGreaterThan(0)
    for (const sample of samples) {
      if (sample.status === 'verified' || sample.status === 'accepted-difference') {
        expect(evidenceRefs.has(sample.evidenceRef), `${sample.sampleId} evidence must be declared in the manifest`).toBe(true)
      }
    }
  })

  it('keeps manual capture planned for every high-risk phase-1 chart behavior', async () => {
    const rawMatrix = JSON.parse(await readFile(join(currentDir, 'fixtures', 'wenzhen', 'capture-matrix.json'), 'utf8'))
    const matrix = validateWenzhenCaptureMatrix(rawMatrix)
    const samples = JSON.parse(await readFile(join(currentDir, 'fixtures', 'wenzhen', 'samples.json'), 'utf8')) as {
      samples: Array<{ sampleId: string; evidenceRef: string }>
    }
    const risks = new Set(matrix.map((item) => item.risk))
    const ids = matrix.map((item) => item.id)
    const verified = matrix.filter((item) => item.status === 'verified')
    const pending = matrix.filter((item) => item.status === 'pending-capture')

    expect(matrix).toHaveLength(31)
    expect(new Set(ids).size).toBe(31)
    expect(verified).toHaveLength(6)
    expect(pending).toHaveLength(25)
    expect(pending.every((item) => item.evidenceRef === undefined)).toBe(true)
    expect(verified.map((item) => ({ sampleId: item.id, evidenceRef: item.evidenceRef }))).toEqual(
      samples.samples.map(({ sampleId, evidenceRef }) => ({ sampleId, evidenceRef })),
    )
    const urumqiDstFixture = matrix.find((item) => item.id === 'wz-023-urumqi-dst-ignore')
    expect(urumqiDstFixture).toBeDefined()
    expect(deriveWenzhenScenarioRequirement(urumqiDstFixture!).requiredAssertionPaths).toEqual([
      'pillarDetails',
      'pillars',
    ])
    expect([...risks]).toEqual(expect.arrayContaining([
      'solar-term-boundary',
      'day-boundary',
      'true-solar-cross-day',
      'longitude-correction',
      'dst',
      'calendar-conversion',
      'lunar-boundary',
      'geo',
      'luck-start',
      'luck-direction',
      'fine-cycles',
      'display',
    ]))

    const missingRule = structuredClone(rawMatrix) as Array<Record<string, unknown>>
    delete (missingRule[5].birth as Record<string, unknown>).dstPolicy
    expect(() => validateWenzhenCaptureMatrix(missingRule)).toThrow(/birth\.dstPolicy/)

    const pollutedBirth = structuredClone(rawMatrix) as Array<Record<string, unknown>>
    ;(pollutedBirth[5].birth as Record<string, unknown>).targetDate = '2026-09-01'
    expect(() => validateWenzhenCaptureMatrix(pollutedBirth)).toThrow(/birth contains unknown field/)

    const inventedExpected = structuredClone(rawMatrix) as Array<Record<string, unknown>>
    inventedExpected[5].expected = { pillars: ['甲子', '甲子', '甲子', '甲子'] }
    expect(() => validateWenzhenCaptureMatrix(inventedExpected)).toThrow(/contains unknown field/)
  })

  it('derives versioned minimum assertion paths from a capture scenario', () => {
    const [entry] = validateWenzhenCaptureMatrix([{
      id: 'wz-requirement-001',
      status: 'pending-capture',
      scenario: 'professional and dynamic coverage',
      birth: { ...birth, timeCorrectionRuleVersion: legacyTimeCorrectionRuleVersion },
      flowQuery,
      capture: ['四柱', '真太阳时', '校正分钟', '专业表格', '当前大运', '流年', '流月', '流日', '流时'],
      risk: 'unit',
      batch: 'unit',
    }])

    expect(deriveWenzhenScenarioRequirement(entry)).toEqual({
      schemaVersion: 'wenzhen-scenario-requirement-v1',
      sampleId: 'wz-requirement-001',
      requiredAssertionPaths: [
        'annualCycles',
        'correctedLocalTime',
        'correctionMinutes',
        'dailyCycles',
        'hourlyCycles',
        'luckCycles',
        'monthlyCycles',
        'pillarDetails',
        'pillars',
      ],
      captureLabelCoverage: {
        machineAssertionLabels: ['四柱', '真太阳时', '校正分钟', '专业表格', '当前大运', '流年', '流月', '流日', '流时'],
        inputBoundLabels: [],
        manualReviewLabels: [],
        unmappedLabels: [],
      },
    })
  })

  it('requires the time profile for true-solar parameter-only captures', () => {
    const [entry] = validateWenzhenCaptureMatrix([{
      id: 'wz-requirement-parameter-only',
      status: 'pending-capture',
      scenario: 'true solar parameter coverage without visible corrected time',
      birth: { ...birth, timeCorrectionRuleVersion: legacyTimeCorrectionRuleVersion },
      capture: ['真太阳时参数口径', '四柱'],
      risk: 'unit',
      batch: 'unit',
    }])

    expect(deriveWenzhenScenarioRequirement(entry)).toMatchObject({
      requiredAssertionPaths: ['pillars', 'timeProfile'],
      captureLabelCoverage: { unmappedLabels: [] },
    })
  })

  it('classifies capture labels and fails governance for an unknown label', async () => {
    const [entry] = validateWenzhenCaptureMatrix([{
      id: 'wz-unmapped-label-001',
      status: 'pending-capture',
      scenario: 'unknown capture field must not silently pass governance',
      birth: { ...birth, timeCorrectionRuleVersion: legacyTimeCorrectionRuleVersion },
      capture: ['四柱', '未来新增但尚未映射的字段'],
      risk: 'unit',
      batch: 'unit',
    }])

    expect(deriveWenzhenScenarioRequirement(entry).captureLabelCoverage).toEqual({
      machineAssertionLabels: ['四柱'],
      inputBoundLabels: [],
      manualReviewLabels: [],
      unmappedLabels: ['未来新增但尚未映射的字段'],
    })

    const root = await tempRoot()
    const input = join(root, 'fixtures')
    const output = join(root, 'result')
    await mkdir(input)
    await writeFile(join(input, 'samples.json'), JSON.stringify({ samples: [] }))
    await writeFile(join(input, 'capture-matrix.json'), JSON.stringify([entry]))
    const manifest = await generateWenzhenFixtureReports({ inputDirectory: input, outputDirectory: output })
    expect(manifest.captureMatrix?.gateFailures).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'unmapped-capture-label', sampleId: entry.id }),
    ]))
    expect(manifest.captureMatrix?.readiness.noGovernanceFailures).toBe(false)
  })

  it('passes the strict Stage 1 gate only for a complete evidence-bound scenario', async () => {
    const root = await tempRoot()
    const input = join(root, 'fixtures')
    const output = join(root, 'result')
    const evidenceDirectory = join(root, 'evidence')
    const explicitBirth = { ...birth, timeCorrectionRuleVersion: legacyTimeCorrectionRuleVersion } as const
    const complete = fixture({ birth: explicitBirth, flowQuery, expected: capturedFlowExpected() })
    await mkdir(input)
    await writeFile(join(input, 'samples.json'), JSON.stringify({ samples: [complete] }))
    await writeEvidenceManifest(input)
    await writeEvidenceBody(evidenceDirectory)
    await writeFile(join(input, 'capture-matrix.json'), JSON.stringify([{
      id: complete.sampleId,
      status: 'verified',
      scenario: 'complete Stage 1 unit scenario',
      birth: explicitBirth,
      flowQuery,
      capture: ['四柱', '真太阳时', '专业表格', '前八步大运', '流年', '流月', '流日', '流时'],
      risk: 'unit',
      batch: 'unit',
      evidenceRef,
    }]))

    const manifest = await generateWenzhenFixtureReports({ inputDirectory: input, outputDirectory: output, evidenceDirectory })
    expect(manifest.captureMatrix?.gateFailures).toEqual([])
    expect(manifest.captureMatrix?.readiness).toMatchObject({ noGovernanceFailures: true, stage1ParityClaimReady: true })
    expect(() => assertWenzhenStage1Ready(manifest)).not.toThrow()
  })

  it('fails the strict gate for pending, drifted, weak, failed, and unplanned fixtures', async () => {
    const root = await tempRoot()
    const input = join(root, 'fixtures')
    const output = join(root, 'result')
    const evidenceDirectory = join(root, 'evidence')
    const explicitBirth = { ...birth, timeCorrectionRuleVersion: legacyTimeCorrectionRuleVersion } as const
    const currentPillars = capturedExpected().pillars
    const weakExpected = { pillars: ['甲子', currentPillars[1], currentPillars[2], currentPillars[3]] as const }
    const reportable = fixture({ birth: explicitBirth, flowQuery, expected: weakExpected })
    const unplanned = fixture({ sampleId: 'wz-unplanned-001', birth: explicitBirth })
    await mkdir(input)
    await writeFile(join(input, 'samples.json'), JSON.stringify({ samples: [reportable, unplanned] }))
    const secondEvidenceBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])
    const secondHash = createHash('sha256').update(secondEvidenceBytes).digest('hex')
    const secondRef = `evidence/wenzhen/sha256-${secondHash}.png`
    unplanned.evidenceRef = secondRef
    await writeFile(join(input, 'samples.json'), JSON.stringify({ samples: [reportable, unplanned] }))
    await writeEvidenceManifest(input, {
      schemaVersion: 'wenzhen-evidence-manifest-v1',
      evidence: [evidenceManifest().evidence[0], evidenceManifest(secondRef, { sha256: secondHash, size: secondEvidenceBytes.byteLength }).evidence[0]],
    })
    await writeEvidenceBody(evidenceDirectory)
    await writeFile(join(evidenceDirectory, `sha256-${secondHash}.png`), secondEvidenceBytes)
    await writeFile(join(input, 'capture-matrix.json'), JSON.stringify([
      {
        id: reportable.sampleId,
        status: 'verified',
        scenario: 'drifted verified scenario',
        birth: { ...explicitBirth, longitude: explicitBirth.longitude + 0.01 },
        flowQuery: { ...flowQuery, targetTime: '16:30' },
        capture: ['四柱', '真太阳时', '前八步大运', '流年'],
        risk: 'unit',
        batch: 'unit',
        evidenceRef: secondRef,
      },
      {
        id: 'wz-pending-001',
        status: 'pending-capture',
        scenario: 'pending scenario',
        birth: explicitBirth,
        capture: ['四柱'],
        risk: 'unit',
        batch: 'unit',
      },
    ]))

    const manifest = await generateWenzhenFixtureReports({ inputDirectory: input, outputDirectory: output, evidenceDirectory })
    const kinds = manifest.captureMatrix?.gateFailures.map((failure) => failure.kind)
    expect(kinds).toEqual(expect.arrayContaining([
      'pending-capture',
      'unplanned-fixture',
      'evidence-mismatch',
      'birth-input-drift',
      'flow-query-drift',
      'missing-required-assertion',
      'failed-fixture',
    ]))
    expect(manifest.captureMatrix?.readiness).toMatchObject({ noGovernanceFailures: false, stage1ParityClaimReady: false })
    expect(() => assertWenzhenStage1Ready(manifest)).toThrow(/Stage 1 gate failed/)
  })
})
