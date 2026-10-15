# 筑瞳服务端

当前交付阶段 1：演示身份切换、可撤销会话、健康检查、Alembic 迁移、HTTP 接入。
17 张业务表、媒体、业务 API 及旧库迁移仍按后续阶段实施，不能将身份落库视为业务数据已迁移。

## 本地启动

在 backend 目录执行：

```powershell
uv sync --frozen
uv run python -m zhutong init
uv run uvicorn zhutong.app:create_app --factory --host 127.0.0.1 --port 8000
```

在项目根目录执行 `npm run dev`，打开 http://127.0.0.1:5173。
默认直接进入工作台，服务端核验演示身份，API 由 Vite 代理。纯前端基线需显式设置 `VITE_BACKEND_ENABLED=false`。

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

## 演示身份

学校安全管理人员、物业值班人员、设备管理人员、巡检人员、维修人员。
不设登录页面、账号或密码；首次默认安全管理身份，顶栏和设置页可切换，刷新保留身份。
切换只允许数据库中启用且 is_demo 的身份，`ZHUTONG_DEMO_MODE=false` 时关闭演示入口。
身份和操作范围仍由服务端核验；历史 reviewer 不作为可选演示角色，工单验收沿用 safety。

## 配置

环境变量前缀为 ZHUTONG_，可通过 backend/.env 配置：

| 字段 | 含义 |
| --- | --- |
| DATABASE_URL | SQLite URL，默认 backend/.runtime/zhutong.sqlite |
| RUNTIME_DIR | 密钥与后续运行文件目录 |
| SECRET_KEY | 可选签名密钥；未设置时生成并持久化 session.key |
| DEMO_MODE | 是否启用演示身份初始化与切换 |
| SESSION_TTL_SECONDS | 会话有效期，默认 8 小时 |

运行数据、密钥及 .env 不进入 Git；备份恢复时应一起保留持久化目录。

## 验证

```powershell
uv run pytest --cov=zhutong --cov-report=term-missing --cov-fail-under=80
uv run ruff check src tests migrations
uv run ruff format --check src tests migrations
```

每次业务迁移增加新的 Alembic revision，不修改已部署迁移。升级命令为
`uv run alembic upgrade head`；演示身份初始化通过 `python -m zhutong init`。
0002_identity_only 会删除旧 username/password_hash 字段，保留原身份和会话。
密码删除无法逆向恢复，回退旧版本需要升级前的数据库备份。
