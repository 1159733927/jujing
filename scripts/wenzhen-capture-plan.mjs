#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_MATRIX_PATH = 'packages/bazi-engine/tests/fixtures/wenzhen/capture-matrix.json'
const DEFAULT_WENZHEN_URL = 'https://pcbz.iwzwh.com/#/paipan/index'

export function isMainModule(metaUrl = import.meta.url, argv1 = process.argv[1]) {
  return argv1 ? resolve(fileURLToPath(metaUrl)) === resolve(argv1) : false
}

export function pendingWenzhenCaptures(matrix) {
  if (!Array.isArray(matrix)) throw new Error('capture matrix must be an array')
  return matrix.filter((item) => item?.status === 'pending-capture')
}

export function groupCapturesByBatch(captures) {
  return captures.reduce((groups, capture) => {
    const batch = typeof capture.batch === 'string' && capture.batch.trim() ? capture.batch.trim() : 'unbatched'
    if (!groups.has(batch)) groups.set(batch, [])
    groups.get(batch).push(capture)
    return groups
  }, new Map())
}

function compactBirthLine(birth) {
  const calendar = birth.calendarSystem === 'lunar' ? '农历' : '公历'
  const gender = birth.gender === 'female' ? '女' : birth.gender === 'male' ? '男' : '未提供'
  const trueSolar = birth.useTrueSolarTime ? '真太阳时开' : '真太阳时关'
  const boundary = birth.dayBoundary === 'zi-hour-start' ? '子初换日' : '午夜换日'
  const luck = birth.luckMethod === 'sect2' ? '起运流派二' : '起运流派一'
  return `${calendar} ${birth.date} ${birth.time}｜${gender}｜${birth.locationName}｜${trueSolar}｜${boundary}｜${luck}｜DST ${birth.dstPolicy ?? 'auto'}`
}

export function renderWenzhenCapturePlan(captures, options = {}) {
  const url = options.url ?? DEFAULT_WENZHEN_URL
  const groups = groupCapturesByBatch(captures)
  const lines = [
    '# 问真待采集清单',
    '',
    `来源页面：${url}`,
    '',
    `待采集：${captures.length} 条`,
    '',
    '规则：只录问真页面真实显示结果；不要把本项目排盘结果复制进去。每条保存脱敏截图，再录入四柱/真太阳时/专业表格/大运或流盘字段。',
  ]
  for (const [batch, items] of groups) {
    lines.push('', `## ${batch}（${items.length} 条）`)
    for (const item of items) {
      lines.push(
        '',
        `### ${item.id}`,
        '',
        `- 场景：${item.scenario}`,
        `- 输入：${compactBirthLine(item.birth ?? {})}`,
        `- 必看字段：${Array.isArray(item.capture) ? item.capture.join('、') : '四柱'}`,
        `- 风险点：${item.risk ?? '未标注'}`,
        '- 截图要求：能看到输入条件、页签和待核对结果；裁掉姓名、手机号、头像。',
      )
      if (item.flowQuery) {
        lines.push(`- 流盘目标：${item.flowQuery.targetDate}${item.flowQuery.targetTime ? ` ${item.flowQuery.targetTime}` : ''}`)
      }
    }
  }
  return `${lines.join('\n')}\n`
}

async function readMatrix(path = DEFAULT_MATRIX_PATH) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function main() {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const pathIndex = args.indexOf('--matrix')
  const matrixPath = pathIndex >= 0 ? args[pathIndex + 1] : DEFAULT_MATRIX_PATH
  if (pathIndex >= 0 && !matrixPath) throw new Error('--matrix requires a path')
  const captures = pendingWenzhenCaptures(await readMatrix(matrixPath))
  if (json) {
    process.stdout.write(`${JSON.stringify({ pending: captures.length, byBatch: Object.fromEntries([...groupCapturesByBatch(captures)].map(([batch, items]) => [batch, items.map((item) => item.id)])), captures }, null, 2)}\n`)
    return
  }
  process.stdout.write(renderWenzhenCapturePlan(captures))
}

if (isMainModule()) {
  main().catch((error) => {
    process.stderr.write(`[wenzhen-capture-plan] failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
