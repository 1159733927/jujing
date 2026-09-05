import { mkdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Write a brand-new report directory and expose it with one atomic rename. */
export async function writeJsonDirectoryAtomically(outputDirectory, entries) {
  const serialized = entries.map(([fileName, value]) => {
    if (!fileName || basename(fileName) !== fileName) throw new Error(`Invalid output file name: ${fileName}`)
    return [fileName, `${JSON.stringify(value, null, 2)}\n`]
  })
  const parentDirectory = dirname(outputDirectory)
  const temporaryDirectory = join(parentDirectory, `.${basename(outputDirectory)}.tmp-${randomUUID()}`)
  await mkdir(parentDirectory, { recursive: true })
  await mkdir(temporaryDirectory)
  try {
    const writes = await Promise.allSettled(serialized.map(([fileName, text]) =>
      writeFile(join(temporaryDirectory, fileName), text, { encoding: 'utf8', flag: 'wx' }),
    ))
    const failedWrite = writes.find((result) => result.status === 'rejected')
    if (failedWrite) throw failedWrite.reason
    await rename(temporaryDirectory, outputDirectory)
  } catch (error) {
    await Promise.all(serialized.map(async ([fileName]) => {
      try {
        await unlink(join(temporaryDirectory, fileName))
      } catch (cleanupError) {
        if (!cleanupError || cleanupError.code !== 'ENOENT') throw cleanupError
      }
    }))
    try {
      await rmdir(temporaryDirectory)
    } catch (cleanupError) {
      if (!cleanupError || cleanupError.code !== 'ENOENT') throw cleanupError
    }
    if (error && (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')) {
      throw new Error(`Refusing to replace existing output directory: ${outputDirectory}`)
    }
    throw error
  }
}
