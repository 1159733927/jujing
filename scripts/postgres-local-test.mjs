#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

const DEFAULT_PORT = 55433
const DEFAULT_USER = 'fengshui_test'
const DEFAULT_DB = 'fengshui_test'

function localPathCandidates(name) {
  const paths = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, name))
  return [
    process.env[`FENGSHUI_${name.toUpperCase()}_BIN`],
    ...paths,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ].filter(Boolean)
}

async function firstWorkingBinary(name) {
  const candidates = [...new Set(localPathCandidates(name))]
  for (const candidate of candidates) {
    const result = await run(candidate, ['--version'], { allowFailure: true, silent: true })
    if (result.code === 0) return candidate
  }
  throw new Error(`Cannot find a working ${name} binary. Install PostgreSQL locally, or set FENGSHUI_${name.toUpperCase()}_BIN.`)
}

function run(command, args, options = {}) {
  const { env, allowFailure = false, silent = false } = options
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: silent ? 'ignore' : 'inherit',
      shell: false,
    })
    child.on('error', (error) => {
      if (allowFailure) return resolve({ code: 1, signal: error.code ?? 'spawn-error' })
      reject(error)
    })
    child.on('exit', (code, signal) => {
      if (code === 0 || allowFailure) return resolve({ code, signal })
      reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal ?? 'unknown status'}`))
    })
  })
}

async function main() {
  const [initdb, pgCtl, psql] = await Promise.all([
    firstWorkingBinary('initdb'),
    firstWorkingBinary('pg_ctl'),
    firstWorkingBinary('psql'),
  ])
  const port = Number.parseInt(process.env.POSTGRES_TEST_PORT ?? String(DEFAULT_PORT), 10)
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error('POSTGRES_TEST_PORT must be an integer between 1024 and 65535')
  }

  const dataDir = await mkdtemp(join(tmpdir(), 'fengshui-pgdata.'))
  const socketDir = await mkdtemp(join(tmpdir(), 'fengshui-pgsocket.'))
  let started = false
  const stop = async () => {
    if (!started) return
    await run(pgCtl, ['-D', dataDir, '-m', 'fast', 'stop'], { allowFailure: true, silent: true })
    process.stderr.write(`[postgres-local-test] stopped temporary PostgreSQL\n`)
    process.stderr.write(`[postgres-local-test] temp data kept at ${dataDir}\n`)
    process.stderr.write(`[postgres-local-test] temp socket kept at ${socketDir}\n`)
  }
  process.once('SIGINT', () => {
    void stop().finally(() => process.exit(130))
  })
  process.once('SIGTERM', () => {
    void stop().finally(() => process.exit(143))
  })

  try {
    await run(initdb, ['-D', dataDir, '-A', 'trust', `--username=${DEFAULT_USER}`, '--no-locale', '--encoding=UTF8'], { silent: true })
    await run(pgCtl, ['-D', dataDir, '-o', `-F -p ${port} -k ${socketDir} -h 127.0.0.1`, '-l', join(dataDir, 'server.log'), 'start'])
    started = true
    await run(psql, ['-h', '127.0.0.1', '-p', String(port), '-U', DEFAULT_USER, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `create database ${DEFAULT_DB}`], { silent: true })
    await run('pnpm', ['test:postgres'], {
      env: {
        TEST_DATABASE_URL: `postgres://${DEFAULT_USER}@127.0.0.1:${port}/${DEFAULT_DB}`,
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY?.trim() ? process.env.DEEPSEEK_API_KEY : 'dummy',
      },
    })
  } finally {
    await stop()
  }
}

main().catch((error) => {
  process.stderr.write(`[postgres-local-test] failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
