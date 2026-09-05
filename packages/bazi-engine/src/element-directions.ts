import type { ElementBalanceDirection, FiveElement } from '@fengshui/domain'

export const FIVE_ELEMENT_CYCLE: readonly FiveElement[] = ['wood', 'fire', 'earth', 'metal', 'water']

export const DAY_STEM_ELEMENTS: Readonly<Record<string, FiveElement>> = {
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
}

function cycleElement(element: FiveElement, offset: number): FiveElement {
  const index = FIVE_ELEMENT_CYCLE.indexOf(element)
  if (index < 0) throw new Error(`unsupported five element: ${element}`)
  return FIVE_ELEMENT_CYCLE[(index + offset + FIVE_ELEMENT_CYCLE.length) % FIVE_ELEMENT_CYCLE.length]!
}

export function resourceElementForBaseline(dayElement: FiveElement): FiveElement {
  return cycleElement(dayElement, -1)
}

export function outputElementForBaseline(dayElement: FiveElement): FiveElement {
  return cycleElement(dayElement, 1)
}

export function wealthElementForBaseline(dayElement: FiveElement): FiveElement {
  return cycleElement(dayElement, 2)
}

export function officerElementForBaseline(dayElement: FiveElement): FiveElement {
  return cycleElement(dayElement, -2)
}

function uniqueElements(elements: readonly FiveElement[]): readonly FiveElement[] {
  return [...new Set(elements)]
}

export function buildElementBalanceDirection(
  dayElement: FiveElement,
  direction: ElementBalanceDirection['direction'],
): ElementBalanceDirection {
  const supportElements = uniqueElements([dayElement, resourceElementForBaseline(dayElement)])
  const reducingElements = uniqueElements([
    outputElementForBaseline(dayElement),
    wealthElementForBaseline(dayElement),
    officerElementForBaseline(dayElement),
  ])
  const limitations = [
    '仅为 seasonal-support-baseline-v1 扶抑基线的候选五行方向',
    '不等同于完整喜神、忌神或用神结论',
    '格局、调候、通关、病药及具体流派取用仍需专家规则复核',
  ]

  if (direction === 'add-support') {
    return {
      scope: 'support-balance-baseline',
      direction,
      candidateElements: supportElements,
      cautiousElements: reducingElements,
      limitations,
    }
  }

  if (direction === 'reduce-support') {
    return {
      scope: 'support-balance-baseline',
      direction,
      candidateElements: reducingElements,
      cautiousElements: supportElements,
      limitations,
    }
  }

  return {
    scope: 'support-balance-baseline',
    direction,
    candidateElements: [],
    cautiousElements: [],
    limitations,
  }
}
