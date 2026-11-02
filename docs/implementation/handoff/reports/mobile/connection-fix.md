# App 连接失败修复报告

2026-11-01。现象：App 地址和反向端口都在，但点“连接并读取数据”一直显示
“暂时无法完成读取，请检查连接后重试”。

## 根因

App 启动时会先打开本地离线库并执行 `commands.restore()`。当前 `NativeLocalSql` 把
`BEGIN TRANSACTION / COMMIT / ROLLBACK` 直接交给 RDB 的 `executeSql`；该接口不支持
事务控制语句，导致离线库初始化在事务处失败，`offline_packs`、`business_commands` 等表没有建出来。
随后恢复待核验队列抛出普通异常，在线连接也被这个本地错误阻断。

诊断中确认：服务端 `/demo/identities`、`/archive`、`/mobile/records` 等接口全部返回 200；
HDC 反向端口、模拟器网络正常；问题只在 App 的本地库初始化。

## 修复

`mobile/openharmony/entry/src/main/ets/core/offline/NativeLocalSql.ets`：

- `BEGIN TRANSACTION` → `RdbStore.beginTransaction()`
- `COMMIT` → `RdbStore.commit()`
- `ROLLBACK` → `RdbStore.rollBack()`
- 其他 SQL 继续走 `executeSql`

这样离线库建表、业务命令读写和事务回滚都使用 RDB 原生事务接口。

## 验证

- 重新安装签名 HAP，App 连接成功，工作台显示“已连接”、9 个可见测点、1 条未关闭预警。
- 本地离线库已创建全部表，`offline_schema` 版本为 3：
  `offline_packs / offline_notes / offline_reports / offline_operations / business_forms / business_commands / field_operations / offline_files`。
- 158 项原生 Node/mocks 测试通过；结构门禁 `violations=[]`；SDK 构建成功。
- 诊断用的 18003/18004 临时服务和 18091—18093 临时反向端口已清理，只保留
  `18080→8080` 与 `18090→18001`。

## 数据处理说明

诊断时执行过 `bm clean -d` 清空模拟器 App 本地数据（设置、本地离线草稿/笔记会丢失），
清空前的旧本地库已备份到被 Git 忽略的 `backend/.runtime-native-online/app-db/`；
服务端数据未受影响。清空后重新填写 `http://127.0.0.1:18090` 并连接成功。

## 追加：维修提交“照片结果不完整”

重连成功后再提交维修，仍提示“照片结果不完整，请用原照片核验”。

第二层原因是 App 连接的 `18001` 后端进程仍是旧版本：照片上传返回体缺少
`meta.datasetEpoch`，而 App 会校验该字段。Docker 的 `18000` 已是新代码，但它的业务库没有当前
“维修中”的工单状态；直接切到 `18000` 会丢失这条维修链。

处理：

- 保留 `backend/.runtime-mobile/zhutong.sqlite` 中的原工单状态；
- 用当前代码重启 `18001`，环境指向该运行库；
- App 继续使用 `18090 → 18001`。

复测结果：

- 照片上传返回 `datasetEpoch=1`，sha256 与原始照片一致；
- 维修提交成功，页面显示“服务端已保存，关联进度正在更新”；
- `WO-20261031-001` 状态为 `submitted`，措施已保存，关联 3 张验收照片；
- 158 项原生测试通过，结构门禁无违规，SDK 构建成功。
