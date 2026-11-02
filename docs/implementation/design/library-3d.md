# 校园 3D 建筑外观（图书馆与四栋既有楼）

2026-10-31。示例校区 5 栋楼全部补了 Blender 模型：B05 图书馆按用户提供的龙子湖图书馆照片校准；
B01–B04 以校方公开照片和校园航拍为参考，叠加档案层数/面积驱动尺寸。

> 口径：这些是**体量与立面示意模型，不是测绘复刻、竣工模型或 BIM**。楼栋/楼层字段仍是演示资料；
> B01、B03 的楼号与校方现有命名并非一一对应，B04 没有找到龙子湖馆本体照片（详见“来源与置信度”）。
> 按用户要求只保留建筑本体、基座与入口台阶，不放树木、绿篱或前场景观。

## 数据口径

| 项 | 值 |
| --- | --- |
| 楼栋 | `B01 1号综合楼`、`B02 2号实验楼`、`B03 3号教学楼`、`B04 体育馆`、`B05 图书馆` |
| 校园规模 | 5 栋 / 13 层 / 9 个测点；2D 园区图与 3D 校园总览共用同一份 footprint |
| 图书馆 | 5 层、28,000 ㎡、2018 年；归一化 `x=0.48, y=0.62, w=0.36, h=0.16`，南侧中轴 |
| 其余四栋 | 沿用档案层数：B01 2 层、B02 2 层、B03 3 层、B04 1 层；位置见 `src/db/seedArchive.ts` |
| 测点 | 图书馆仅 `B05-F1-CHECK01` 一层中庭人工检查点；不布设传感器、不伪造读数 |

数据在 `src/db/seeds/library.ts` 与 `src/db/seedArchive.ts` 合并；图书馆楼层/区域为演示占位，不是实测图纸。

## Blender 工具链

