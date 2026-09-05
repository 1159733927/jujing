#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

export class DemoConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DemoConfigError'
  }
}

export function parseDemoPort(envName, rawValue, defaultValue) {
  const value = rawValue == null || rawValue === '' ? defaultValue : rawValue
  if (!/^\d+$/u.test(value)) {
    throw new DemoConfigError(`${envName} must be an integer from 1 to 65535`)
  }
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new DemoConfigError(`${envName} must be an integer from 1 to 65535`)
  }
  return String(port)
}

export function parseDemoHost(envName, rawValue, defaultValue) {
  const value = rawValue == null || rawValue === '' ? defaultValue : rawValue.trim()
  if (!value) {
    throw new DemoConfigError(`${envName} must not be empty`)
  }
  return value
}

export function parseDemoNetworkConfig(baseEnv = process.env) {
  return {
    api: {
      host: parseDemoHost('HOST', baseEnv.HOST, '127.0.0.1'),
      port: parseDemoPort('PORT', baseEnv.PORT, '3001'),
    },
    web: {
      host: parseDemoHost('WEB_HOST', baseEnv.WEB_HOST, '127.0.0.1'),
      port: parseDemoPort('WEB_PORT', baseEnv.WEB_PORT, '4173'),
    },
    admin: {
      host: parseDemoHost('ADMIN_HOST', baseEnv.ADMIN_HOST, '127.0.0.1'),
      port: parseDemoPort('ADMIN_PORT', baseEnv.ADMIN_PORT, '4174'),
    },
  }
}

export function createEphemeralKnowledgeToken(randomBytesFn = randomBytes) {
  return `local-demo-${randomBytesFn(24).toString('base64url')}`
}

export function createEphemeralAdminToken(kind, randomBytesFn = randomBytes) {
  return `local-demo-${kind}-${randomBytesFn(24).toString('base64url')}`
}

export function prepareDemoEnvironment(baseEnv = process.env, randomBytesFn = randomBytes) {
  const configuredKnowledgeToken = baseEnv.KNOWLEDGE_MCP_TOKEN?.trim()
  const configuredAdminToken = baseEnv.ADMIN_API_TOKEN?.trim()
  const configuredAdminUsername = baseEnv.ADMIN_USERNAME?.trim()
  const configuredAdminPassword = baseEnv.ADMIN_PASSWORD?.trim()
  const knowledgeToken = configuredKnowledgeToken || createEphemeralKnowledgeToken(randomBytesFn)
  const adminToken = configuredAdminToken || createEphemeralAdminToken('editor', randomBytesFn)
  const adminUsername = configuredAdminUsername || 'admin'
  const adminPassword = configuredAdminPassword || 'admin123'
  return {
    knowledgeToken,
    adminToken,
    adminUsername,
    adminPassword,
    generatedKnowledgeToken: !configuredKnowledgeToken,
    generatedAdminToken: !configuredAdminToken,
    generatedAdminPassword: false,
    baseEnv: {
      ...baseEnv,
      KNOWLEDGE_MCP_TOKEN: knowledgeToken,
      ADMIN_API_TOKEN: adminToken,
      ADMIN_USERNAME: adminUsername,
      ADMIN_PASSWORD: adminPassword,
      ADMIN_ACTOR_ID: baseEnv.ADMIN_ACTOR_ID?.trim() || 'local-demo-editor',
      SEED_PROFESSIONAL_KNOWLEDGE: baseEnv.SEED_PROFESSIONAL_KNOWLEDGE?.trim() || 'true',
    },
  }
}

export function createDemoServiceSpecs(baseEnv = process.env, randomBytesFn = randomBytes) {
  const { knowledgeToken, adminToken, adminUsername, adminPassword, generatedKnowledgeToken, generatedAdminToken, generatedAdminPassword, baseEnv: preparedEnv } = prepareDemoEnvironment(baseEnv, randomBytesFn)
  const network = parseDemoNetworkConfig(baseEnv)
  const apiProxyTarget = `http://${network.api.host}:${network.api.port}`
  const apiScript = baseEnv.DEMO_API_WATCH === '1' ? 'dev' : 'start'
  return {
    generatedKnowledgeToken,
    generatedAdminToken,
    generatedAdminPassword,
    knowledgeToken,
    adminToken,
    adminUsername,
    adminPassword,
    services: [
      {
        name: 'api',
        command: PNPM_COMMAND,
        args: ['--filter', '@fengshui/api', apiScript],
        env: {
          ...preparedEnv,
          HOST: network.api.host,
          PORT: network.api.port,
        },
      },
      {
        name: 'web',
        command: PNPM_COMMAND,
        args: ['--filter', '@fengshui/web', 'dev', '--host', network.web.host, '--port', network.web.port, '--strictPort'],
        env: { ...baseEnv, API_PROXY_TARGET: apiProxyTarget },
      },
      {
        name: 'admin',
        command: PNPM_COMMAND,
        args: ['--filter', '@fengshui/admin', 'dev', '--host', network.admin.host, '--port', network.admin.port, '--strictPort'],
        env: {
          ...baseEnv,
          API_PROXY_TARGET: apiProxyTarget,
          VITE_DEMO_ADMIN_USERNAME: adminUsername,
          VITE_DEMO_ADMIN_PASSWORD: adminPassword,
        },
      },
    ],
  }
}

