"""Anonymous, editable promotional templates; no unimplemented claims."""
from artwork import ROOT, save


def embedded(name, rect):
    svg = (ROOT / f'scenes/{name}.svg').read_text(encoding='utf-8')
    content = svg[svg.index('>')+1:svg.rindex('</svg>')]
    x, y, width, height = rect
    return f'<svg x="{x}" y="{y}" width="{width}" height="{height}" viewBox="0 0 640 360">{content}</svg>'


def poster(name, title, detail, scene):
    art = '<rect width="1080" height="1440" fill="#f3f6f2"/><circle cx="1100" cy="80" r="450" fill="#e4ecd8"/>'
    art += '<path d="M0 1100q400-260 1080-40" stroke="#e7ddc3" stroke-width="100"/>'
    art += '<g font-family="Microsoft YaHei,sans-serif">'
    art += '<text x="80" y="105" font-size="26" fill="#0f6e7c">筑瞳 · 校园守护</text>'
    art += f'<text x="80" y="245" font-size="68" font-weight="700" fill="#203a37">{title}</text>'
    art += f'<text x="80" y="312" font-size="29" fill="#52665f">{detail}</text>'
    art += embedded(scene, (35, 350, 1010, 568))
    art += '<rect x="80" y="955" width="920" height="225" rx="32" fill="#fff" stroke="#cddcce" stroke-dasharray="9 9"/>'
    art += '<text x="120" y="1040" font-size="28" fill="#52665f">真实界面 / 录屏截图放置区</text>'
    art += '<text x="120" y="1100" font-size="23" fill="#52665f">阶段10替换；此处不是已实现功能截图。</text>'
    art += '<text x="80" y="1260" font-size="26" fill="#0f6e7c">Web 管理分析 × OpenHarmony 原生 App 规划</text>'
    art += '<text x="80" y="1320" font-size="22" fill="#52665f">匿名设计模板 · 硬件输入与设备状态为模拟</text>'
    art += '<text x="80" y="1360" font-size="22" fill="#52665f">App / 离线能力待阶段8、9实现与验收</text></g>'
    save('templates', name, art, (1080, 1440))


def covers():
    art = '<rect width="1920" height="1080" fill="#f3f6f2"/><circle cx="1780" cy="90" r="540" fill="#e4ecd8"/>'
    art += embedded('morning', (930, 250, 930, 530))
    art += '''<g font-family="Microsoft YaHei,sans-serif" fill="#203a37">
<text x="130" y="175" font-size="34" fill="#0f6e7c">筑瞳 · 校园建筑健康状态监测与预警</text>
<text x="130" y="420" font-size="98" font-weight="700">看见变化，</text>
<text x="130" y="550" font-size="98" font-weight="700">接续每一步处置。</text>
<text x="135" y="680" font-size="34" fill="#52665f">监测 · 巡检 · 问题 · 工单</text>
<text x="135" y="900" font-size="27" fill="#52665f">匿名封面模板 · 模拟硬件输入 · App原生实现待阶段8</text></g>'''
    save('templates', 'cover-16x9', art, (1920, 1080))
    portrait = '<rect width="1080" height="1920" fill="#f3f6f2"/>'
    portrait += embedded('inspection', (0, 380, 1080, 608))
    portrait += '''<g font-family="Microsoft YaHei,sans-serif" fill="#203a37">
<text x="85" y="155" font-size="36" fill="#0f6e7c">筑瞳 · 校园守护</text>
<text x="85" y="290" font-size="83" font-weight="700">从发现到接续</text>
<rect x="85" y="1050" width="910" height="530" rx="35" fill="#fff" stroke="#c5d6c6" stroke-dasharray="8 8"/>
<text x="135" y="1300" font-size="35" fill="#52665f">阶段10替换真实界面与录屏</text>
<text x="85" y="1745" font-size="28" fill="#52665f">匿名宣传模板 · 硬件输入模拟</text>
<text x="85" y="1800" font-size="27" fill="#52665f">App / 离线能力待实现与验收</text></g>'''
    save('templates', 'cover-9x16', portrait, (1080, 1920))


def collaboration():
    art = '<rect width="1600" height="900" fill="#f3f6f2"/><g font-family="Microsoft YaHei,sans-serif">'
    art += '<text x="90" y="130" font-size="52" font-weight="700" fill="#203a37">同一份业务事实，接续现场与管理。</text>'
    for x, title, desc in [(90, 'App 现场办理', '原生设计原型 · 待实现'), (600, '共享 FastAPI 服务', 'SQLite / 媒体 / 审计回执'), (1110, 'Web 管理分析', '现有已接入的业务模块')]:
        art += f'<rect x="{x}" y="280" width="390" height="280" rx="36" fill="#fff" stroke="#c8d9c9"/>'
        art += f'<text x="{x+30}" y="385" font-size="32" fill="#0f6e7c">{title}</text>'
        art += f'<text x="{x+30}" y="455" font-size="23" fill="#52665f">{desc}</text>'
    art += '<path d="M500 420h75m-15-15 15 15-15 15m450 0 15-15-15-15m-60 15h75" stroke="#7b9c88" stroke-width="5"/>'
    art += '<text x="90" y="710" font-size="27" fill="#52665f">协同使用 HTTP 与共同后端；不是鸿蒙分布式软总线能力。</text>'
    art += '<text x="90" y="770" font-size="27" fill="#52665f">匿名设计模板 · 硬件输入模拟 · 不声称实体传感器或声光模块已接通</text></g>'
    save('templates', 'collaboration', art, (1600, 900))


def build_templates():
    for row in [('main', '陪你守护校园建筑', '看见异常，留下依据，接续处置。', 'morning'),
                ('discovery', '每一处变化，都有据可查', '从监测预警到本地知识解释。', 'field-report'),
                ('field', '把现场，认真记录下来', '到点、检查、照片与问题上报。', 'inspection'),
                ('closed-loop', '让每一步处置有回应', '工单、验收、复查与离线补传设计。', 'maintenance')]:
        poster(*row)
    covers()
    collaboration()
