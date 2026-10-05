# dsh-tool-cloudflare

[English](README.md) | [中文](README.zh.md)

A read-only Cloudflare REST plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). Agents can verify an API token, inspect zones and DNS records, list Worker scripts, and review Worker deployment history.

The plugin uses scoped Cloudflare API Tokens with the REST API. It does not upload code, change DNS, deploy Workers, or expose raw API responses to the model.

## Install

~~~sh
npm install @libai168/dsh-tool-cloudflare
~~~

Requires @deepseek-ai/cordis (^4.0.1) and @deepseek-ai/dsh-tools (^0.1.0-rc.6) as peer dependencies.

Create a scoped API Token in the Cloudflare dashboard. Grant only the read permissions needed by the tools, such as Zone Read, DNS Read, and Workers Scripts Read. Do not use a global API key or commit a token.

## Configuration

~~~yaml
- name: '@libai168/dsh-tool-cloudflare'
  config:
    apiToken: 'replace-with-a-scoped-cloudflare-api-token'
    accountId: 'optional-account-id-for-workers'
    zoneId: 'optional-default-zone-id-for-dns'
    # baseUrl: 'https://api.cloudflare.com/client/v4'
    # timeoutMs: 15000
~~~

Account and zone identifiers may also be supplied per tool call. Full example: [examples/cordis.yml](examples/cordis.yml).

## Tools

| Tool | Description | Access |
|---|---|---|
| cf_auth_test | Verify the API token and return token status fields | read |
| cf_list_zones | List zones with name/status filters and pagination | read |
| cf_list_dns_records | List DNS records for a zone | read |
| cf_list_workers | List Worker scripts in an account | read |
| cf_list_worker_deployments | List deployment history for one Worker script | read |

The plugin intentionally has no DNS write, Worker upload, deployment, Pages, R2, or D1 mutation tools in this release.

## Behavior and security contract

- Requests use Authorization: Bearer and never return the token or raw authorization headers.
- Cloudflare success envelopes are checked; errors and non-2xx responses become structured client errors with the API error message and code.
- Results use field allowlists. DNS content, Worker metadata, and deployment annotations are returned only in the fields needed for inspection.
- List limits are bounded and pagination metadata is returned so a caller can continue deliberately.
- Requests honor the configured timeout and the tool execution AbortSignal.
- The API token should be scoped to read-only permissions and, where possible, restricted by account, zone, IP, and expiration policy.
- The `baseUrl` override must be an absolute `http(s)` root URL. Only publicly reachable hosts are allowed: localhost, loopback, private, link-local, CGNAT, multicast, reserved/documentation/benchmark ranges, and every IANA special-purpose block are rejected, and a hostname whose DNS results contain any such address fails closed before the request is sent.

## Model Experience

The model can use cf_auth_test first, then cf_list_zones or cf_list_workers to discover identifiers. It should pass the returned zoneId, accountId, and Worker script id into later calls. Deployment history is bounded and does not include uploaded script source.

## Known Limitations and Deferred Work

- The MVP does not deploy or mutate DNS, Workers, Pages, R2, or D1 resources.
- Cloudflare API permissions are configured outside this plugin; an insufficient token returns the API error and must be fixed in Cloudflare settings.
- Worker script listings and deployment fields vary by account features; unknown fields are intentionally omitted.
- There is no automatic rate-limit retry. Callers should wait for the server-provided retry hint before trying again.

## Development

~~~sh
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
~~~

See [DEVELOPMENT.md](DEVELOPMENT.md) for endpoint mapping and release checks.

## License

[MIT](LICENSE)
