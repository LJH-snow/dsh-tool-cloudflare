import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CloudflareClient, CloudflareError, type CloudflareClientOptions } from './client.js'

export { CloudflareClient, CloudflareError }
export type { CloudflareAuthInfo, CloudflareClientOptions, CloudflareDeploymentInfo, CloudflareDnsRecordInfo, CloudflarePagination, CloudflareWorkerInfo, CloudflareZoneInfo } from './client.js'

export const name = 'dsh-tool-cloudflare'
export const inject = ['tools']
export interface CloudflarePluginConfig extends CloudflareClientOptions {}

function text(value: string) { return [{ type: 'text' as const, text: value }] }
function unavailable(reason: string) { return { found: false, reason } }
function pageText(page: { page?: number; perPage?: number; totalPages?: number; totalCount?: number } | undefined) { return 'page=' + (page?.page ?? 0) + ' perPage=' + (page?.perPage ?? 0) + ' total=' + (page?.totalCount ?? 0) + ' pages=' + (page?.totalPages ?? 0) }
function failure(error: unknown): { found: false; reason: string } {
  if (error instanceof CloudflareError && (error.status === 429 || error.status >= 500)) throw error
  return { found: false, reason: error instanceof Error ? error.message : 'Cloudflare request failed.' }
}
function writeKind(title: string): ToolCallView { return { card: 'generic', title, kind: 'read' } }

