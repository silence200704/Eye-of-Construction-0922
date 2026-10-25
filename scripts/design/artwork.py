"""Original, editable SVG assets. No downloaded art or font dependencies."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / 'public/design-studio/assets'
TEAL = '#0f6e7c'


def save(group, name, content, size=(240, 180)):
    folder = ROOT / group
    folder.mkdir(parents=True, exist_ok=True)
    width, height = size
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
           f'viewBox="0 0 {width} {height}" fill="none">{content}</svg>')
    (folder / f'{name}.svg').write_text(svg, encoding='utf-8')


ICONS = {
    'campus': 'M3 21h18M5 21V9l7-5 7 5v12M9 21v-5h6v5M8 11h1m6 0h1M8 14h1m6 0h1',
    'monitor': 'M3 4h18v13H3zM8 21h8m-4-4v4M6 12l3-4 4 5 4-6 2 3',
    'crack': 'M5 3h14v18H5zM13 3l-3 6 4 3-4 5 2 4',
    'tilt': 'M3 21h18M8 19 5 5l10-2 3 14M8 7l6-1m-5 5 6-1m-5 5 6-1',
    'vibration': 'M2 12h3l2-7 4 14 4-14 2 7h5',
    'alarm': 'M12 3 2 21h20L12 3zm0 6v5m0 3v1',
    'inspection': 'M9 4H5v17h14V4h-4M9 2h6v4H9zM8 12l2 2 5-5M8 18h7',
    'location': 'M19 10c0 6-7 12-7 12S5 16 5 10a7 7 0 0 1 14 0zm-4 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    'camera': 'M3 7h4l2-3h6l2 3h4v14H3zM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    'report': 'M5 3h10l4 4v14H5zM14 3v5h5M8 12h8m-8 4h5',
    'order': 'M14 5a5 5 0 0 0-6 6l-5 5a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-4 4-3-3 3-5z',
    'sync': 'M3 10a9 9 0 0 1 15-6l3 3M21 2v5h-5m5 7A9 9 0 0 1 6 20l-3-3m0 5v-5h5',
    'identity': 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM3 22v-3a9 9 0 0 1 18 0v3',
    'history': 'M3 7a10 10 0 1 1-1 8M3 2v5h5m4 0v6l4 2',
    'knowledge': 'M12 6c-3-3-7-3-10-2v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 2zm0 0v15',
    'check': 'M20 6 9 17l-5-5',
}


def build_icons():
    for name, path in ICONS.items():
        group = ('monitoring' if name in {'campus', 'monitor', 'crack', 'tilt', 'vibration', 'alarm'}
                 else 'field' if name in {'inspection', 'location', 'camera', 'report', 'order', 'check'}
                 else 'common')
        save(f'icons/{group}', name, f'<path d="{path}" stroke="{TEAL}" stroke-width="1.6" '
             'stroke-linecap="round" stroke-linejoin="round"/>', (24, 24))


def build_mascots():
    states = {
        'ready': ('M109 94h22', '#0f6e7c', 'M99 144q21 15 42 0'),
        'searching': ('M110 86h20m-10-10v20', '#397ac3', 'M106 146h28'),
        'found': ('m109 85 8 9 17-20', '#37754e', 'M100 142q20 18 40 0'),
        'missing': ('M111 78q18-9 18 5 0 8-9 9m0 8v1', '#697b83', 'M106 150q14-9 28 0'),
        'syncing': ('M107 89a13 13 0 0 1 22-11m0-7v9h-9m13 10a13 13 0 0 1-22 11', '#397ac3', 'M106 146h28'),
        'attention': ('M120 76v17m0 8v1', '#9b5c17', 'M106 148q14-7 28 0'),
    }
    for name, (mark, accent, mouth) in states.items():
        save('mascot', name, f'''
<ellipse cx="120" cy="209" rx="64" ry="9" fill="#dce7df"/>
<path d="M58 132 35 146m147-14 23 14" stroke="{accent}" stroke-width="12" stroke-linecap="round"/>
<path d="M89 190v13m62-13v13" stroke="{accent}" stroke-width="12" stroke-linecap="round"/>
<rect x="65" y="115" width="110" height="81" rx="33" fill="#e1ede7" stroke="#a4c1b4" stroke-width="2"/>
<path d="M120 38V23m-9 0h18" stroke="{accent}" stroke-width="5" stroke-linecap="round"/>
<rect x="48" y="37" width="144" height="105" rx="48" fill="#fbfdf9" stroke="#8ab2a6" stroke-width="3"/>
<rect x="62" y="51" width="116" height="73" rx="35" fill="#deece6"/>
<circle cx="120" cy="87" r="30" fill="{accent}"/>
<path d="{mark}" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="80" cy="106" r="5" fill="#efbeab"/><circle cx="160" cy="106" r="5" fill="#efbeab"/>
<path d="{mouth}" stroke="{accent}" stroke-width="3" stroke-linecap="round"/>
<path d="M106 173h28" stroke="#b5cbbb" stroke-width="5" stroke-linecap="round"/>
''', (240, 240))


def build_empty():
    marks = {
        'tasks': ICONS['inspection'], 'search': 'M15 15l6 6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
        'download': 'M12 2v13m-5-5 5 5 5-5M3 17v5h18v-5',
        'offline': 'M2 2l20 20M4 9q8-7 16 0M7 13q5-4 10 0m-7 4h4m-2 4v1',
        'api': 'M4 3h16v7H4zm0 11h16v7H4zM7 6h1m-1 11h1m5-11h4m-4 11h4',
        'photos': ICONS['camera'],
    }
    for name, mark in marks.items():
        save('empty', name, f'''<ellipse cx="120" cy="155" rx="70" ry="9" fill="#e3ebe0"/>
<circle cx="120" cy="86" r="65" fill="#edf3e6"/>
<rect x="66" y="40" width="107" height="104" rx="24" fill="#fff" stroke="#c9daca" stroke-width="2"/>
<path d="M78 128h80" stroke="#d8e4d6" stroke-width="3" stroke-linecap="round"/>
<g transform="translate(94 64) scale(2.2)"><path d="{mark}" stroke="{TEAL}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></g>
<circle cx="185" cy="48" r="9" fill="#efdbab"/><path d="M48 88h12m-6-6v12" stroke="#9db9a0" stroke-width="2"/>''')


def build_patterns():
    motifs = {
        'windows': '<path d="M20 16h40v54H20zm0 26h40m-20-26v54m55-3h40v54H75zm0 26h40m-20-26v54"/>',
        'buildings': '<path d="M0 120h28V52h30v68h20V32h34v88h48M36 65h7m-7 18h7m44-35h7m-7 18h7m-7 18h7"/>',
        'leaves': '<path d="M35 22q55 0 35 48Q20 80 35 22zm5 9 23 31m38 29q46 0 29 40-43 7-29-40zm5 8 18 23"/>',
        'route': '<path d="M0 80h35q20 0 20-25V0m0 160v-25q0-25 25-25h80" stroke-dasharray="5 7"/><circle cx="55" cy="55" r="6"/><circle cx="95" cy="110" r="6"/>',
    }
    for name, motif in motifs.items():
        for variant, color in [('soft', '#b9cdbf'), ('poster', '#5d8f83')]:
            save('patterns', f'{name}-{variant}', f'<g stroke="{color}" stroke-width="1.5" fill="none">{motif}</g>', (160, 160))


def build_flows():
    groups = [('inspection', ['到点', '逐项检查', '确认提交']),
              ('report', ['现场记录', '上报问题', 'Web审核']),
              ('order', ['接单', '完工', '验收', '复查'])]
    for name, labels in groups:
        parts = []
        gap = 920 / len(labels)
        for i, label in enumerate(labels):
            x = 40 + i * gap
            parts.append(f'<rect x="{x}" y="45" width="{gap-30}" height="100" rx="22" fill="#edf3e6" stroke="#bbd2be"/>'
                         f'<text x="{x+24}" y="76" fill="#0f6e7c" font-size="15">0{i+1}</text>'
                         f'<text x="{x+24}" y="116" fill="#203a37" font-size="23">{label}</text>')
            if i + 1 < len(labels):
                parts.append(f'<path d="M{x+gap-21} 95h15m-6-6 6 6-6 6" stroke="#719889" stroke-width="2"/>')
        save('flows', name, '<g font-family="Microsoft YaHei, sans-serif">'+''.join(parts)+'</g>', (1000, 190))
