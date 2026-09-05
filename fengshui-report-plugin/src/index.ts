/**
 * DeepSeek Harness host plugin for the feng shui report product.
 * It owns the typed workflow boundary while computation and model adapters
 * remain independently testable product services.
 */
import type { Context } from '@deepseek-ai/cordis'

// Knowledge evidence is selected and persisted by the API before Harness runs.
// The narration agent may execute only the product report skill so it cannot
// expand or replace that authoritative citation set through an MCP lookup.
const REPORT_TOOL_ALLOWLIST = ['skill'] as const
const REPORT_TOOL_ALLOWSET = new Set<string>(REPORT_TOOL_ALLOWLIST)

interface ReportAgent {
  readonly ctx: Context
}

interface ReportToolRuntime {
  restrict(filter: { readonly allow: readonly string[] }): () => void
  guard(check: (execution: { readonly name: string }) => string | undefined): () => void
  schemas(scope?: ReportAgent): readonly { readonly name: string }[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tools: ReportToolRuntime
  }

  interface Events {
    'agent/created'(payload: { agent: ReportAgent }): void
  }
}

/** A compass direction supplied for a residence or an individual photo. */
export type Direction = 'north' | 'east' | 'south' | 'west' | 'unknown'

/** User supplied evidence attached to a report request. */
export interface ResidencePhoto {
  id: string
  room: 'overview' | 'living-room' | 'bedroom' | 'kitchen' | 'bathroom' | 'entrance' | 'other'
  facing: Direction
  note?: string
}

/** Stable, program-produced natal-chart reference. The chart itself stays outside the LLM. */
export interface BaziProfile {
  profileId: string
  ruleVersion: string
  pillars: readonly [string, string, string, string]
}

/** Structured submission shared by vision, rule, and narrative stages. */
export interface ReportRequest {
  requestId: string
  bazi: BaziProfile
  residence: {
    facing: Direction
    layoutNote?: string
  }
  photos: readonly ResidencePhoto[]
}

/** The first durable state returned by the workflow. */
export interface ReportDraft {
  requestId: string
  status: 'queued'
  evidenceCount: number
  ruleVersion: string
}

/** Service boundary consumed by the API report pipeline. */
export interface FengshuiReportService {
  /** Validate the non-LLM input envelope and queue a report workflow. */
  createDraft(request: ReportRequest): ReportDraft
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fengshuiReport: FengshuiReportService
  }
}

/** Cordis loader identity. */
export const name = 'fengshui-report'
export const inject = ['agents', 'tools']

class FengshuiReportServiceImpl implements FengshuiReportService {
  createDraft(request: ReportRequest): ReportDraft {
    if (request.bazi.ruleVersion.length === 0) throw new Error('bazi ruleVersion is required')
    if (request.photos.length === 0) throw new Error('at least one residence photo is required')
    return {
      requestId: request.requestId,
      status: 'queued',
      evidenceCount: request.photos.length,
      ruleVersion: request.bazi.ruleVersion,
    }
  }
}

/** Mount the product-owned service without changing the Harness agent loop. */
export function apply(ctx: Context): void {
  ctx.provide('fengshuiReport', new FengshuiReportServiceImpl())
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.tools.restrict({ allow: REPORT_TOOL_ALLOWLIST })
    agent.ctx.tools.guard(execution => REPORT_TOOL_ALLOWSET.has(execution.name)
      ? undefined
      : `fengshui report tool policy denied: ${execution.name}`)

    const actual = agent.ctx.tools.schemas(agent).map(schema => schema.name).sort()
    const expected = [...REPORT_TOOL_ALLOWLIST].sort()
    if (actual.length !== expected.length || actual.some((tool, index) => tool !== expected[index])) {
      throw new Error(`fengshui report tool policy mismatch: expected ${expected.join(', ')}, got ${actual.join(', ') || '(none)'}`)
    }
  })
}
