/* @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import { ApiRequestError } from '../api'
import {
  buildRuleProfileRevisionPayload,
  buildRuleProfileWorkingDefinition,
  defaultTrueSolarTimeRuleVersion,
  normalizeRuleProfileDefinition,
  ruleProfileDraftFromProfile,
  ruleProfileSaveErrorMessage,
  trueSolarTimeRuleVersionLabels,
} from './rule-profiles'

const definition = {
  schemaVersion: 2,
  timeDefaults: {
    timezone: 'Asia/Shanghai',
    dstPolicy: 'auto',
    useTrueSolarTime: true,
    timeCorrectionRuleVersion: defaultTrueSolarTimeRuleVersion,
    dayBoundary: 'midnight',
    luckMethod: 'sect1',
  },
  assessments: {
    strength: { enabled: false, method: 'decision-table-v1', ruleSetVersion: '2.0.0', rules: [] },
    pattern: { enabled: false, method: 'decision-table-v1', ruleSetVersion: '2.0.0', rules: [] },
    shenSha: { enabled: false, method: 'decision-table-v1', ruleSetVersion: '2.0.0', rules: [] },
  },
} as const

const profile = {
  id: 'profile-1',
  key: 'traditional-standard',
  name: '传统子平',
  description: '默认演示流派',
  state: 'published',
  revision: 7,
  workingDefinition: definition,
  updatedAt: '2026-09-01T00:00:00.000Z',
}

describe('admin rule-profile revision flow', () => {
  it('starts an edit draft from the selected profile revision', () => {
    const draft = ruleProfileDraftFromProfile(profile as any)

    expect(draft).toMatchObject({
      key: 'traditional-standard',
      name: '传统子平',
      description: '默认演示流派',
      expectedRevision: 7,
    })
    draft.definition.timeDefaults.timezone = 'Asia/Tokyo'
    expect(profile.workingDefinition.timeDefaults.timezone).toBe('Asia/Shanghai')
  })

  it('submits rule profile revisions with expectedRevision', () => {
    const draft = ruleProfileDraftFromProfile(profile as any)
    draft.name = '  传统子平修订  '
    draft.description = '  新说明  '

    expect(buildRuleProfileRevisionPayload(draft, definition as any)).toEqual({
      name: '传统子平修订',
      description: '新说明',
      workingDefinition: definition,
      expectedRevision: 7,
    })
  })

  it('rejects revision payloads that do not come from an existing profile', () => {
    expect(() => buildRuleProfileRevisionPayload({
      key: 'new-school',
      name: '新流派',
      description: '',
      definition: definition as any,
    }, definition as any)).toThrow('流派规则修订基线无效')
  })

  it('maps an HTTP 409 to the explicit refresh-and-retry message', () => {
    expect(ruleProfileSaveErrorMessage(new ApiRequestError('bazi rule profile revision conflict', 409)))
      .toBe('流派规则已被他人更新，请刷新后重试')
    expect(ruleProfileSaveErrorMessage(new ApiRequestError('bad request', 400))).toBe('bad request')
  })
})

describe('admin rule-profile true solar time defaults', () => {
  const emptyAssessments = {
    strength: { enabled: false, method: 'decision-table-v1', ruleSetVersion: '2.0.0', rules: [] },
    pattern: { enabled: false, method: 'decision-table-v1', ruleSetVersion: '2.0.0', rules: [] },
    shenSha: { enabled: false, method: 'decision-table-v1', ruleSetVersion: '2.0.0', rules: [] },
  }

  const baseDefinition = {
    schemaVersion: 2,
    timeDefaults: {
      timezone: 'Asia/Shanghai',
      dstPolicy: 'auto',
      useTrueSolarTime: true,
      timeCorrectionRuleVersion: defaultTrueSolarTimeRuleVersion,
      dayBoundary: 'midnight',
      luckMethod: 'sect1',
    },
    assessments: emptyAssessments,
  } as const

  it('defaults new and legacy-missing profile definitions to true-solar v2', () => {
    expect(defaultTrueSolarTimeRuleVersion).toBe('true-solar-v2-zone-meridian-equation-of-time')

    const legacyMissingVersion = {
      ...baseDefinition,
      timeDefaults: {
        timezone: 'Asia/Shanghai',
        dstPolicy: 'auto',
        useTrueSolarTime: true,
        dayBoundary: 'midnight',
        luckMethod: 'sect1',
      },
    }

    expect(normalizeRuleProfileDefinition(legacyMissingVersion as any).timeDefaults.timeCorrectionRuleVersion).toBe(defaultTrueSolarTimeRuleVersion)
  })

  it('preserves an explicit v3 choice without referencing the Wenzhen comparator', () => {
    const normalized = normalizeRuleProfileDefinition({
      ...baseDefinition,
      timeDefaults: {
        ...baseDefinition.timeDefaults,
        timeCorrectionRuleVersion: 'true-solar-v3-standard-time-equation-of-time',
      },
    })

    expect(normalized.timeDefaults.timeCorrectionRuleVersion).toBe('true-solar-v3-standard-time-equation-of-time')
    expect(trueSolarTimeRuleVersionLabels['true-solar-v3-standard-time-equation-of-time']).not.toContain('问真')
  })

  it('writes the time algorithm version explicitly when saving a working definition', () => {
    const workingDefinition = buildRuleProfileWorkingDefinition({
      ...baseDefinition,
      timeDefaults: {
        timezone: 'Asia/Shanghai',
        dstPolicy: 'ignore',
        useTrueSolarTime: false,
        dayBoundary: 'zi-hour-start',
        luckMethod: 'sect2',
      },
    } as any, { strength: [], pattern: [], shenSha: [] } as any)

    expect(workingDefinition.timeDefaults).toMatchObject({
      useTrueSolarTime: false,
      timeCorrectionRuleVersion: defaultTrueSolarTimeRuleVersion,
    })
  })
})
