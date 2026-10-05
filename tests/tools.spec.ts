import { describe, expect, it, vi } from 'vitest'
import { CloudflareClient } from '../src/client.js'
import { createTools } from '../src/index.js'

function exec() { return { signal: new AbortController().signal } as never }
function toolMap(client = new CloudflareClient({ fetchImpl: globalThis.fetch })) { return Object.fromEntries(createTools(client).map(tool => [tool.name, tool])) as Record<string, any> }

describe('Cloudflare tools', () => {
  it('registers the five read-only tools', () => {
    expect(Object.keys(toolMap()).sort()).toEqual(['cf_auth_test', 'cf_list_dns_records', 'cf_list_worker_deployments', 'cf_list_workers', 'cf_list_zones'])
  })

  it('returns structured missing-token results without fetching', async () => {
    const map = toolMap()
    expect(await map.cf_auth_test.execute({}, exec())).toMatchObject({ ok: false, reason: expect.stringContaining('token') })
    expect(await map.cf_list_zones.execute({}, exec())).toMatchObject({ found: false, reason: expect.stringContaining('token') })
    expect(await map.cf_list_dns_records.execute({}, exec())).toMatchObject({ found: false, reason: expect.stringContaining('token') })
    expect(await map.cf_list_workers.execute({}, exec())).toMatchObject({ found: false, reason: expect.stringContaining('token') })
    expect(await map.cf_list_worker_deployments.execute({ scriptName: 'worker' }, exec())).toMatchObject({ found: false, reason: expect.stringContaining('token') })
  })

  it('maps zone reads and uses search presentation', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, errors: [], result: [], result_info: { page: 1, per_page: 20, total_pages: 0, total_count: 0, count: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const map = toolMap(new CloudflareClient({ apiToken: 't', fetchImpl }))
    expect(await map.cf_list_zones.execute({ name: 'example.com' }, exec())).toMatchObject({ found: true, items: [] })
    expect(map.cf_list_zones.presentCall!({ name: 'example.com' })).toMatchObject({ card: 'generic', kind: 'search' })
  })
})
