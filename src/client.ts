/** Cloudflare REST API v4 client with injected fetch for deterministic tests. */

import { assertSafeUrl, EndpointSecurityError, normalizeBaseUrl, type LookupImpl } from './url-security.js'

export interface CloudflareClientOptions {
  apiToken?: string
  accountId?: string
  zoneId?: string
  baseUrl?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  /** Test-only DNS lookup override; production uses node:dns/promises. */
  lookupImpl?: LookupImpl
}

export interface CloudflareAuthInfo { ok: boolean; tokenId: string; status: string; expiresOn: string; notBefore: string }
export interface CloudflareZoneInfo { id: string; name: string; status: string; paused: boolean; nameServers: string[]; plan: string; accountId: string; createdOn: string; modifiedOn: string }
export interface CloudflareDnsRecordInfo { id: string; zoneId: string; name: string; type: string; content: string; ttl: number; proxied: boolean; comment: string; createdOn: string; modifiedOn: string }
export interface CloudflareWorkerInfo { id: string; createdOn: string; modifiedOn: string; etag: string; compatibilityDate: string; usageModel: string; handlers: string[] }
export interface CloudflareDeploymentInfo { id: string; number: number; createdOn: string; source: string; annotations: string[]; compatibilityDate: string }
export interface CloudflarePagination { page: number; perPage: number; totalPages: number; totalCount: number; count: number }

export class CloudflareError extends Error {
  constructor(message: string, public readonly status: number, public readonly codes: number[] = []) {
    super(message)
    this.name = 'CloudflareError'
  }
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : value == null ? '' : String(value) }
function numberValue(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : Number(value ?? 0) || 0 }
function boolValue(value: unknown): boolean { return value === true }
function clamp(value: number | undefined, min: number, max: number, fallback: number): number { return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value as number))) : fallback }
function query(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') params.set(key, String(value))
  const rendered = params.toString()
  return rendered ? '?' + rendered : ''
}
function pagination(value: unknown, fallbackPage: number, fallbackPerPage: number): CloudflarePagination {
  const raw = record(value)
  return { page: numberValue(raw.page) || fallbackPage, perPage: numberValue(raw.per_page) || fallbackPerPage, totalPages: numberValue(raw.total_pages), totalCount: numberValue(raw.total_count), count: numberValue(raw.count) }
}
function errorMessage(value: unknown): { message: string; codes: number[] } {
  const errors = array(value).map(item => record(item))
  const messages = errors.map(item => stringValue(item.message)).filter(Boolean)
  const codes = errors.map(item => numberValue(item.code)).filter(Boolean)
  return { message: messages.join('; ') || 'Cloudflare API request failed.', codes }
}
function mapZone(value: unknown): CloudflareZoneInfo {
  const raw = record(value); const plan = record(raw.plan); const account = record(raw.account)
  return { id: stringValue(raw.id), name: stringValue(raw.name), status: stringValue(raw.status), paused: boolValue(raw.paused), nameServers: array(raw.name_servers).map(stringValue), plan: stringValue(plan.name) || stringValue(plan.id), accountId: stringValue(account.id), createdOn: stringValue(raw.created_on), modifiedOn: stringValue(raw.modified_on) }
}
function mapDns(value: unknown): CloudflareDnsRecordInfo {
  const raw = record(value)
  return { id: stringValue(raw.id), zoneId: stringValue(raw.zone_id), name: stringValue(raw.name), type: stringValue(raw.type), content: stringValue(raw.content), ttl: numberValue(raw.ttl), proxied: boolValue(raw.proxied), comment: stringValue(raw.comment), createdOn: stringValue(raw.created_on), modifiedOn: stringValue(raw.modified_on) }
}
function mapWorker(value: unknown): CloudflareWorkerInfo {
  const raw = record(value); const exports = record(raw.exports)
  const directHandlers = array(raw.handlers).map(stringValue).filter(Boolean)
  return { id: stringValue(raw.id), createdOn: stringValue(raw.created_on), modifiedOn: stringValue(raw.modified_on), etag: stringValue(raw.etag), compatibilityDate: stringValue(raw.compatibility_date), usageModel: stringValue(raw.usage_model), handlers: directHandlers.length ? directHandlers : Object.values(exports).map(item => stringValue(record(item).type)).filter(Boolean) }
}
function mapDeployment(value: unknown): CloudflareDeploymentInfo {
  const raw = record(value); const metadata = record(raw.metadata); const runtime = record(raw.script_runtime)
  return { id: stringValue(raw.id), number: numberValue(raw.number), createdOn: stringValue(raw.created_on) || stringValue(metadata.created_on), source: stringValue(metadata.source) || stringValue(raw.source), annotations: array(raw.annotations).map(stringValue), compatibilityDate: stringValue(runtime.compatibility_date) }
}

export class CloudflareClient {
  private readonly apiToken: string
  private readonly accountId: string
  private readonly zoneId: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  private readonly lookupImpl: LookupImpl | undefined

  constructor(private readonly options: CloudflareClientOptions = {}) {
    this.apiToken = options.apiToken ?? ''
    this.accountId = options.accountId ?? ''
    this.zoneId = options.zoneId ?? ''
    try {
      this.baseUrl = normalizeBaseUrl(options.baseUrl, 'https://api.cloudflare.com/client/v4')
    } catch (error) {
      if (error instanceof EndpointSecurityError) throw new CloudflareError(error.message, 400)
      throw error
    }
    this.timeoutMs = options.timeoutMs ?? 15_000
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new Error('timeoutMs must be a positive finite number.')
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.lookupImpl = options.lookupImpl
  }