- Blender **4.5.10 LTS**，本机以便携版安装在
  `C:\Users\Lenovo\tools\blender-4.5.10\blender-4.5.10-windows-x64\`；
  桌面与开始菜单已建 `Blender 4.5 LTS` 快捷方式。
- 共享工具：`scripts/blender/scene_kit.py`（几何、材质、宋体文字、相机/灯光、GLB 导出、Cycles 预览）。
- 五个独立建模脚本，均以“正面朝 -Y、Z 向上、地面 z=0”为约定；一次运行完成
  `.blend` 保存、GLB 导出、预览渲染：

```powershell
$blender = "C:\Users\Lenovo\tools\blender-4.5.10\blender-4.5.10-windows-x64\blender.exe"
& $blender -b -P scripts/blender/library_longzihu.py
& $blender -b -P scripts/blender/b01_comprehensive.py
& $blender -b -P scripts/blender/b02_lab.py
& $blender -b -P scripts/blender/b03_teaching.py
& $blender -b -P scripts/blender/b04_gym.py
```

| 楼栋 | 脚本 | 运行时 GLB | Blender 源文件 |
| --- | --- | --- | --- |
| B05 图书馆 | `library_longzihu.py` | `public/models/library-longzihu.glb`（约 2.6 MB） | `assets/blender/library-longzihu.blend` |
| B01 综合楼 | `b01_comprehensive.py` | `public/models/b01-comprehensive.glb`（约 620 KB） | `assets/blender/b01-comprehensive.blend` |
| B02 实验楼 | `b02_lab.py` | `public/models/b02-lab.glb`（约 730 KB） | `assets/blender/b02-lab.blend` |
| B03 教学楼 | `b03_teaching.py` | `public/models/b03-teaching.glb`（约 690 KB） | `assets/blender/b03-teaching.blend` |
| B04 体育馆 | `b04_gym.py` | `public/models/b04-gym.glb`（约 500 KB） | `assets/blender/b04-gym.blend` |

## 模型内容

### B05 图书馆（高置信参考）

- 灰白石材双塔 + 中央深凹通高玻璃幕墙，玻璃 11 列 × 8 行分格；
- 二层入口平台、8 级宽台阶、逐级石质栏杆与立柱；
- 两端整排竖向石肋、深色玻璃带、塔身石带/角槽/方窗、檐下百叶与薄挑檐；
- 背面补齐实体后墙、层带、玻璃楼梯核、后门与雨篷；
- 校名横匾与竖排“图书馆”使用**宋体**（`C:/Windows/Fonts/STSONG.TTF`），随 GLB 转为网格；
- 无树木/绿篱。

### B01 综合楼（低置信：仅校园航拍）

- 浅灰/米白两层体量、蓝灰四坡顶、白檐口；
- 两排带白框的窗带、端部凸出墙垛、中央门廊/雨棚/台阶；
- “综合楼”宋体匾额；正/侧/背面都有窗，不与图书馆或体育馆穿插。

### B02 实验楼（高置信：校方“龙子湖生工楼/善知楼”）

- 左端塔楼 + 中部玻璃竖塔 + 右侧主翼的多翼组合；
- 浅灰墙、白色层间横带、蓝灰四坡瓦顶、深色窗框/玻璃带；
- 中央方柱门廊、宽台阶、玻璃连廊；正/侧/背均补窗；
- 实景约 5–6 层，档案只有 2 层，运行时按档案高度压缩（视觉示意，不与楼层记录冲突）。

### B03 教学楼（中置信：校方“龙子湖教学楼”，未确认是尚严楼哪一栋）

- 深灰板楼、白色厚挑檐、平屋顶；
- 立面竖向凹槽、窄条窗、小方孔、白色檐口；
- 端部白色折返外挂楼梯与黑色栏杆（实景最醒目的细节）；
- 右侧低翼与玻璃连接体；
- 实景约 5 层，档案 3 层，运行时按 3 层高度压缩。

### B04 体育馆（功能参考；非龙子湖馆本体）

- 低矮大跨体量、弧形金属屋面与分缝、深色高侧窗带；
- 浅暖石材墙面、白色横向窗带、中央玻璃入口/雨棚/台阶；
- 右侧低翼；正/侧/背均补窗；
- 来源为校方基建处“英才体育馆”照片（同校不同校区），龙子湖馆本体没有可核对照片。

## 2D 校园图重做

2D 不再用“灰色矩形 + 斜线填充”表示楼栋：

- `src/components/map/BuildingPlan.vue` 按楼栋编号绘制屋顶分缝、入口台阶、窗带与玻璃体：
  图书馆是双塔 + 中央玻璃中庭 + 正面大台阶，B01 是四坡顶，B02 是双翼/玻璃竖塔，B03 是平屋顶/竖向凹槽/外挂楼梯，
  B04 是弧形屋面与高侧窗；点击范围仍是原 footprint 矩形；
- `CampusBackdrop.vue` 改为浅纸色底图、双层围墙、道路路缘与虚线、草坪纹理、图书馆中心广场与南门步道、
  运动场、比例示意和指北针；不新增树木；
- 真实/示例的实线/虚线边框、归档楼栋和当前选中楼栋仍按原口径区分；
- 建筑落点与 3D 共用同一 footprint；B03 西移、B04 东移、B05 北移后，2D/3D 同步更新。

## 楼层抽屉

2D 和 3D 楼层视图共用 `src/components/map/FloorDrawer.vue`，对齐参考视频约 11 秒处的形态：

- 进入楼栋后从画面右缘展开窄竖向楼层栏，深色半透明底、`F1…Fn` 楼层按钮，当前层用琥珀色高亮；
- 抽屉从右缘抽出，收起时留一个“楼层”拉片；左侧拉手可向右拖动收起；底部“收起”关闭；
- 不做遮罩，场景和左侧内容仍可操作；Esc 也可关闭，打开时记住焦点、关闭归还；
- 抽屉只负责切换楼层；测点仍在 2D 表格、楼层平面图或 3D 侧栏中选择；
- 2D 点击楼栋、3D 进入单栋或切到“3D 楼层”时展开；切换 2D/3D 时关闭上一档抽屉，避免叠层。

### 房间名称

- 2D 楼层图和 3D 楼层视图默认**不显示房间名**；点击房间后才显示该房间名称；
- 2D 点击房间区域显示一组文字；3D 点击房间楼板/隔墙后显示对应标签；点其他房间会切换标签；

## 传感器展示

- 五种测点各有可辨认的程序化面板：裂缝计（锚固片 + 玻璃观察槽）、倾角计（圆形金属壳 + 镜面压圈）、
  振动计（散热鳍片 + 显示屏）、温湿度计（格栅进风孔 + 显示屏）、人工检查点（金色 NFC 标牌）；
- 当前层每个测点都有编号标签和细引线，标签不被墙体/楼板遮挡，方便先认编号再找安装面；
- 选中测点额外显示竖向虚线（从设备落到楼板）与楼板落点环，把“离地高度”和“平面位置”同时标出来；
- 楼层平面走廊从 100 放宽到 180（内容坐标），3D 里绕轴/拖动时有足够空间完整看到两侧墙面设备；
  测点最大贴墙判定同步放宽到 100，避免走廊中心测点被误判为“未贴墙”；
- 标签只在当前层（或选中点）出现，避免整栋楼层一起漂字；房间名仍按点击房间才显示；
- 这些是安装位置/外观类型的教学示意，不代表实际型号、固定工艺或埋深。

## 运行时接入

- `src/components/map/spatial/buildings/catalog.ts`：楼栋编号 → GLB 文件；新增楼栋只需加条目。
- `sceneBuild.ts` 用 `GLTFLoader` 并行懒加载五个 GLB；每加载完成一个触发一次场景重绘，
  失败的单个文件不影响其他楼栋。GLB 只在校园总览使用；进入单栋仍用 `sceneParts.ts` 的剖层内部视图。
- `buildings/modelShell.ts` 克隆几何/材质并按模板整体包围盒缩放到档案 footprint；模型正面统一朝 +Z，
  台阶/雨棚不会戳出展示台；高度取档案层数 × 4.2（体育馆额外 +2.6）。
- 图书馆不生成白底数据标签；其余四栋保留数据标签。B01–B04 的模型匾额是宋体文字网格。
- 兜底：任一 GLB 失败时，该栋回退到 `sceneShell.ts`/`libraryShell.ts` 的程序化外壳；五栋仍可点击。

## 来源与置信度

| 楼栋 | 参考 | 置信度 | 说明 |
| --- | --- | --- | --- |
| B02 | [校方基建处·龙子湖生工楼](https://jijian.hnuahe.edu.cn/info/1969/1727.htm) | 高 | 公开资料称善知楼即生工楼/实验楼；照片直接标注 |
| B03 | [校方基建处·龙子湖教学楼](https://jijian.hnuahe.edu.cn/info/1969/1726.htm) | 中 | 照片确认是龙子湖教学楼，但未确认“3号/尚严楼”编号 |
| B01 | [校友总会·校园风光航拍](https://xyh.hnuahe.edu.cn/info/1222/3424.htm) | 低 | 没有“1号综合楼”可核对照片；只参考航拍中低矮蓝顶楼 |
| B04 | [校方基建处·英才体育馆](https://jijian.hnuahe.edu.cn/info/1969/1732.htm) | 功能参考 | 同校不同校区的体育馆，不能当成龙子湖馆本体 |
| B05 | 用户提供的图书馆照片 + 公开实景照片 | 高 | 四面立面按照片校准；仍非测绘模型 |

参考图保存在 `docs/implementation/evidence/stage-library-3d/refs/buildings/`（含校方原图与航拍）。

## 复验记录

- `npm test`：125 文件 / 1172 用例通过（退出码 0）；`npm run typecheck`、`npm run build` 均以退出码 0 完成；
  GLB 会复制到 `dist/models/`。主包 1,048.60 kB 的 chunk 提示仍在，Three 仍单独分包。
- 本地示例模式（`VITE_BACKEND_ENABLED=false`，端口 5185）实测五个 GLB 均返回 **200**，
  无页面异常、canvas 正常；校园 3D 总览已渲染五栋自定义模型。
- 证据：
  - `b01-preview.png`、`b02-preview.png`、`b03-preview.png`、`b04-preview.png`、`library-blender-preview.png`：
    Cycles 预览；
  - `campus-2d-redesign.png`：重做后的 2D 校园图；`campus-3d-redesign.png`、`library-depth-redesign.png`：
    恢复进深后的校园 3D 与图书馆近景；`library-side.png`、`library-rear.png`：图书馆侧面/背面；
  - `models-load-final2.log`：五个 GLB 的 200 响应与无页面错误；
  - `sidebar-expanded.png`：左侧导航展开全部入口；`floor-rail-open.png`、`floor-rail-pulltab.png`：楼层抽屉抽出与收起拉片；
    `room-label-2d.png`、`room-label-3d.png`：点击房间后才显示房间名；
    `floor-pulled-out-wide.png`：选中楼层从楼体抽出、带 3D 前板/层号；`sensor-display-wide.png`：
    放宽走廊后当前层传感器与编号引线；
  - `campus-3d-redesign.png`：4173 服务端 demo-main 的校园 3D；`server-b05-seed.log`、`server-footprints.log`：
    往服务端补 B05 与同步 B03/B04 footprint 的写入记录；
  - `b01_comprehensive-final.log`、`b02_lab-final.log`、`b03_teaching-final.log`、`b04_gym-final.log`
    等构建日志，`test-sidebar-final.log`、`typecheck-sidebar-final.log`、`build-sidebar-final.log`。

## 服务端数据集

3D 只按楼栋编号/用途识别模型，不写死业务数据。当前本机 `demo-main` 已于 2026-10-31 通过档案写入 API
补齐 `B05 图书馆`（5 层地板记录 + `B05-F1-CHECK01` 人工检查点），并把 B03/B04 的 footprint 同步到
新的避让位置；因此 4173 的服务端预览也能看到图书馆。若重建数据库或换到另一个服务端实例，需要重新导入
B05 同口径档案；`demo-showcase` 由“完整演示”流程自行生成，不在这里改动。