/** Build Cloudflare read-only tools for a client. */
export function createTools(client: CloudflareClient) {
  return [
    defineTool({
      name: 'cf_auth_test',
      description: 'Verify a Cloudflare API token and return safe token status fields without exposing the token.',
      parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, reason: { type: 'string' }, tokenId: { type: 'string' }, status: { type: 'string' }, expiresOn: { type: 'string' }, notBefore: { type: 'string' } } } as const, render: (_args, value) => value.ok ? text('Cloudflare token ' + value.status + ' (' + value.tokenId + ')') : text('Cloudflare auth failed: ' + value.reason) },
      presentCall(): ToolCallView { return writeKind('Verify Cloudflare API token') },
      async execute(_args, exec) { if (!client.hasToken()) return { ok: false, reason: 'Cloudflare API token is not configured.' }; try { return await client.authTest(exec.signal) } catch (error) { if (error instanceof CloudflareError && (error.status === 401 || error.status === 403)) return { ok: false, reason: error.message }; throw error } },
    }),
    defineTool({
      name: 'cf_list_zones',
      description: 'List Cloudflare zones available to the API token with bounded pagination.',
      parameters: { name: { type: 'string', description: 'Optional zone name filter.' }, status: { type: 'string', description: 'Optional zone status filter.' }, page: { type: 'integer', description: 'Page number, minimum 1.' }, perPage: { type: 'integer', description: 'Results per page, 1-1000.' } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { found: { type: 'boolean' }, reason: { type: 'string' }, items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' }, status: { type: 'string' }, paused: { type: 'boolean' }, nameServers: { type: 'array', items: { type: 'string' } }, plan: { type: 'string' }, accountId: { type: 'string' }, createdOn: { type: 'string' }, modifiedOn: { type: 'string' } } } }, pagination: { type: 'object', additionalProperties: false, properties: { page: { type: 'integer' }, perPage: { type: 'integer' }, totalPages: { type: 'integer' }, totalCount: { type: 'integer' }, count: { type: 'integer' } } } } } as const, render: (_args, value) => value.found ? text((value.items ?? []).map(item => item.name + ' (' + item.id + ') ' + item.status).join('\n') + '\n' + pageText(value.pagination)) : text(value.reason ?? 'Cloudflare is not configured.') },
      presentCall(args): ToolCallView { return { card: 'generic', title: 'Cloudflare zones' + (args.name ? ': ' + args.name : ''), kind: 'search' } },
      async execute(args, exec) { if (!client.hasToken()) return unavailable('Cloudflare API token is not configured.'); try { const result = await client.listZones({ name: args.name, status: args.status, page: args.page, perPage: args.perPage, signal: exec.signal }); return { found: true, ...result } } catch (error) { return failure(error) } },
    }),
    defineTool({
      name: 'cf_list_dns_records',
      description: 'List Cloudflare DNS records for a configured or explicitly supplied zone.',
      parameters: { zoneId: { type: 'string', description: 'Cloudflare zone id; defaults to plugin config.' }, name: { type: 'string', description: 'Optional DNS name filter.' }, type: { type: 'string', description: 'Optional record type filter such as A, AAAA, CNAME, or TXT.' }, content: { type: 'string', description: 'Optional record content filter.' }, proxied: { type: 'boolean', description: 'Optional proxy status filter.' }, page: { type: 'integer', description: 'Page number, minimum 1.' }, perPage: { type: 'integer', description: 'Results per page, 1-1000.' } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { found: { type: 'boolean' }, reason: { type: 'string' }, items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, zoneId: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, content: { type: 'string' }, ttl: { type: 'integer' }, proxied: { type: 'boolean' }, comment: { type: 'string' }, createdOn: { type: 'string' }, modifiedOn: { type: 'string' } } } }, pagination: { type: 'object', additionalProperties: false, properties: { page: { type: 'integer' }, perPage: { type: 'integer' }, totalPages: { type: 'integer' }, totalCount: { type: 'integer' }, count: { type: 'integer' } } } } } as const, render: (_args, value) => value.found ? text((value.items ?? []).map(item => item.name + ' ' + item.type + ' ' + item.content + ' ttl=' + item.ttl + (item.proxied ? ' proxied' : '')).join('\n') + '\n' + pageText(value.pagination)) : text(value.reason ?? 'Cloudflare DNS is not configured.') },
      presentCall(args): ToolCallView { return { card: 'generic', title: 'Cloudflare DNS records ' + (args.zoneId ?? 'configured zone'), kind: 'search' } },
      async execute(args, exec) { if (!client.hasToken()) return unavailable('Cloudflare API token is not configured.'); try { const result = await client.listDnsRecords({ zoneId: args.zoneId, name: args.name, type: args.type, content: args.content, proxied: args.proxied, page: args.page, perPage: args.perPage, signal: exec.signal }); return { found: true, ...result } } catch (error) { return failure(error) } },
    }),
    defineTool({
      name: 'cf_list_workers',
      description: 'List Cloudflare Worker scripts in a configured or explicitly supplied account.',
      parameters: { accountId: { type: 'string', description: 'Cloudflare account id; defaults to plugin config.' }, page: { type: 'integer', description: 'Page number, minimum 1.' }, perPage: { type: 'integer', description: 'Results per page, 1-1000.' } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { found: { type: 'boolean' }, reason: { type: 'string' }, items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, createdOn: { type: 'string' }, modifiedOn: { type: 'string' }, etag: { type: 'string' }, compatibilityDate: { type: 'string' }, usageModel: { type: 'string' }, handlers: { type: 'array', items: { type: 'string' } } } } }, pagination: { type: 'object', additionalProperties: false, properties: { page: { type: 'integer' }, perPage: { type: 'integer' }, totalPages: { type: 'integer' }, totalCount: { type: 'integer' }, count: { type: 'integer' } } } } } as const, render: (_args, value) => value.found ? text((value.items ?? []).map(item => item.id + ' modified=' + item.modifiedOn + ' handlers=' + (item.handlers ?? []).join(',')).join('\n') + '\n' + pageText(value.pagination)) : text(value.reason ?? 'Cloudflare Workers is not configured.') },
      presentCall(args): ToolCallView { return { card: 'generic', title: 'Cloudflare Workers ' + (args.accountId ?? 'configured account'), kind: 'search' } },
      async execute(args, exec) { if (!client.hasToken()) return unavailable('Cloudflare API token is not configured.'); try { const result = await client.listWorkers({ accountId: args.accountId, page: args.page, perPage: args.perPage, signal: exec.signal }); return { found: true, ...result } } catch (error) { return failure(error) } },
    }),
    defineTool({
      name: 'cf_list_worker_deployments',
      description: 'List bounded deployment history for one Cloudflare Worker script.',
      parameters: { scriptName: { type: 'string', required: true, description: 'Worker script name.' }, accountId: { type: 'string', description: 'Cloudflare account id; defaults to plugin config.' }, page: { type: 'integer', description: 'Page number, minimum 1.' }, perPage: { type: 'integer', description: 'Results per page, 1-1000.' } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { found: { type: 'boolean' }, reason: { type: 'string' }, items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, number: { type: 'integer' }, createdOn: { type: 'string' }, source: { type: 'string' }, annotations: { type: 'array', items: { type: 'string' } }, compatibilityDate: { type: 'string' } } } }, pagination: { type: 'object', additionalProperties: false, properties: { page: { type: 'integer' }, perPage: { type: 'integer' }, totalPages: { type: 'integer' }, totalCount: { type: 'integer' }, count: { type: 'integer' } } } } } as const, render: (_args, value) => value.found ? text((value.items ?? []).map(item => item.id + ' #' + item.number + ' ' + item.createdOn + ' source=' + item.source).join('\n') + '\n' + pageText(value.pagination)) : text(value.reason ?? 'Cloudflare Worker deployments are not configured.') },
      presentCall(args): ToolCallView { return { card: 'generic', title: 'Cloudflare deployments ' + args.scriptName, kind: 'search' } },
      async execute(args, exec) { if (!client.hasToken()) return unavailable('Cloudflare API token is not configured.'); try { const result = await client.listWorkerDeployments(args.scriptName, { accountId: args.accountId, page: args.page, perPage: args.perPage, signal: exec.signal }); return { found: true, ...result } } catch (error) { return failure(error) } },
    }),
  ]
}

export function apply(ctx: Context, config: CloudflarePluginConfig = {}): void {
  const client = new CloudflareClient(config)
  for (const tool of createTools(client)) ctx.tools.register(tool)
}
