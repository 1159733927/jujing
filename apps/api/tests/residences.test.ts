import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ResidenceSnapshot } from '@fengshui/domain'
import { ResidenceRepository, ResidenceRevisionConflictError, ResidenceVersionRestoreConflictError } from '../src/residences.js'

const southHome: ResidenceSnapshot = {
  schemaVersion: 'residence-snapshot-v1',
  label: '南向住宅',
  facing: 'south',
  layoutNote: '客厅在东侧，厨房在南侧。',
}

const northHome: ResidenceSnapshot = {
  schemaVersion: 'residence-snapshot-v1',
  label: '北向住宅',
  facing: 'north',
  layoutNote: '书房靠北，卧室靠西。',
}

describe('ResidenceRepository', () => {
  it('stores multiple active residences for one principal and hides other principals', async () => {
    const repository = await createRepository('fengshui-residences-list-')
    const first = await repository.create('principal-one', southHome)
    const second = await repository.create('principal-one', northHome)
    await repository.create('principal-two', { ...southHome, label: '他人住宅' })

    await expect(repository.list('principal-one')).resolves.toMatchObject([
      { id: second.id, principalId: 'principal-one', currentVersion: { snapshot: northHome } },
      { id: first.id, principalId: 'principal-one', currentVersion: { snapshot: southHome } },
    ])
    await expect(repository.get(first.id, 'principal-two')).resolves.toBeUndefined()
    await expect(repository.list('principal-two')).resolves.toHaveLength(1)
  })

  it('serializes writes and rejects stale residence revisions', async () => {
    const repository = await createRepository('fengshui-residences-lock-')
    const profile = await repository.create('principal-one', southHome)

    const staleWrite = repository.appendVersion(profile.id, 'principal-one', 1, {
      ...southHome,
      label: '陈旧写入',
    })
    const winningWrite = repository.appendVersion(profile.id, 'principal-one', 1, {
      ...southHome,
      label: '获胜写入',
    })
    const outcomes = await Promise.allSettled([staleWrite, winningWrite])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({ reason: expect.any(ResidenceRevisionConflictError) })
    await expect(repository.get(profile.id, 'principal-one')).resolves.toMatchObject({ revision: 2 })
    await expect(repository.listVersions(profile.id, 'principal-one')).resolves.toHaveLength(2)
  })

  it('restores an old version by appending a new immutable version', async () => {
    const repository = await createRepository('fengshui-residences-restore-version-')
    const profile = await repository.create('principal-one', southHome)
    const originalVersionId = profile.currentVersion.id
    const updated = await repository.appendVersion(profile.id, 'principal-one', 1, northHome)

    const restored = await repository.restoreVersion(profile.id, 'principal-one', originalVersionId, updated!.revision)

    expect(restored).toMatchObject({
      revision: 3,
      currentVersion: {
        version: 3,
        restoredFromVersionId: originalVersionId,
        snapshot: southHome,
      },
    })
    const versions = await repository.listVersions(profile.id, 'principal-one')
    expect(versions?.map((version) => version.version)).toEqual([3, 2, 1])
    expect(versions?.find((version) => version.version === 1)?.snapshot).toEqual(southHome)
  })

  it('soft deletes, restores, and keeps exact versions available only to the owner', async () => {
    const repository = await createRepository('fengshui-residences-delete-')
    const profile = await repository.create('principal-one', southHome)
    const versionId = profile.currentVersion.id

    await expect(repository.softDelete(profile.id, 'principal-two')).resolves.toBe(false)
    await expect(repository.softDelete(profile.id, 'principal-one')).resolves.toBe(true)
    await expect(repository.get(profile.id, 'principal-one')).resolves.toBeUndefined()
    await expect(repository.list('principal-one')).resolves.toEqual([])
    await expect(repository.listVersions(profile.id, 'principal-one')).resolves.toHaveLength(1)
    await expect(repository.listVersions(profile.id, 'principal-two')).resolves.toBeUndefined()
    await expect(repository.restoreVersion(profile.id, 'principal-one', versionId, 1)).rejects.toBeInstanceOf(ResidenceVersionRestoreConflictError)

    const restored = await repository.restore(profile.id, 'principal-one')
    expect(restored).toMatchObject({ id: profile.id, revision: 1, currentVersion: { snapshot: southHome } })
    await expect(repository.get(profile.id, 'principal-one')).resolves.toMatchObject({ id: profile.id })
  })

  it('returns cloned profiles and writes valid json after concurrent creates', async () => {
    const { repository, path } = await createRepositoryWithPath('fengshui-residences-json-')
    const profiles = await Promise.all(Array.from({ length: 8 }, (_, index) => repository.create('principal-one', {
      ...southHome,
      label: `住宅 ${index}`,
    })))
    const first = await repository.get(profiles[0]!.id, 'principal-one')
    ;(first!.currentVersion.snapshot as { label: string }).label = '外部篡改'

    expect((await repository.get(profiles[0]!.id, 'principal-one'))?.currentVersion.snapshot.label).toBe('住宅 0')
    const data = JSON.parse(await readFile(path, 'utf8')) as { profiles: unknown[]; versions: unknown[] }
    expect(data.profiles).toHaveLength(8)
    expect(data.versions).toHaveLength(8)
  })
})

async function createRepository(prefix: string): Promise<ResidenceRepository> {
  return (await createRepositoryWithPath(prefix)).repository
}

async function createRepositoryWithPath(prefix: string): Promise<{ repository: ResidenceRepository; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  const path = join(directory, 'residences.json')
  return { repository: new ResidenceRepository(path), path }
}
