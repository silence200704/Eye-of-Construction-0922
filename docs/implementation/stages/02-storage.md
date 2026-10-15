# 阶段 2 核验记录

日期：2026-10-15。状态：通过，本阶段验收项全部完成。

## 完成度

- [x] 覆盖原 17 张业务表的关系模型及快照字段。
- [x] 独立测试数据集、epoch、审计、偏好、会话状态、幂等回执、导入批次基础。
- [x] 楼栋/楼层/测点外键、唯一业务编号、坐标/版本/状态等约束。
- [x] 0003—0007 分模块 Alembic 迁移；空库升级、阶段 2 降级升级往返、模型与迁移无漂移。
- [x] 图片与 MP4 上传、元数据查询、鉴权读取、归属关联及错误回滚。
- [x] 并发上传去重、重复关联拒绝、三张/600 KB 配额、角色和楼栋范围验证。
- [x] SQLite 在线快照、文件哈希清单、校验与新目录恢复。
- [x] 更新启动说明、字段映射、HTTP 约定与存储边界。
- [x] 自动回归、结构检查和真实容器升级。
- [x] 重启后原文件读取及工作台身份恢复核验。

## 自动核验

| 检查 | 结果 |
| --- | --- |
| uv run pytest --cov=zhutong --cov-report=term-missing --cov-fail-under=80 -q | 55 测试通过，覆盖率 95.03% |
| uv run ruff check src tests migrations | 通过 |
| uv run ruff format --check src tests migrations | 通过 |
| Python AST 结构扫描 | 59 文件通过，文件 ≤450、函数 ≤80、参数 ≤5；代码目录每层文件 ≤8 |
| npm test -- --reporter=dot | 110 文件、1097 测试通过 |
| npm run typecheck | 通过 |
| Docker Web 构建 | 复用前一阶段已通过的同源构建缓存，Web 源码本阶段无变更 |
| docker compose config 与 up --build -d | 通过，初始化退出 0、API healthy |

Starlette TestClient 仍有既有 httpx 兼容弃用提示，测试正常。

## 实际运行

1. 升级前快照：runtime 卷 /data/backups/before-stage2-cf761bb2，保留原 5 类身份及内部会话。
2. 数据库升级至 0007_media，29 张应用表加版本表共 30 张表。
3. 通过 Web 容器 Nginx 访问 ready 和数据集接口，返回 ready 与两个测试集。
4. 实际上传 stage2-storage-check.png（明确标为 demo_generated），读取原始字节一致。
5. 在容器内执行 backup、verify-backup、restore-backup CLI；恢复库完整性及媒体哈希通过。
6. 验证备份 /data/backups/stage2-5f1fcec4，恢复至 /data/verification/restore-f333abe3。
7. API 重启后，原媒体文件仍能通过 Nginx 读取且 SHA-256 一致；5 类身份、2 个测试集及外键完整。
8. 浏览器刷新后恢复维修身份并直接进入工作台，无登录页面。

运行证据：[存储核验 JSON](../evidence/stage2-storage-check.json)。

## 范围与下一阶段

本阶段交付数据库和媒体基础，不能视为旧数据已导入或业务接口已经全面迁移。
当前 Web 业务仍使用明确标注的 IndexedDB；AI 逻辑未改变。
下一阶段是旧库、附件、偏好及可获取临时数据的导出导入与核对报告。
MP4 当前只验证容器结构，不声称可解码或已提取视频尺寸。
对进程崩溃留下的未引用文件保持保留，当前不提供自动清理或文件删除接口。

## Git 证据

RED/GREEN：1643d24/b38fe29、4f84fc8/7e758ff、b9f97c6/596a27a、489d773/27ccce8。
验收标签 codex/stage2-verified；原阶段标签与 RED/GREEN 检查点均保留。
