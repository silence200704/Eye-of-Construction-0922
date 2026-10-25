"""Run from any directory: python scripts/design/build.py."""
import hashlib
from pathlib import Path
import json
import xml.etree.ElementTree as ET
from artwork import ROOT, build_empty, build_flows, build_icons, build_mascots, build_patterns, save
from scenes import build_scenes
from templates import build_templates


def build_brand():
    save('brand', 'app-icon-concept', '''<rect width="256" height="256" rx="64" fill="#0f6e7c"/>
<path d="M32 128s38-62 96-62 96 62 96 62-38 62-96 62-96-62-96-62z" stroke="#fff" stroke-width="9"/>
<circle cx="128" cy="128" r="33" fill="#dfeddf"/><path d="M112 143v-28l16-12 16 12v28m-22 0v-13h12v13" stroke="#0f6e7c" stroke-width="5" stroke-linejoin="round"/>''', (256, 256))
    save('brand', 'launch-concept', '''<rect width="720" height="1280" fill="#f3f6f2"/>
<circle cx="360" cy="480" r="110" fill="#e3eddc"/>
<path d="M280 480s30-55 80-55 80 55 80 55-30 55-80 55-80-55-80-55z" stroke="#0f6e7c" stroke-width="8"/>
<circle cx="360" cy="480" r="29" fill="#0f6e7c"/>
<g font-family="Microsoft YaHei,sans-serif" text-anchor="middle"><text x="360" y="685" font-size="56" font-weight="700" fill="#203a37">筑瞳</text>
<text x="360" y="745" font-size="25" fill="#52665f">陪你守护每一栋校园建筑</text>
<text x="360" y="1180" font-size="21" fill="#52665f">启动视觉概念 · 不延长实际启动时间</text></g>''', (720, 1280))


def manifest():
    entries = []
    for path in sorted(ROOT.rglob('*.svg')):
        xml = ET.parse(path).getroot()
        relative = path.relative_to(ROOT).as_posix()
        entries.append({'id': relative[:-4].replace('/', '.'), 'path': relative,
                        'width': int(xml.attrib['width']), 'height': int(xml.attrib['height']),
                        'bytes': path.stat().st_size,
                        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                        'source': 'scripts/design/*.py; original vector drawing',
                        'author': '本项目代码绘制（AI辅助）',
                        'rights': 'Project-original; no third-party artwork/source embedded; distribution terms follow project owner',
                        'version': '1.0.0', 'aiAssisted': True,
                        'nativeCompatibility': 'PNG export prepared separately; actual locked SDK validation pending stage 8'})
    for asset in entries:
        png = ROOT.parent / 'exports' / Path(asset['path']).with_suffix('.png')
        if png.exists():
            asset['png'] = {'path': png.relative_to(ROOT.parent).as_posix(),
                            'width': asset['width'], 'height': asset['height'],
                            'bytes': png.stat().st_size,
                            'sha256': hashlib.sha256(png.read_bytes()).hexdigest()}
    data = {'version': '1.0.0', 'date': '2026-10-25', 'assets': entries,
            'scope': 'Design assets and anonymous templates, not evidence of device or native app implementation',
            'mascot': 'New vector companion family; existing Web bitmap remains unchanged.'}
    (ROOT / 'manifest.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    tokens = {'brand': '#0f6e7c', 'canvas': '#f3f6f2', 'surface': '#ffffff',
              'text': '#203a37', 'secondary': '#52665f', 'line': '#d9e4d9',
              'warningText': '#8a530f', 'dangerText': '#ae3030', 'successText': '#28663e',
              'space': [4, 8, 12, 16, 24, 32], 'cardRadius': 22,
              'touchTarget': 48, 'bodyText': 16, 'captionText': 12,
              'platformUnits': 'Web CSS px/rem; ArkUI sizes vp, text fp with system scaling. Verify on locked SDK.',
              'semantics': {'offline': '本地快照，非实时', 'pending': '待同步，未获服务器确认',
                            'history': '历史记录', 'missing': '暂无数据，不判为正常',
                            'conflict': '数据已变化，请重新核对', 'simulated': '模拟输入'}}
    (ROOT / 'tokens.json').write_text(json.dumps(tokens, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Generated {len(entries)} original SVG assets and design tokens')


if __name__ == '__main__':
    build_icons()
    build_mascots()
    build_empty()
    build_patterns()
    build_flows()
    build_scenes()
    build_brand()
    build_templates()
    manifest()
