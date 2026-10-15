# 阶段 1 核验记录

状态：通过。日期：2026-10-15（Asia/Shanghai）。

## 交付及完成度

- [x] FastAPI 工程、uv 锁定、Python 3.12.13。
- [x] 路由 → operations → 仓储 Protocol → SQLAlchemy 分层。
- [x] 配置、请求标识、日志、统一错误和健康检查。
- [x] 独立数据库会话、SQLite 外键/WAL/锁等待。
- [x] Alembic 初始账号迁移与幂等初始化命令。
- [x] 五类测试账号、Argon2 密码哈希、JWT 与数据库可撤销会话。
- [x] 登录、读取当前账号、快捷切换、退出撤销。
- [x] Web 登录门禁、刷新核验、服务端账号选择和过期状态清理。
- [x] HTTP 客户端、开发代理、网络/代理错误处理。
- [x] Docker API/Web/初始化服务、非 root 运行及持久化卷。
- [x] 自动测试、结构检查、容器 HTTP 和实际页面验证。
- [x] 启动说明及第一版接口约定落档。

本阶段验收项全部通过，不代表整个项目或业务数据迁移完成。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| npm test -- --reporter=dot | 110 文件、1091 测试通过（原 1079 + 新增 12） |
| npm run typecheck | 通过 |
| Docker Web 构建中的 npm run build | 通过；原分包警告保留 |
| uv run pytest --cov=zhutong --cov-report=term-missing --cov-fail-under=80 -q | 21 测试通过，覆盖率 94.71% |
| uv run ruff check src tests migrations | 通过 |
| uv run ruff format --check src tests migrations | 通过 |
| 新 Python/TS/Vue 脚本结构扫描 | 文件 ≤450、函数 ≤80、参数 ≤5；新目录按层划分 |
| docker compose -f deploy/compose.yaml config --quiet | 通过 |
| docker compose -f deploy/compose.yaml up --build -d | 初始化退出 0，API healthy，Web 正常运行 |

Starlette TestClient 提示 httpx 兼容弃用警告，当前测试通过，后续依赖维护时处理。

## 实际运行验证

1. 通过 8080 反向代理读取 ready，返回 SQLite ready。
2. 读取 5 个测试账号，使用 inspector 登录后 /auth/me 返回 inspector。
3. 注销后数据库会话撤销（自动测试验证旧令牌 401）。
4. 浏览器选择巡检账号，进入原校园总览。
5. 刷新后服务端核验恢复账号并完成工作台初始化。
6. 打开账号弹窗，切到维修账号，顶栏身份同步。
7. 退出登录，页面返回测试账号入口。
8. 镜像重建/容器重建后数据库账号与签名密钥保持，已有登录可核验恢复。

截图：[服务端登录入口](../evidence/stage1-server-login.png)。
本机入口：http://127.0.0.1:8080；接口文档：http://127.0.0.1:8000/docs。

## 本阶段发现并修复

- 匿名登录失败触发旧账号失效：登录请求不带旧令牌、不清除既有会话，补回归。
- 异步旧登录覆盖新身份：提交代次保护，旧响应不更新当前账号。
- 登录页卸载先于 initialized 事件：父层观察登录账号变化触发工作台初始化，补回归。
- Nginx 非 root 默认缓存无权限：所有临时缓存改为 /tmp，保留非 root 运行。

## 下一阶段与限制

当前 SQLite 仅有账号、会话及 Alembic 版本。17 张业务表、媒体、旧库导入、
巡检工单业务服务、本地向量助手和 Android 尚未交付。
旧业务仍明确使用浏览器 IndexedDB，未将本阶段登录能力标为业务权限迁移完成。
后端模式已移除顶栏/设置页任意姓名角色输入；旧自动演示内部身份编排在阶段 10 接入后端。
下一阶段为关系模型、业务约束、媒体上传及 Alembic 分模块迁移。

## Git 证据

实施分支 codex/fullstack-competition；原始恢复标签 codex/baseline-frontend-20261015。
保留 RED/GREEN 检查点：79835e5/a6ebc7b、54088ac/f0bd271、e2ba606/d3cdf74、
c339636/阶段验收标签 codex/stage1-verified。Docker RED d0e0a27 后已通过 HTTP 与页面验收。
