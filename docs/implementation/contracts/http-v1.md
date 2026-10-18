# 阶段 1 HTTP 约定

前缀 /api/v1，JSON 字段沿用前端 camelCase。后续新增业务 DTO 采用同一约定。
角色、范围、对象状态以服务端为准；客户端不提交 actor/scope/target 作为权限凭据。

## 已交付接口

| 方法和路径 | 输入 | 输出 data |
| --- | --- | --- |
| GET /health/live | 无 | status、mode |
| GET /health/ready | 无 | status、database；未初始化返回 503 |
| GET /demo/identities | 无 | 演示身份数组；非演示模式 404 |
| POST /demo/identity | identityId | accessToken、tokenType、expiresAt、user |
| GET /auth/me | Bearer 令牌 | 当前数据库身份 |
| POST /auth/logout | Bearer 令牌 | signedOut；服务端撤销对应会话 |

身份 DTO：id、name、role、roleLabel、buildingIds（null 表示全校）。
身份切换只接受数据库白名单中的启用演示身份，不接收自定义姓名和角色；拒绝额外字段。
无账号密码接口，旧 /auth/login、/demo/login、/demo/accounts 返回 404。
每次使用内部令牌重新核验数据库身份、启用状态及会话。/auth/logout 仅保留内部会话撤销能力，界面无退出入口。
首次打开自动选择 safety 身份；刷新读取 /auth/me；失效会话重新从服务端名单选择上次身份。
localStorage 中的 identity-id 只是选择提示，不能作为权限凭据。连接故障展示重试，不自动改换身份。

## 信封

成功：`{ ok: true, data, rev: null, replayed: false, meta: { requestId } }`。
失败：`{ ok: false, error: { code, message, retryable, details }, meta: { requestId } }`。
响应同时携带 X-Request-ID。客户端不能将代理 HTML 错误页或不合法信封视为成功。

| HTTP | 当前错误码 |
| --- | --- |
| 401 | AUTH_REQUIRED |
| 404 | NOT_FOUND |
| 422 | VALIDATION_FAILED |
| 503 | STORAGE_UNAVAILABLE |
| 500 | INTERNAL |

未来业务接口补充 ROLE_FORBIDDEN、SCOPE_FORBIDDEN、VERSION_CONFLICT、STATE_CONFLICT、
DATASET_EPOCH_CONFLICT 等；这些业务接口尚未交付，不冒充已有服务。
写操作将使用 Idempotency-Key、expectedRev 及 datasetEpoch；完整行为在相应阶段测试。

## 模式与连接

Web 默认启用后端身份切换并直接进入工作台，`VITE_BACKEND_ENABLED=false` 才使用纯前端基线。
默认 /api/v1；可通过 VITE_API_BASE_URL 在构建时配置。
Vite 开发与预览代理到 127.0.0.1:18000，Docker Nginx 代理到 api:8000。
宿主机 8000、5173 留给查寝系统；筑瞳开发入口为 5180，Docker 入口为 8080。
不允许后端不可用时静默回退到本地写入。
当前尚未迁移的业务仍明确展示浏览器存储来源，阶段 3—5 完成后切换。
