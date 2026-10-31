"""Compose separately laid-out Mermaid sections into one readable flow poster."""
import re
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent
WORK = ROOT.parents[3] / "backend/.runtime-business-diagram"
KEYS = ["ENTRY", "BASE", "INS", "MAINT", "ISSUE", "ORDER", "RECHECK", "ALARM", "SUPPORT", "LINKAGE", "DEMO"]
OUTPUTS = {
    "BASE": 'ASSESS -- "当前有效异常，转⑧" --> PORT_BASE["⑧ 创建/升级预警"]',
    "INS": 'IP -- "同时转⑤" --> PORT_INS["⑤ 问题待审核"]',
    "MAINT": 'MI -- "同时转⑤" --> PORT_MAINT["⑤ 问题待审核"]',
    "ISSUE": 'REPAIR --> PORT_ISSUE["⑥ 待派工工单"]\nDIRECT --> PORT_RECHECK["⑦ 登记复查"]',
    "ORDER": 'VERIFIED -- "有关联问题" --> PORT_ORDER["⑦ 问题复查；预警另按⑧关闭"]',
    "RECHECK": 'RECUR --> PORT_AGAIN["⑤ 回到原问题审核"]',
    "ALARM": 'HANDLE -- "需要维修" --> PORT_ALARM["⑤ 当前预警关联问题 → ⑥ 工单"]',
    "DEMO": 'DCONTROL -- "模拟采样" --> PORT_DEMO["② 同一判定 → ⑧ 预警"]',
}


def prepare():
    source = (ROOT / "zhutong-business-flow.mmd").read_text(encoding="utf-8")
    classes = source[source.index("  classDef web"):]
    WORK.mkdir(parents=True, exist_ok=True)
    markdown = ["# 筑瞳全业务流程分区源图", "", "分区引用①—⑪对应同一张总图，蓝色为Web、绿色为App、灰色为共用业务。", ""]
    for key in KEYS:
        block = re.search(rf'  subgraph {key}\[.*?\n  end', source, re.S).group()
        if key in {"BASE", "INS", "MAINT", "RECHECK", "ALARM"}:
            block = block.replace("direction LR", "direction TB", 1)
        extra = OUTPUTS.get(key, "")
        block = block.rsplit("  end", 1)[0] + extra + "\n  end"
        direction = "LR" if key in {"ENTRY", "ORDER", "SUPPORT", "LINKAGE", "DEMO"} else "TB"
        graph = f"flowchart {direction}\n" + block + "\n" + classes
        (WORK / f"{key}.mmd").write_text(graph, encoding="utf-8")
        markdown.extend([f"## {key}", "", "```mermaid", graph.rstrip(), "```", ""])
    (ROOT / "section-source.md").write_text("\n".join(markdown), encoding="utf-8")
    print(WORK)


def panel(key, x, y, width):
    raw = (WORK / f"{key}.svg").read_text(encoding="utf-8")
    raw = raw[raw.index("<svg"):].replace("my-svg", f"chart-{key}")
    box = re.search(r'viewBox="([^"]+)"', raw).group(1).split()
    natural_width, natural_height = map(float, box[2:])
    scale = min(width / natural_width, 1.35)
    height = natural_height * scale
    shown_width = natural_width * scale
    raw = re.sub(r'\s(?:width|height|style)="[^"]*"', '', raw, count=3)
    raw = raw.replace("<svg ", f'<svg x="{x + (width - shown_width) / 2:.2f}" y="{y}" width="{shown_width:.2f}" height="{height:.2f}" ', 1)
    return raw, height


def compose():
    width, gap, margin = 3600, 45, 70
    usable = width - 2 * margin
    parts = [f'<rect width="{width}" height="100%" fill="#fff"/>',
             '<text x="70" y="80" font-size="44" font-weight="600" fill="#1e463a">筑瞳｜全业务流程与 Web ↔ App 联动</text>',
             '<text x="70" y="130" font-size="24" fill="#405b50">Web 与 App 共用业务状态；各节点标明入口、操作、身份和完成条件。分区编号用于跨区接续。</text>',
             '<text x="70" y="174" font-size="23" fill="#405b50">蓝色：Web入口　绿色：App入口　灰色：共用流程　黄色：判定/分支　浅绿：完成　浅橙：退回/异常</text>']
    y = 215
    rows = [["ENTRY"], ["BASE", "INS", "MAINT"], ["ISSUE"], ["ORDER"], ["RECHECK", "ALARM"], ["SUPPORT"], ["LINKAGE"], ["DEMO"]]
    for row in rows:
        column_width = (usable - gap * (len(row) - 1)) / len(row)
        heights = []
        for index, key in enumerate(row):
            svg, height = panel(key, margin + index * (column_width + gap), y, column_width)
            parts.append(svg)
            heights.append(height)
        y += max(heights) + gap
    footer = "检查完成 ≠ 工单验收 ≠ 问题关闭 ≠ 预警关闭｜本机草稿、照片上传与待同步不代表服务端办理成功｜2026-11-01"
    parts.append(f'<text x="70" y="{y}" font-size="25" fill="#405b50">{escape(footer)}</text>')
    height = int(y + 65)
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" font-family="Microsoft YaHei, sans-serif"><title>筑瞳全业务与双端联动总流程图</title>' + "".join(parts) + "</svg>"
    (ROOT / "zhutong-business-flow.svg").write_text(svg, encoding="utf-8")
    print({"width": width, "height": height, "sections": len(KEYS)})


if __name__ == "__main__":
    import sys
    compose() if sys.argv[-1] == "compose" else prepare()
