import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { writeJsonDirectoryAtomically } from './atomic-json-output.mjs'

test('publishes a complete JSON report directory in one commit', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'geo-atomic-output-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const output = join(root, 'report')

  await writeJsonDirectoryAtomically(output, [
    ['manifest.json', { version: 1 }],
    ['candidates.json', [{ code: '330106' }]],
  ])

  assert.deepEqual((await readdir(output)).sort(), ['candidates.json', 'manifest.json'])
  assert.deepEqual(JSON.parse(await readFile(join(output, 'candidates.json'), 'utf8')), [{ code: '330106' }])
})

test('refuses an existing directory without mixing old and new report files', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'geo-atomic-output-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const output = join(root, 'report')
  await mkdir(output)
  await writeFile(join(output, 'manifest.json'), '{"old":true}\n')

  await assert.rejects(
    writeJsonDirectoryAtomically(output, [
      ['manifest.json', { old: false }],
      ['candidates.json', [{ code: '330106' }]],
    ]),
    /Refusing to replace existing output directory/,
  )

  assert.deepEqual(await readdir(output), ['manifest.json'])
  assert.deepEqual(JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8')), { old: true })
  assert.deepEqual((await readdir(root)).filter((name) => name.includes('.tmp-')), [])
})

test('serialization failure creates no partial output directory', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'geo-atomic-output-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const output = join(root, 'report')

  await assert.rejects(
    writeJsonDirectoryAtomically(output, [['manifest.json', { unsupported: 1n }]]),
    /BigInt/,
  )

  assert.deepEqual(await readdir(root), [])
})
