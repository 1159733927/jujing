/* @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import { ApiRequestError } from '../api'
import {
  buildKnowledgeRevisionPayload,
  isKnowledgeAssetRevisable,
  knowledgeRevisionDraftFromAsset,
  knowledgeRevisionErrorMessage,
} from './knowledge'

const publishedAsset = {
  id: 'knowledge-1',
  version: 3,
  state: 'published',
  kind: 'article',
  title: '客厅采光',
  sourceLabel: '林老师课程',
  tags: ['客厅', '采光'],
  body: '第一版正文',
}

describe('knowledge revision admin flow', () => {
  it('maps an HTTP 409 to the explicit refresh-and-retry message', () => {
    expect(knowledgeRevisionErrorMessage(new ApiRequestError('knowledge asset revision conflict', 409)))
      .toBe('资料已被他人更新，请刷新后重试')
    expect(knowledgeRevisionErrorMessage(new ApiRequestError('bad request', 400))).toBe('bad request')
  })

  it('keeps editing isolated so cancelling cannot mutate the listed asset', () => {
    const asset = {
      ...publishedAsset,
      kind: 'rule',
      rule: {
        priority: 100,
        conditions: [{ fact: 'residence.facing', operator: 'equals', value: '南' }],
        conclusions: [{ code: 'south-facing', text: '朝南', level: 'info' }],
      },
    }
    let activeDraft = knowledgeRevisionDraftFromAsset(asset as any)
    activeDraft.title = '未保存标题'
    ;(activeDraft.rule!.conditions[0] as { value: string }).value = '北'
    activeDraft = null as any

    expect(activeDraft).toBeNull()
    expect(asset.title).toBe('客厅采光')
    expect(asset.rule.conditions[0]!.value).toBe('南')
  })

  it('blocks empty or invalid input before issuing a request', () => {
    const draft = knowledgeRevisionDraftFromAsset(publishedAsset as any)
    draft.body = '   '
    expect(() => buildKnowledgeRevisionPayload(draft)).toThrow('正文不能为空')
  })

  it('only offers revisions for draft and published assets', () => {
    expect(isKnowledgeAssetRevisable({ state: 'draft' })).toBe(true)
    expect(isKnowledgeAssetRevisable({ state: 'published' })).toBe(true)
    expect(isKnowledgeAssetRevisable({ state: 'in-review' })).toBe(false)
    expect(isKnowledgeAssetRevisable({ state: 'archived' })).toBe(false)
  })
})