  hasToken(): boolean { return this.apiToken.length > 0 }
  getAccountId(): string { return this.accountId }
  getZoneId(): string { return this.zoneId }

  async authTest(signal?: AbortSignal): Promise<CloudflareAuthInfo> {
    const envelope = await this.request<{ result?: unknown }>('/user/tokens/verify', {}, signal)
    const raw = record(envelope.result)
    return { ok: true, tokenId: stringValue(raw.id), status: stringValue(raw.status), expiresOn: stringValue(raw.expires_on), notBefore: stringValue(raw.not_before) }
  }

  async listZones(options: { name?: string; status?: string; page?: number; perPage?: number; signal?: AbortSignal } = {}): Promise<{ items: CloudflareZoneInfo[]; pagination: CloudflarePagination }> {
    const page = clamp(options.page, 1, 10_000, 1); const perPage = clamp(options.perPage, 1, 1000, 20)
    const envelope = await this.request<{ result?: unknown[]; result_info?: unknown }>('/zones' + query({ name: options.name, status: options.status, page, per_page: perPage, 'account.id': this.accountId || undefined }), {}, options.signal)
    return { items: array(envelope.result).map(mapZone), pagination: pagination(envelope.result_info, page, perPage) }
  }

  async listDnsRecords(options: { zoneId?: string; name?: string; type?: string; content?: string; proxied?: boolean; page?: number; perPage?: number; signal?: AbortSignal } = {}): Promise<{ items: CloudflareDnsRecordInfo[]; pagination: CloudflarePagination }> {
    const zoneId = options.zoneId || this.zoneId; if (!zoneId) throw new Error('Cloudflare zoneId is required for DNS records.')
    const page = clamp(options.page, 1, 10_000, 1); const perPage = clamp(options.perPage, 1, 1000, 50)
    const envelope = await this.request<{ result?: unknown[]; result_info?: unknown }>('/zones/' + encodeURIComponent(zoneId) + '/dns_records' + query({ name: options.name, type: options.type, content: options.content, proxied: options.proxied, page, per_page: perPage }), {}, options.signal)
    return { items: array(envelope.result).map(mapDns), pagination: pagination(envelope.result_info, page, perPage) }
  }

  async listWorkers(options: { accountId?: string; page?: number; perPage?: number; signal?: AbortSignal } = {}): Promise<{ items: CloudflareWorkerInfo[]; pagination: CloudflarePagination }> {
    const accountId = options.accountId || this.accountId; if (!accountId) throw new Error('Cloudflare accountId is required for Workers.')
    const page = clamp(options.page, 1, 10_000, 1); const perPage = clamp(options.perPage, 1, 1000, 20)
    const envelope = await this.request<{ result?: unknown[]; result_info?: unknown }>('/accounts/' + encodeURIComponent(accountId) + '/workers/scripts' + query({ page, per_page: perPage }), {}, options.signal)
    return { items: array(envelope.result).map(mapWorker), pagination: pagination(envelope.result_info, page, perPage) }
  }

  async listWorkerDeployments(scriptName: string, options: { accountId?: string; page?: number; perPage?: number; signal?: AbortSignal } = {}): Promise<{ items: CloudflareDeploymentInfo[]; pagination: CloudflarePagination }> {
    const accountId = options.accountId || this.accountId; if (!accountId) throw new Error('Cloudflare accountId is required for Worker deployments.')
    if (!scriptName) throw new Error('Cloudflare Worker scriptName is required.')
    const page = clamp(options.page, 1, 10_000, 1); const perPage = clamp(options.perPage, 1, 1000, 20)
    const envelope = await this.request<{ result?: unknown[]; result_info?: unknown }>('/accounts/' + encodeURIComponent(accountId) + '/workers/scripts/' + encodeURIComponent(scriptName) + '/deployments' + query({ page, per_page: perPage }), {}, options.signal)
    return { items: array(envelope.result).map(mapDeployment), pagination: pagination(envelope.result_info, page, perPage) }
  }

  private async request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController(); const onAbort = () => controller.abort(signal?.reason)
    if (signal) { if (signal.aborted) controller.abort(signal.reason); else signal.addEventListener('abort', onAbort, { once: true }) }
    const timer = setTimeout(() => controller.abort(new Error('Cloudflare request timed out after ' + this.timeoutMs + 'ms')), this.timeoutMs)
    try {
      const url = new URL(this.baseUrl + path)
      try {
        await assertSafeUrl(url, this.lookupImpl)
      } catch (error) {
        if (error instanceof EndpointSecurityError) throw new CloudflareError(error.message, 400)
        throw error
      }
      const response = await this.fetchImpl(url.toString(), { ...init, headers: { accept: 'application/json', authorization: 'Bearer ' + this.apiToken, ...init.headers }, signal: controller.signal })
      let body: unknown = undefined; try { body = await response.json() } catch { body = undefined }
      const envelope = record(body)
      const success = envelope.success === true
      if (!response.ok || !success) { const detail = errorMessage(envelope.errors); throw new CloudflareError(detail.message, response.status, detail.codes) }
      return envelope as T
    } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort) }
  }
}
