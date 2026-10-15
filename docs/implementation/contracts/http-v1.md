# 阶段 1 HTTP 约定

前缀 /api/v1，JSON 字段沿用前端 camelCase。后续新增业务 DTO 采用同一约定。
角色、范围、对象状态以服务端为准；客户端不提交 actor/scope/target 作为权限凭据。

## 已交付接口

| 方法和路径 | 输入 | 输出 data |
| --- | --- | --- |
| GET /health/live | 无 | status、mode |
| GET /health/ready | 无 | status、database；未初始化返回 503 |
| GET /demo/accounts | 无 | 测试账号数组；非演示模式 404 |
| POST /demo/login | accountId | accessToken、tokenType、expiresAt、user |
| POST /auth/login | username、password | 同快捷登录 |
| GET /auth/me | Bearer 令牌 | 当前数据库账号 |
| POST /auth/logout | Bearer 令牌 | signedOut；服务端撤销对应会话 |

账号 DTO：id、username、name、role、roleLabel、buildingIds（null 表示全校）。
快捷登录只接受数据库白名单账号，不接收自定义姓名和角色。
登录请求拒绝额外字段。每次使用令牌重新核验数据库账号、启用状态及会话。
刷新页面读取 /auth/me，不能从 localStorage 恢复自报权限。

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

Web 默认启用后端登录，`VITE_BACKEND_ENABLED=false` 才使用纯前端基线。
默认 /api/v1；可通过 VITE_API_BASE_URL 在构建时配置。
Vite 代理到 127.0.0.1:8000，Docker Nginx 代理到 api:8000。
不允许后端不可用时静默回退到本地写入。
当前尚未迁移的业务仍明确展示浏览器存储来源，阶段 3—5 完成后切换。
