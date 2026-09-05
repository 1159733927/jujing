import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'

const postgresTestFiles = [
  'tests/postgres-account.integration.test.ts',
  'tests/postgres-wenzhen.integration.test.ts',
  'tests/postgres-knowledge.integration.test.ts',
  'tests/postgres-chart.integration.test.ts',
  'tests/postgres-residence.integration.test.ts',
  'tests/postgres-report.integration.test.ts',
  'tests/postgres-rule-profile.integration.test.ts',
]

if (!process.env.TEST_DATABASE_URL) {
  console.error('TEST_DATABASE_URL is required for pnpm test:postgres.')
  console.error('Default pnpm test skips PostgreSQL integration tests when TEST_DATABASE_URL is unset.')
  process.exit(1)
}

const missingTestFiles: string[] = []
for (const testFile of postgresTestFiles) {
  try {
    await access(testFile, constants.R_OK)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    if (code === 'ENOENT') missingTestFiles.push(testFile)
    else throw error
  }
}

if (missingTestFiles.length > 0) {
  console.error(`Required PostgreSQL integration test files are missing: ${missingTestFiles.join(', ')}`)
  process.exit(1)
}

console.log(`Running PostgreSQL integration tests: ${postgresTestFiles.join(', ')}`)

const child = spawn('pnpm', ['exec', 'vitest', 'run', ...postgresTestFiles], {
  stdio: 'inherit',
  shell: false,
})

child.on('error', (error) => {
  console.error(`Failed to start PostgreSQL integration tests: ${error.message}`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (typeof code === 'number') {
    process.exit(code)
  }
  console.error(`PostgreSQL integration tests exited from signal ${signal ?? 'unknown'}.`)
  process.exit(1)
})
