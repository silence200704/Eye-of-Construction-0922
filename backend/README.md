# 筑瞳服务端

当前交付阶段 1：账号、可撤销会话、健康检查、Alembic 初始迁移、HTTP 接入。
17 张业务表、媒体、业务 API 及旧库迁移仍按后续阶段实施，不能将账号落库视为业务数据已迁移。

## 本地启动

在 backend 目录执行：

```powershell
uv sync --frozen
uv run python -m zhutong init
uv run uvicorn zhutong.app:create_app --factory --host 127.0.0.1 --port 8000
```

在项目根目录执行 `npm run dev`，打开 http://127.0.0.1:5173。
默认启用服务端登录，API 由 Vite 代理。纯前端基线需显式设置 `VITE_BACKEND_ENABLED=false`。

## Docker

在项目根目录执行：

```powershell
docker compose -f deploy/compose.yaml up --build -d
docker compose -f deploy/compose.yaml ps -a
```

Web：http://127.0.0.1:8080；文档：http://127.0.0.1:8000/docs。
手机访问同一局域网内电脑 IP 的 8080 端口；数据库仅由容器访问。
初始化任务先完成，再启动 API 和 Web。重建容器不会删除 runtime 卷。
停止使用 `docker compose -f deploy/compose.yaml down`；不要加 `-v`，该参数会删除数据卷。

## 测试账号

demo-safety / demo-property / demo-device / demo-inspector / demo-repair。
默认测试密码均为 `zhutong-demo`，也可在演示登录页直接选择测试账号。
快捷登录只允许数据库中启用且 is_demo 的账号，`ZHUTONG_DEMO_MODE=false` 时关闭。
历史 reviewer 不作为可登录演示角色，工单验收沿用 safety。

## 配置

环境变量前缀为 ZHUTONG_，可通过 backend/.env 配置：

| 字段 | 含义 |
| --- | --- |
| DATABASE_URL | SQLite URL，默认 backend/.runtime/zhutong.sqlite |
| RUNTIME_DIR | 密钥与后续运行文件目录 |
| SECRET_KEY | 可选签名密钥；未设置时生成并持久化 session.key |
| DEMO_MODE | 是否启用测试账号初始化与快捷登录 |
| DEMO_PASSWORD | 新建测试账号的密码；不会覆盖已有账号密码 |
| SESSION_TTL_SECONDS | 会话有效期，默认 8 小时 |

运行数据、密钥及 .env 不进入 Git；备份恢复时应一起保留持久化目录。

## 验证

```powershell
uv run pytest --cov=zhutong --cov-report=term-missing --cov-fail-under=80
uv run ruff check src tests migrations
uv run ruff format --check src tests migrations
```

每次业务迁移增加新的 Alembic revision，不修改已部署迁移。升级命令为
`uv run alembic upgrade head`；测试账号初始化通过 `python -m zhutong init`。
