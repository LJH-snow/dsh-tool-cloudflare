import { describe, expect, it, vi } from 'vitest'
import { CloudflareClient, CloudflareError } from '../src/client.js'

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function parts(call: unknown[]): [string, RequestInit] { return [String(call[0]), (call[1] ?? {}) as RequestInit] }

/** Deterministic DNS so tests never depend on real resolution. */
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 as const }]

function makeClient(options: ConstructorParameters<typeof CloudflareClient>[0] = {}): CloudflareClient {
  return new CloudflareClient({ lookupImpl: publicLookup, ...options })
}

const pageInfo = { page: 1, per_page: 20, total_pages: 2, total_count: 21, count: 1 }

describe('CloudflareClient', () => {
  it('verifies token with a Bearer header and maps safe fields', async () => {
    const fetchImpl = vi.fn(async () => response(200, { success: true, errors: [], messages: [], result: { id: 'tok-1', status: 'active', expires_on: '2027-01-01T00:00:00Z', not_before: '2026-01-01T00:00:00Z', secret: 'do-not-return' } }))
    const client = makeClient({ apiToken: 'secret', fetchImpl })
    await expect(client.authTest()).resolves.toEqual({ ok: true, tokenId: 'tok-1', status: 'active', expiresOn: '2027-01-01T00:00:00Z', notBefore: '2026-01-01T00:00:00Z' })
    const [, init] = parts(fetchImpl.mock.calls[0])
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret')
  })

  it('maps zones and preserves bounded pagination', async () => {
    const fetchImpl = vi.fn(async () => response(200, { success: true, errors: [], messages: [], result: [{ id: 'z-1', name: 'example.com', status: 'active', paused: false, name_servers: ['ns1'], plan: { name: 'Free' }, account: { id: 'a-1' } }], result_info: pageInfo }))
    const client = makeClient({ apiToken: 't', accountId: 'a-1', fetchImpl })
    const result = await client.listZones({ name: 'example.com', page: 2, perPage: 2000 })
    expect(result.items[0]).toMatchObject({ id: 'z-1', name: 'example.com', plan: 'Free', accountId: 'a-1' })
    expect(result.pagination).toMatchObject({ page: 1, totalPages: 2, totalCount: 21 })
    const [url] = parts(fetchImpl.mock.calls[0]); expect(url).toContain('per_page=1000'); expect(url).toContain('account.id=a-1')
  })

  it('maps DNS records, Workers, and deployment history', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, { success: true, result: [{ id: 'r-1', zone_id: 'z-1', name: 'www.example.com', type: 'A', content: '192.0.2.1', ttl: 60, proxied: true }] , result_info: pageInfo }))
      .mockResolvedValueOnce(response(200, { success: true, result: [{ id: 'worker', modified_on: '2026-01-02', exports: { default: { type: 'worker' } } }], result_info: pageInfo }))
      .mockResolvedValueOnce(response(200, { success: true, result: [{ id: 'dep-1', number: 3, metadata: { source: 'api', created_on: '2026-01-02' } }], result_info: pageInfo }))
    const client = makeClient({ apiToken: 't', accountId: 'a-1', zoneId: 'z-1', fetchImpl })
    await expect(client.listDnsRecords()).resolves.toMatchObject({ items: [{ id: 'r-1', proxied: true }] })
    await expect(client.listWorkers()).resolves.toMatchObject({ items: [{ id: 'worker', handlers: ['worker'] }] })
    await expect(client.listWorkerDeployments('worker')).resolves.toMatchObject({ items: [{ id: 'dep-1', number: 3, source: 'api' }] })
  })

  it('surfaces Cloudflare envelope errors and retry headers', async () => {
    const fetchImpl = vi.fn(async () => response(429, { success: false, errors: [{ code: 1001, message: 'rate limited' }] }, { 'retry-after': '2' }))
    const client = makeClient({ apiToken: 't', fetchImpl })
    await expect(client.listZones()).rejects.toThrow(/rate limited/)
  })

  it('requires account and zone ids for scoped resources', async () => {
    const client = makeClient({ apiToken: 't', fetchImpl: vi.fn() })
    await expect(client.listDnsRecords()).rejects.toThrow('zoneId')
    await expect(client.listWorkers()).rejects.toThrow('accountId')
    await expect(client.listWorkerDeployments('worker')).rejects.toThrow('accountId')
  })

  it('rejects invalid base URLs without exposing their contents', () => {
    for (const baseUrl of [
      'api.cloudflare.com/client/v4',
      'ftp://api.cloudflare.com/client/v4',
      'https://user:secret@api.cloudflare.com',
      'https://api.cloudflare.com?token=secret',
      'https://api.cloudflare.com#fragment',
    ]) {
      let error: unknown
      try { makeClient({ apiToken: 'secret', baseUrl }) } catch (thrown) { error = thrown }
      expect(error).toBeInstanceOf(CloudflareError)
      expect(String(error)).not.toContain('secret')
    }
  })

  it('rejects literal local, private, and reserved addresses before fetch', async () => {
    for (const baseUrl of [
      'http://localhost',
      'http://service.localhost',
      'http://service.local',
      'http://127.0.0.1',
      'http://169.254.169.254',
      'http://10.0.0.1',
      'http://192.168.1.1',
      'http://192.0.2.1',
      'http://198.18.0.1',
      'http://224.0.0.1',
      'http://192.175.48.1',
      'http://[::1]',
      'http://[fc00::1]',
      'http://[fe80::1]',
      'http://[fec0::1]',
      'http://[2001:db8::1]',
      'http://[2001:3::1]',
      'http://[2001:4:112::1]',
      'http://[2001:30::1]',
      'http://[5f00::1]',
      'http://[100:0:0:1::1]',
      'http://[2620:4f:8000::1]',
      'http://[64:ff9b::7f00:1]',
      'http://[ff02::1]',
    ]) {
      const fetchImpl = vi.fn()
      await expect(makeClient({ apiToken: 't', baseUrl, fetchImpl }).authTest()).rejects.toMatchObject({ name: 'CloudflareError' })
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('fails closed on blocked, failed, empty, or inconsistent DNS results', async () => {
    for (const lookupImpl of [
      async () => [{ address: '192.168.1.10', family: 4 as const }],
      async () => [{ address: '93.184.216.34', family: 4 as const }, { address: '169.254.169.254', family: 4 as const }],
      async () => { throw new Error('dns failure') },
      async () => [],
      async () => [{ address: '2001:db8::1', family: 4 as const }],
    ]) {
      const fetchImpl = vi.fn()
      await expect(makeClient({ apiToken: 't', baseUrl: 'https://cf.example.test', fetchImpl, lookupImpl }).authTest()).rejects.toMatchObject({ name: 'CloudflareError' })
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('keeps a public endpoint that resolves to a public address usable', async () => {
    const fetchImpl = vi.fn(async () => response(200, { success: true, errors: [], result: { id: 'tok-1', status: 'active' } }))
    await expect(makeClient({ apiToken: 't', baseUrl: 'https://cf.example.test/', fetchImpl }).authTest()).resolves.toMatchObject({ ok: true, tokenId: 'tok-1' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
