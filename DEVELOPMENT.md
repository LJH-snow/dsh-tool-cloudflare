# dsh-tool-cloudflare 开发文档

## 1. 项目概览

| 项目 | 说明 |
|---|---|
| 项目名 | dsh-tool-cloudflare |
| 发布名 | @libai168/dsh-tool-cloudflare |
| 定位 | DeepSeek Harness 的 Cloudflare 只读 REST 插件 |
| 工具数 | 5 |
| 默认 API | https://api.cloudflare.com/client/v4 |
| 认证 | Scoped API Token，Authorization: Bearer |

## 2. 端点映射

| 工具 | 端点 |
|---|---|
| cf_auth_test | GET /user/tokens/verify |
| cf_list_zones | GET /zones |
| cf_list_dns_records | GET /zones/{zone_id}/dns_records |
| cf_list_workers | GET /accounts/{account_id}/workers/scripts |
| cf_list_worker_deployments | GET /accounts/{account_id}/workers/scripts/{script_name}/deployments |

Cloudflare response envelope 的 success 必须为 true；result_info 会被映射为分页字段。客户端不支持旧的 Global API Key 认证。

## 3. 设计决策

### 3.1 只读边界

首版只提供观察工具，避免 Agent 误删 DNS、上传代码或触发生产部署。写操作若以后加入，需要独立的权限说明、工具 kind edit 和更强的目标确认。

### 3.2 字段白名单

Zone、DNS、Worker 和部署响应都经过映射。插件不会把原始 API 对象、权限信息、脚本源码或凭据带入模型结果。

### 3.3 测试注入

CloudflareClient 接受 fetchImpl，测试覆盖 Bearer header、URL/query、Cloudflare envelope、HTTP 错误、分页、字段映射和缺少 account/zone id。

## 4. 发布前验证

~~~sh
npm run typecheck
npm test
npm run build
npm pack --dry-run
~~~

npm 包包含 lib、双语 README、DEVELOPMENT、examples 和 LICENSE。发布使用 npm publish --access public。
