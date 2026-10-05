# dsh-tool-cloudflare

[English](README.md) | [中文](README.zh.md)

这是一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的只读 Cloudflare REST 插件。Agent 可以验证 API Token，查看 Zone 和 DNS 记录，列出 Worker 脚本并检查 Worker 部署历史。

插件使用有范围的 Cloudflare API Token，不上传代码、不修改 DNS、不部署 Worker，也不会把原始 API 响应直接交给模型。

## 安装

~~~sh
npm install @libai168/dsh-tool-cloudflare
~~~

插件需要 dsh 运行时提供 @deepseek-ai/cordis (^4.0.1) 和 @deepseek-ai/dsh-tools (^0.1.0-rc.6)。

请在 Cloudflare 控制台创建有范围的 API Token，只授予工具需要的 Zone Read、DNS Read、Workers Scripts Read 等权限。不要使用 Global API Key，也不要提交 Token。

## 配置

~~~yaml
- name: '@libai168/dsh-tool-cloudflare'
  config:
    apiToken: 'replace-with-a-scoped-cloudflare-api-token'
    accountId: 'optional-account-id-for-workers'
    zoneId: 'optional-default-zone-id-for-dns'
    # baseUrl: 'https://api.cloudflare.com/client/v4'
    # timeoutMs: 15000
~~~

Account 和 Zone ID 也可以在单次工具调用中传入。完整示例见 [examples/cordis.yml](examples/cordis.yml)。

## 工具

| 工具 | 作用 | 权限 |
|---|---|---|
| cf_auth_test | 验证 API Token 并返回 Token 状态字段 | 只读 |
| cf_list_zones | 按名称/状态和分页列出 Zone | 只读 |
| cf_list_dns_records | 列出 Zone 的 DNS 记录 | 只读 |
| cf_list_workers | 列出 Account 下的 Worker 脚本 | 只读 |
| cf_list_worker_deployments | 查看一个 Worker 的部署历史 | 只读 |

本版本不提供 DNS 写操作、Worker 上传、部署、Pages、R2 或 D1 变更工具。

## 行为和安全约定

- 请求使用 Authorization: Bearer，结果不会返回 Token 或原始认证头。
- 插件检查 Cloudflare success envelope；错误和非 2xx 响应会变成包含 API 错误消息和 code 的客户端错误。
- 结果使用字段白名单，只返回检查所需的 DNS 内容、Worker 元数据和部署字段。
- 列表工具限制单页大小并返回分页信息，调用方可以明确继续读取。
- 请求遵循配置的超时和工具 AbortSignal。
- 应使用只读权限，并尽量在 Cloudflare 侧限制 Account、Zone、IP 和有效期。
- `baseUrl` 覆盖必须是绝对的 `http(s)` 根地址。只允许公网可达主机：localhost、环回、私有、链路本地、CGNAT、组播、保留/文档/基准测试网段以及全部 IANA 特殊用途地址段都会被拒绝；DNS 结果包含任一此类地址时会在发出请求前 fail closed。

## Model Experience

模型可以先调用 cf_auth_test，再用 cf_list_zones 或 cf_list_workers 发现 ID，后续传入 zoneId、accountId 和 Worker script id。部署历史有界读取，不返回上传的脚本源码。

## 已知限制和后续工作

- MVP 不部署或修改 DNS、Workers、Pages、R2、D1 资源。
- Cloudflare 权限在插件外配置；Token 权限不足时会返回 Cloudflare 错误。
- Worker 脚本和部署字段会随 Account 功能变化，未知字段会被省略。
- 不会自动重试限流；应等待服务端给出的 retry 提示后再请求。

## 开发

~~~sh
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
~~~

端点映射和发布检查见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 许可证

[MIT](LICENSE)
