import { describe, expect, it } from 'vitest'
import {
  DAY_STEM_ELEMENTS,
  buildElementBalanceDirection,
  officerElementForBaseline,
  outputElementForBaseline,
  resourceElementForBaseline,
  wealthElementForBaseline,
} from '../src/index.js'

describe('support-balance element directions', () => {
  it('maps all ten day stems to their five elements', () => {
    expect(DAY_STEM_ELEMENTS).toEqual({
      甲: 'wood',
      乙: 'wood',
      丙: 'fire',
      丁: 'fire',
      戊: 'earth',
      己: 'earth',
      庚: 'metal',
      辛: 'metal',
      壬: 'water',
      癸: 'water',
    })
  })

  it('derives support and reducing element groups from the generating cycle', () => {
    expect(resourceElementForBaseline('fire')).toBe('wood')
    expect(outputElementForBaseline('fire')).toBe('earth')
    expect(wealthElementForBaseline('fire')).toBe('metal')
    expect(officerElementForBaseline('fire')).toBe('water')

    expect(buildElementBalanceDirection('fire', 'add-support')).toMatchObject({
      scope: 'support-balance-baseline',
      direction: 'add-support',
      candidateElements: ['fire', 'wood'],
      cautiousElements: ['earth', 'metal', 'water'],
    })
    expect(buildElementBalanceDirection('fire', 'reduce-support')).toMatchObject({
      scope: 'support-balance-baseline',
      direction: 'reduce-support',
      candidateElements: ['earth', 'metal', 'water'],
      cautiousElements: ['fire', 'wood'],
    })
  })

  it('leaves candidates empty when the baseline is near balanced', () => {
    expect(buildElementBalanceDirection('water', 'balanced-undetermined')).toMatchObject({
      scope: 'support-balance-baseline',
      direction: 'balanced-undetermined',
      candidateElements: [],
      cautiousElements: [],
    })
  })
})