export function createDemoSupervisor({
  serviceSpecs,
  spawnFn = spawn,
  stdout = process.stdout,
  stderr = process.stderr,
  exitFn = (code) => process.exit(code),
} = {}) {
  const children = new Map()
  let stopping = false
  let exitCode = 0

  function log(message) {
    stdout.write(`${message}\n`)
  }

  function logError(message) {
    stderr.write(`${message}\n`)
  }

  function stopAll(signal = 'SIGTERM') {
    stopping = true
    for (const [name, child] of children) {
      if (!child.killed && child.exitCode == null && child.signalCode == null) {
        log(`[dev:demo] stopping ${name}`)
        child.kill(signal)
      }
    }
  }

  function requestExitAfterCleanup(code) {
    exitCode = code
    stopAll()
    if (children.size === 0) exitFn(exitCode)
  }

  function start() {
    for (const spec of serviceSpecs) {
      log(`[dev:demo] starting ${spec.name}: ${spec.command} ${spec.args.join(' ')}`)
      const child = spawnFn(spec.command, spec.args, {
        cwd: process.cwd(),
        env: spec.env,
        stdio: 'inherit',
        shell: false,
      })
      children.set(spec.name, child)

      child.once('error', (error) => {
        if (stopping) return
        logError(`[dev:demo] ${spec.name} failed to start: ${error.message}`)
        requestExitAfterCleanup(1)
      })

      child.once('exit', (code, signal) => {
        children.delete(spec.name)
        if (stopping) {
          if (children.size === 0) exitFn(exitCode)
          return
        }
        const failureCode = code === 0 ? 1 : code ?? 1
        logError(`[dev:demo] ${spec.name} exited unexpectedly (${signal || code})`)
        requestExitAfterCleanup(failureCode)
      })
    }
  }

  return { children, start, stopAll }
}

export function attachProcessSignalHandlers(supervisor, runtimeProcess = process) {
  const stop = (signal) => {
    supervisor.stopAll(signal)
  }
  runtimeProcess.once('SIGINT', stop)
  runtimeProcess.once('SIGTERM', stop)
}

export function demoStartupMessages({ generatedKnowledgeToken, generatedAdminToken = false, generatedAdminPassword = false, env = process.env }) {
  const messages = [
    generatedKnowledgeToken
      ? '[dev:demo] generated an in-memory KNOWLEDGE_MCP_TOKEN for this run'
      : '[dev:demo] using configured KNOWLEDGE_MCP_TOKEN',
    generatedAdminToken
      ? '[dev:demo] generated an in-memory ADMIN_API_TOKEN for the local admin console'
      : '[dev:demo] using configured ADMIN_API_TOKEN',
    generatedAdminPassword
      ? '[dev:demo] generated an in-memory admin console login (ADMIN_USERNAME/ADMIN_PASSWORD) for this run'
      : '[dev:demo] using configured or local default admin console login',
  ]
  if (!env.DEEPSEEK_API_KEY?.trim()) {
    messages.push('[dev:demo] DEEPSEEK_API_KEY is not present in this shell; the API may still load it from local env files')
  }
  return messages
}

function main() {
  let services
  let generatedKnowledgeToken
  let generatedAdminToken
  let generatedAdminPassword
  try {
    ;({ services, generatedKnowledgeToken, generatedAdminToken, generatedAdminPassword } = createDemoServiceSpecs())
  } catch (error) {
    if (error instanceof DemoConfigError) {
      process.stderr.write(`[dev:demo] invalid configuration: ${error.message}\n`)
      process.exit(1)
    }
    throw error
  }
  for (const message of demoStartupMessages({ generatedKnowledgeToken, generatedAdminToken, generatedAdminPassword })) {
    process.stdout.write(`${message}\n`)
  }
  const supervisor = createDemoSupervisor({ serviceSpecs: services })
  attachProcessSignalHandlers(supervisor)
  supervisor.start()
}

export function isMainModule(metaUrl = import.meta.url, argvEntry = process.argv[1]) {
  return typeof argvEntry === 'string' && fileURLToPath(metaUrl) === resolve(argvEntry)
}

if (isMainModule()) {
  main()
}
