import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import {
  createDemoServiceSpecs,
  createEphemeralAdminToken,
  createDemoSupervisor,
  createEphemeralKnowledgeToken,
  isMainModule,
  demoStartupMessages,
  parseDemoNetworkConfig,
  prepareDemoEnvironment,
} from './dev-demo.mjs'

class FakeChildProcess extends EventEmitter {
  killed = false
  exitCode = null
  signalCode = null

  kill(signal = 'SIGTERM') {
    this.killed = true
    this.signalCode = signal
    this.emit('exit', null, signal)
    return true
  }
}

function fixedRandomBytes() {
  return Buffer.from('0123456789abcdef01234567')
}

describe('dev-demo launcher', () => {
  it('recognizes the CLI entrypoint when Node supplies a filesystem path', () => {
    assert.equal(isMainModule(new URL('./dev-demo.mjs', import.meta.url).href, 'scripts/dev-demo.mjs'), true)
    assert.equal(isMainModule(new URL('./dev-demo.mjs', import.meta.url).href, 'scripts/not-dev-demo.mjs'), false)
  })

  it('generates an ephemeral knowledge token without using a fixed value', () => {
    const token = createEphemeralKnowledgeToken(fixedRandomBytes)

    assert.match(token, /^local-demo-/)
    assert.equal(token.includes('replace-with'), false)
  })

  it('generates distinct ephemeral admin token and console password for the local demo', () => {
    const editor = createEphemeralAdminToken('editor', fixedRandomBytes)
    const adminPassword = createEphemeralAdminToken('admin-password', fixedRandomBytes)

    assert.match(editor, /^local-demo-editor-/)
    assert.match(adminPassword, /^local-demo-admin-password-/)
    assert.notEqual(editor, adminPassword)
  })

  it('injects stable local demo credentials into the API and admin console only where needed', () => {
    const { services, generatedKnowledgeToken, knowledgeToken } = createDemoServiceSpecs({
      PATH: '/bin',
      DEEPSEEK_API_KEY: 'user-configured-key',
    }, fixedRandomBytes)

    const api = services.find((service) => service.name === 'api')
    const web = services.find((service) => service.name === 'web')
    const admin = services.find((service) => service.name === 'admin')

    assert.equal(generatedKnowledgeToken, true)
    assert.equal(api.env.KNOWLEDGE_MCP_TOKEN, knowledgeToken)
    assert.match(api.env.ADMIN_API_TOKEN, /^local-demo-editor-/)
    assert.equal(api.env.ADMIN_USERNAME, 'admin')
    assert.equal(api.env.ADMIN_PASSWORD, 'admin123')
    assert.equal(api.env.ADMIN_ACTOR_ID, 'local-demo-editor')
    assert.equal(api.env.DEEPSEEK_API_KEY, 'user-configured-key')
    assert.equal(web.env.KNOWLEDGE_MCP_TOKEN, undefined)
    assert.equal(web.env.VITE_DEMO_ADMIN_USERNAME, undefined)
    assert.equal(admin.env.KNOWLEDGE_MCP_TOKEN, undefined)
    assert.equal(admin.env.VITE_DEMO_ADMIN_USERNAME, api.env.ADMIN_USERNAME)
    assert.equal(admin.env.VITE_DEMO_ADMIN_PASSWORD, api.env.ADMIN_PASSWORD)
  })

  it('preserves existing knowledge, admin and DeepSeek credentials', () => {
    const prepared = prepareDemoEnvironment({
      KNOWLEDGE_MCP_TOKEN: 'configured-reader-token',
      ADMIN_API_TOKEN: 'configured-admin-token',
      ADMIN_USERNAME: 'configured-admin-user',
      ADMIN_PASSWORD: 'configured-admin-password',
      ADMIN_ACTOR_ID: 'configured-admin',
      DEEPSEEK_API_KEY: 'configured-deepseek-key',
    }, fixedRandomBytes)

    assert.equal(prepared.generatedKnowledgeToken, false)
    assert.equal(prepared.generatedAdminToken, false)
    assert.equal(prepared.generatedAdminPassword, false)
    assert.equal(prepared.knowledgeToken, 'configured-reader-token')
    assert.equal(prepared.adminToken, 'configured-admin-token')
    assert.equal(prepared.adminUsername, 'configured-admin-user')
    assert.equal(prepared.adminPassword, 'configured-admin-password')
    assert.equal(prepared.baseEnv.KNOWLEDGE_MCP_TOKEN, 'configured-reader-token')
    assert.equal(prepared.baseEnv.ADMIN_API_TOKEN, 'configured-admin-token')
    assert.equal(prepared.baseEnv.ADMIN_USERNAME, 'configured-admin-user')
    assert.equal(prepared.baseEnv.ADMIN_PASSWORD, 'configured-admin-password')
    assert.equal(prepared.baseEnv.ADMIN_ACTOR_ID, 'configured-admin')
    assert.equal(prepared.baseEnv.DEEPSEEK_API_KEY, 'configured-deepseek-key')
  })

  it('builds the expected stable service commands', () => {
    const { services } = createDemoServiceSpecs({ PATH: '/bin' }, fixedRandomBytes)
    const api = services.find((service) => service.name === 'api')

    assert.deepEqual(services.map((service) => service.name), ['api', 'web', 'admin'])
    assert.deepEqual(services[0].args, ['--filter', '@fengshui/api', 'start'])
    assert.equal(api.env.HOST, '127.0.0.1')
    assert.equal(api.env.PORT, '3001')
    assert.deepEqual(services[1].args, ['--filter', '@fengshui/web', 'dev', '--host', '127.0.0.1', '--port', '4173', '--strictPort'])
    assert.deepEqual(services[2].args, ['--filter', '@fengshui/admin', 'dev', '--host', '127.0.0.1', '--port', '4174', '--strictPort'])
    assert.equal(services[1].env.API_PROXY_TARGET, 'http://127.0.0.1:3001')
    assert.equal(services[2].env.API_PROXY_TARGET, 'http://127.0.0.1:3001')
  })

  it('can opt into API watch mode for source editing sessions', () => {
    const { services } = createDemoServiceSpecs({ PATH: '/bin', DEMO_API_WATCH: '1' }, fixedRandomBytes)

    assert.deepEqual(services[0].args, ['--filter', '@fengshui/api', 'dev'])
  })

  it('points both browser proxies at the configured API address', () => {
    const { services } = createDemoServiceSpecs({
      PATH: '/bin',
      HOST: '127.0.0.2',
      PORT: '3301',
    }, fixedRandomBytes)

    assert.equal(services[1].env.API_PROXY_TARGET, 'http://127.0.0.2:3301')
    assert.equal(services[2].env.API_PROXY_TARGET, 'http://127.0.0.2:3301')
  })

  it('uses custom host and port values for each service', () => {
    const { services } = createDemoServiceSpecs({
      PATH: '/bin',
      HOST: '0.0.0.0',
      PORT: '3101',
      WEB_HOST: 'localhost',
      WEB_PORT: '5173',
      ADMIN_HOST: '127.0.0.2',
      ADMIN_PORT: '5174',
    }, fixedRandomBytes)

    const api = services.find((service) => service.name === 'api')

    assert.equal(api.env.HOST, '0.0.0.0')
    assert.equal(api.env.PORT, '3101')
    assert.deepEqual(services[1].args, ['--filter', '@fengshui/web', 'dev', '--host', 'localhost', '--port', '5173', '--strictPort'])
    assert.deepEqual(services[2].args, ['--filter', '@fengshui/admin', 'dev', '--host', '127.0.0.2', '--port', '5174', '--strictPort'])
  })

  it('rejects invalid ports before spawning and does not include the provided value in the error', () => {
    assert.throws(
      () => parseDemoNetworkConfig({ PORT: 'secret-port-value' }),
      (error) => {
        assert.equal(error.name, 'DemoConfigError')
        assert.match(error.message, /PORT must be an integer from 1 to 65535/)
        assert.equal(error.message.includes('secret-port-value'), false)
        return true
      },
    )
    assert.throws(() => parseDemoNetworkConfig({ WEB_PORT: '0' }), /WEB_PORT must be an integer from 1 to 65535/)
    assert.throws(() => parseDemoNetworkConfig({ ADMIN_PORT: '65536' }), /ADMIN_PORT must be an integer from 1 to 65535/)
  })

  it('fails closed while building service specs for invalid network config', () => {
    assert.throws(
      () => createDemoServiceSpecs({
        PATH: '/bin',
        DEEPSEEK_API_KEY: 'must-not-appear',
        WEB_PORT: 'not-a-port',
      }, fixedRandomBytes),
      (error) => {
        assert.equal(error.name, 'DemoConfigError')
        assert.match(error.message, /WEB_PORT must be an integer from 1 to 65535/)
        assert.equal(error.message.includes('must-not-appear'), false)
        assert.equal(error.message.includes('not-a-port'), false)
        return true
      },
    )
  })

  it('rejects empty host values before spawning', () => {
    assert.throws(() => parseDemoNetworkConfig({ HOST: '   ' }), /HOST must not be empty/)
    assert.throws(() => parseDemoNetworkConfig({ WEB_HOST: '   ' }), /WEB_HOST must not be empty/)
    assert.throws(() => parseDemoNetworkConfig({ ADMIN_HOST: '   ' }), /ADMIN_HOST must not be empty/)
  })

  it('does not print generated tokens in startup logs', () => {
    const spawned = []
    const output = []
    const supervisor = createDemoSupervisor({
      serviceSpecs: createDemoServiceSpecs({ PATH: '/bin' }, fixedRandomBytes).services,
      spawnFn(command, args, options) {
        const child = new FakeChildProcess()
        spawned.push({ command, args, options, child })
        return child
      },
      stdout: { write: (message) => output.push(message) },
      stderr: { write: (message) => output.push(message) },
      exitFn: () => {},
    })

    supervisor.start()

    const token = spawned[0].options.env.KNOWLEDGE_MCP_TOKEN
    const adminToken = spawned[0].options.env.ADMIN_API_TOKEN
    const adminPassword = spawned[0].options.env.ADMIN_PASSWORD
    assert.equal(output.join('').includes(token), false)
    assert.equal(output.join('').includes(adminToken), false)
    assert.equal(output.join('').includes(adminPassword), false)
  })

  it('cleans up sibling processes and exits non-zero when a child exits unexpectedly', () => {
    const spawned = []
    const exits = []
    const supervisor = createDemoSupervisor({
      serviceSpecs: createDemoServiceSpecs({ PATH: '/bin' }, fixedRandomBytes).services,
      spawnFn(command, args, options) {
        const child = new FakeChildProcess()
        spawned.push({ command, args, options, child })
        return child
      },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      exitFn: (code) => exits.push(code),
    })

    supervisor.start()
    spawned[0].child.emit('exit', 7, null)

    assert.equal(spawned[1].child.killed, true)
    assert.equal(spawned[2].child.killed, true)
    assert.ok(exits.every((code) => code !== 0))
    assert.ok(exits.includes(7))
  })

  it('does not claim report readiness is necessarily false when DeepSeek is absent from the shell', () => {
    const messages = demoStartupMessages({
      generatedKnowledgeToken: true,
      generatedAdminToken: true,
      generatedAdminPassword: true,
      env: {},
    }).join('\n')

    assert.equal(messages.includes('readiness will remain false'), false)
    assert.match(messages, /API may still load it from local env files/)
  })
})
