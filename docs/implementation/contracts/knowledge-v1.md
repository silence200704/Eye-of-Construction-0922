# 本地知识检索契约 v1

阶段 6，2026-10-23。Alembic head `0011_local_knowledge`。

## 范围和授权

前缀 `/api/v1/datasets/{dataset_id}/knowledge`。知识是全局项目知识，不按业务数据集复制；
路径数据集用于身份、范围上下文、epoch、审计和命令回执，不改变知识的全局含义。
维护必须是 `safety` 且 `buildingIds=null`；限定楼栋的安全身份不能维护全局知识。
文档按 `roles` 过滤检索；安全身份可检查所有文档。所有接口使用既有 Bearer 演示身份，
不新增账号密码。原文和来源路径只是数据，不读取该路径，不执行其中指令。

写命令须带 `Idempotency-Key`、`X-Dataset-Epoch`，按路径和内容计算摘要；
修改使用 `expectedRev`，重复命令重放原回执，内容碰撞 409，权限不符 403，校验失败 422。
文档/版本/块、审计、回执同事务；索引完整候选校验后原子切换。

## 接口

| 方法/后缀 | 请求与结果 |
| --- | --- |
| GET `/documents` | 当前身份可读文档；含当前原文、块和历史版本元信息 |
| GET `/documents/{id}` | 单篇详情；不把旧版本块作为当前检索结果 |
| POST `/documents` | title、sourcePath、sourceKind、content、roles；创建 V1 |
| POST `/documents/{id}/versions` | expectedRev、content、可选 title/roles；追加不可变版本 |
| POST `/documents/{id}/enabled` | expectedRev、enabled；启停并递增 rev |
| GET/POST `/faqs` | 维护限全局安全身份；chunkId、questions、enabled；修改加 id/expectedRev |
| GET/POST `/synonyms` | canonical、aliases、enabled；修改加 id/expectedRev |
| GET `/status` | mode、activeIndexId、chunkCount、lastError、degradedReason；可用时返回 modelId/dimension |
| POST `/indexes/rebuild` | 空对象；built、activeIndexId、error |
| POST `/search` | query（1—500 字）、topK（1—10，默认 3）；只读，无业务写入 |

文档原文上限 40000 字；FAQ 每条 1—500 字、别名每条 1—40 字，每个词条最多 20 条。
当前按标题/完整行切块，目标 700 字；超长单行再按句界切分，保留原行定位。
跨行切块最多重叠前一条不超过 80 字的行。哈希对应实际原文片段，行号从 1 开始。
FAQ 固定绑定具体版本块，更新文档后旧 FAQ 不参与召回，需要人工核对后重新绑定。
规范术语不能重复；启用别名冲突拒绝。同一问法命中多个当前依据时返回澄清。

构建失败仍返回 HTTP 200 的命令执行回执，但 `built=false` 且 error 非空，不能显示“发布成功”。
若旧索引与当前语料/模型仍一致则继续可用；已经过期则降级，不强用旧版本。
缺模型、索引损坏、维度/模型/原文集合变化均明确降级 `keyword`。

## 检索输出

`decision=answer|clarify|no_basis`，附 reason、answer、candidates、mode、degradedReason、
indexVersion、elapsedMs、scope。只有 answer 填原文摘录；澄清和无依据不生成结论。
候选含 documentId/chunkId/title/heading/text/version/sourcePath/sourceKind/lineStart/lineEnd/
sha256/methods/relevance/keywordScore/vectorScore/matchedTerms。
methods 为 faq/keyword/vector 的实际命中组合；relevance 是排序分值，不是可信概率。
禁用、旧版本和不适用身份的块不进入候选。动态业务数量和当前状态须查业务接口。

## 模型及恢复

`BAAI/bge-small-zh-v1.5`，MIT，原始 revision
`7999e1d3359715c523056ef9478215996d62a620`；ONNX 转换仓库
`Xenova/bge-small-zh-v1.5`，revision `75c43b069aac4d136ba6bc1122f995fedcfd2781`。
INT8、CPU、512 维、CLS 池化、L2 归一化；中文查询指令前缀固定。
SQLite 保存小端 float32 向量及 SHA-256；模型清单和全部固定资产哈希见运行证据。
准备脚本显式下载固定版本并校验固定哈希，服务端无下载路径。
`runtime/models/bge-small-zh-v1.5` 必须完整携带；缺失时不能称向量服务正常。
备份新增可选 modelFiles 清单，老备份仍可校验；恢复到独立目录，不覆盖已有目录。

阶段 7 接小瞳、会话、引用导航和历史会话来源展示；本阶段仅交付管理与检索试用。
