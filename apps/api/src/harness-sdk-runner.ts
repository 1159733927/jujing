interface SdkRunResult {
  readonly finalResponse: string
}

interface DeepSeekHarnessInstance {
  run(input: string): Promise<SdkRunResult>
  close(): Promise<void>
}

interface DeepSeekHarnessOptions {
  readonly profile: string
  readonly patches: readonly string[]
  readonly dshHome: string
  readonly processCwd: string
  readonly cwd: string
  readonly provider: string
  readonly model: string
  readonly env: NodeJS.ProcessEnv
  readonly requestTimeoutMs: number
  readonly initializeTimeoutMs: number
  readonly shutdownTimeoutMs: number
  readonly disposeEofGraceMs: number
  readonly disposeGraceMs: number
}

export interface HarnessSdkRunOptions {
  readonly cwd: string
  readonly timeout: number
  readonly maxBuffer: number
  readonly env: NodeJS.ProcessEnv
  readonly profile: string
  readonly patchPath: string
  readonly harnessDirectory: string
  readonly harnessHome: string
  readonly projectDirectory: string
  readonly provider: string
  readonly model: string
}

export type DeepSeekHarnessFactory = (options: DeepSeekHarnessOptions) => DeepSeekHarnessInstance

const sdkClientUrl = new URL('../../../deepseek-harness/packages/sdk/client/lib/index.js', import.meta.url).href

async function defaultHarnessFactory(): Promise<DeepSeekHarnessFactory> {
  const sdk = await import(sdkClientUrl) as { DeepSeekHarness: new (options: DeepSeekHarnessOptions) => DeepSeekHarnessInstance }
  return options => new sdk.DeepSeekHarness(options)
}

function createTimeout(timeout: number, message = 'Harness SDK run timed out'): { promise: Promise<never>; clear(): void } {
  let timer: NodeJS.Timeout | undefined
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message))
    }, timeout)
    timer.unref()
  })
  return {
    promise,
    clear() {
      if (timer) clearTimeout(timer)
    },
  }
}

function harnessCloseTimeoutMs(runTimeoutMs: number): number {
  return Math.min(1_000, Math.max(20, Math.floor(runTimeoutMs / 10)))
}

async function closeHarnessWithDeadline(harness: DeepSeekHarnessInstance, timeoutMs: number): Promise<void> {
  const timeout = createTimeout(timeoutMs, 'Harness SDK close timed out')
  const close = harness.close()
  try {
    await Promise.race([close, timeout.promise])
  } catch {
    // Closing is a cleanup step after the bounded run result. If the Harness
    // SDK dispose path stalls, keep the report worker moving and detach the
    // close promise so it cannot leave an unhandled rejection behind.
    close.catch(() => undefined)
  } finally {
    timeout.clear()
  }
}

export async function runHarnessSdkWithFactory(
  prompt: string,
  options: HarnessSdkRunOptions,
  createHarness: DeepSeekHarnessFactory,
): Promise<{ stdout: string }> {
  const harness = createHarness({
    profile: options.profile,
    patches: [options.patchPath],
    dshHome: options.harnessHome,
    processCwd: options.harnessDirectory,
    cwd: options.cwd,
    provider: options.provider,
    model: options.model,
    env: options.env,
    requestTimeoutMs: options.timeout,
    initializeTimeoutMs: Math.min(30_000, options.timeout),
    shutdownTimeoutMs: 1_000,
    disposeEofGraceMs: 6_000,
    disposeGraceMs: 3_000,
  })
  const timeout = createTimeout(options.timeout)
  const run = harness.run(prompt)
  try {
    const result = await Promise.race([run, timeout.promise])
    const stdout = result.finalResponse
    if (Buffer.byteLength(stdout, 'utf8') > options.maxBuffer) {
      throw new Error('Harness SDK response exceeded max buffer')
    }
    return { stdout }
  } finally {
    timeout.clear()
    run.catch(() => undefined)
    await closeHarnessWithDeadline(harness, harnessCloseTimeoutMs(options.timeout))
  }
}

export async function runHarnessSdk(prompt: string, options: HarnessSdkRunOptions): Promise<{ stdout: string }> {
  return runHarnessSdkWithFactory(prompt, options, await defaultHarnessFactory())
}
