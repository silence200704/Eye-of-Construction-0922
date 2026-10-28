"""Original vector artwork for the native campus scrapbook UI; no remote assets."""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3] / 'mobile/openharmony/artwork'


def save(path, content, size):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    raw = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size[0]}" height="{size[1]}" '
           f'viewBox="0 0 {size[0]} {size[1]}" fill="none">{content}</svg>\n').encode()
    target.write_bytes(raw)
    return {'path': path, 'width': size[0], 'height': size[1], 'bytes': len(raw),
            'sha256': hashlib.sha256(raw).hexdigest(), 'author': 'Project-original vector drawing (AI assisted)',
            'rights': 'Project artwork; no third-party artwork copied', 'aiAssisted': True, 'version': '2.0.0'}


def mascot(pose):
    eye = '<path d="M105 119q23-28 47 0" stroke="white" stroke-width="8" stroke-linecap="round"/>'
    if pose == 'rest':
        eye = '<path d="m104 119 18 7m16 0 18-7" stroke="white" stroke-width="7" stroke-linecap="round"/>'
    if pose == 'guide':
        eye = '<ellipse cx="132" cy="117" rx="20" ry="23" fill="#102f38"/><circle cx="141" cy="108" r="7" fill="white"/>'
    prop = '<path d="m62 175-25 17m166-22 28-30" stroke="#194c50" stroke-width="15" stroke-linecap="round"/>'
    if pose == 'guide':
        prop = '<path d="m61 175-19-23m160 22 24 18" stroke="#194c50" stroke-width="15" stroke-linecap="round"/>'
    return f'''<defs><linearGradient id="shell" x1="68" y1="40" x2="192" y2="223" gradientUnits="userSpaceOnUse">
    <stop stop-color="#fffdf4"/><stop offset="1" stop-color="#c7e8d9"/></linearGradient>
    <linearGradient id="lens" x1="90" y1="76" x2="168" y2="155" gradientUnits="userSpaceOnUse">
    <stop stop-color="#2fa5ac"/><stop offset="1" stop-color="#086277"/></linearGradient></defs>
    <ellipse cx="132" cy="250" rx="79" ry="12" fill="#194c50" opacity=".12"/>
    <path d="m97 220-3 21m73-21 4 21" stroke="#194c50" stroke-width="16" stroke-linecap="round"/>
    {prop}<rect x="73" y="146" width="115" height="89" rx="36" fill="url(#shell)" stroke="#194c50" stroke-width="4"/>
    <path d="M87 183q44 27 87 0" stroke="#8dc9b3" stroke-width="4"/>
    <rect x="109" y="185" width="44" height="32" rx="11" fill="#fff5c5" stroke="#194c50" stroke-width="3"/>
    <path d="m123 200 6 6 12-13" stroke="#0f6e7c" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M132 51V29" stroke="#194c50" stroke-width="6" stroke-linecap="round"/>
    <path d="M131 31q-30-24-33 0 22 14 33 0Z" fill="#7fc9a0" stroke="#194c50" stroke-width="3"/>
    <circle cx="132" cy="26" r="8" fill="#ffd682" stroke="#194c50" stroke-width="3"/>
    <rect x="45" y="54" width="173" height="116" rx="50" fill="url(#shell)" stroke="#194c50" stroke-width="4"/>
    <path d="M64 94q5-26 30-27" stroke="white" stroke-width="8" stroke-linecap="round"/>
    <rect x="61" y="76" width="141" height="78" rx="35" fill="#c3e6db"/>
    <ellipse cx="132" cy="116" rx="47" ry="37" fill="url(#lens)" stroke="#194c50" stroke-width="3"/>
    {eye}<circle cx="80" cy="137" r="8" fill="#f4af9c"/><circle cx="184" cy="137" r="8" fill="#f4af9c"/>
    <path d="M122 153q10 7 20 0" stroke="#194c50" stroke-width="3" stroke-linecap="round"/>
    <path d="m221 45 4 11 12 4-12 4-4 12-4-12-12-4 12-4Z" fill="#ffd682" stroke="#194c50" stroke-width="2"/>
    <circle cx="28" cy="110" r="5" fill="#f4af9c"/>'''


def campus():
    buildings = ''
    for x, y, width, height, color in [(45, 122, 110, 112, '#f8d6ac'), (170, 75, 142, 158, '#d9eee0'),
                                     (325, 135, 104, 99, '#bddbe9')]:
        buildings += f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="8" fill="{color}" stroke="#35605a" stroke-width="3"/>'
        buildings += f'<path d="m{x-7} {y+2} 14-18h{width-14}l14 18Z" fill="#418f82" stroke="#35605a" stroke-width="3" stroke-linejoin="round"/>'
        for column in range(3):
            for row in range(3):
                buildings += f'<rect x="{x+19+column*width/4}" y="{y+23+row*29}" width="14" height="17" rx="4" fill="#5f9d98"/>'
    return f'''<path d="M20 217q200-42 440 2l-15 48H26Z" fill="#b1d6b1"/>
    <circle cx="382" cy="57" r="32" fill="#ffdc84" stroke="#35605a" stroke-width="3"/>
    <path d="M45 69q-3-22 19-22 8-25 31-8 26-8 26 17h24q14 20-5 21H48Z" fill="#fffdf5" stroke="#91c4bb" stroke-width="2"/>
    {buildings}<path d="M237 221q-55 28 4 59" stroke="#fff3ce" stroke-width="34"/>
    <path d="M240 223q-51 27 4 56" stroke="#dfa969" stroke-width="2" stroke-dasharray="5 9"/>
    <path d="M28 225v-32m417 30v-36" stroke="#35605a" stroke-width="4"/>
    <path d="M27 197c-39 1-22-53 0-43 25-9 39 44 0 43Zm418-9c-32 3-26-48-1-45 23-6 33 42 1 45Z" fill="#80b99b" stroke="#35605a" stroke-width="3"/>
    <path d="m157 42 4 10 11 4-11 4-4 10-4-10-11-4 11-4Z" fill="#f4af9c"/>
    <path d="M304 32q7-12 16 0m-22 6q7-12 16 0" stroke="#35605a" stroke-width="2" stroke-linecap="round"/>'''


def toolbox():
    return '''<ellipse cx="160" cy="216" rx="109" ry="13" fill="#d4e5db"/>
    <path d="m80 96 77-23 86 26v96l-83 27-80-26Z" fill="#f8cf9a" stroke="#285355" stroke-width="4" stroke-linejoin="round"/>
    <path d="m80 96 81 27 82-24m-82 24v99" stroke="#285355" stroke-width="4"/>
    <path d="m80 96-26 36 80 30 27-39 25 35 82-25-25-34" fill="#ffdfb6" stroke="#285355" stroke-width="4" stroke-linejoin="round"/>
    <path d="m104 104-4-54 46-4 5 72" fill="#e8f6e8" stroke="#285355" stroke-width="4"/>
    <path d="m108 66 19-2m-17 14 23-2m-22 15 17-2" stroke="#5c9a8f" stroke-width="3" stroke-linecap="round"/>
    <path d="m181 111 15-55q-17-16 0-29l3 17 14 4 11-13q8 20-11 27l-13 53" fill="#aad1df" stroke="#285355" stroke-width="4" stroke-linejoin="round"/>
    <path d="M55 66q-28-35-36-4 14 22 36 4Zm216 19q-2-34 26-25 7 24-26 25Z" fill="#8bc3a5" stroke="#285355" stroke-width="3"/>
    <path d="m69 26 3 9 10 4-10 3-3 10-4-10-9-3 9-4Z" fill="#f5b4a3"/>'''


def build():
    entries = [save(f'characters/{pose}.svg', mascot(pose), (264, 276)) for pose in ['scout', 'rest', 'guide']]
    entries += [save('brand/foreground.svg', f'<g transform="translate(182 155) scale(2.5)">{mascot("scout")}</g>', (1024, 1024)),
                save('brand/background.svg', '<rect width="1024" height="1024" fill="#cdeccd"/><circle cx="880" cy="160" r="210" fill="#fff0bc"/><path d="M0 800q500-180 1024 80v144H0Z" fill="#a9d5c3"/>', (1024, 1024))]
    entries += [save('scenes/campus.svg', campus(), (480, 300)), save('scenes/toolbox.svg', toolbox(), (320, 250))]
    entries += [save('patterns/dots.svg', '''<defs><pattern id="p" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.5" fill="#98b7a8" opacity=".32"/></pattern></defs><rect width="600" height="1000" fill="url(#p)"/>''', (600, 1000)),
                save('patterns/doodle.svg', '''<path d="M-30 64q80-95 140-13t135-9m118 190q72-66 145-9M30 245l17 7m-4-20 6 16M416 32l7 12m13-17-8 14" stroke="#5aaa95" stroke-width="3" stroke-linecap="round" opacity=".27"/><circle cx="322" cy="66" r="21" stroke="#5aaa95" stroke-width="2" opacity=".22"/><path d="m257 204 5 14 15 5-15 5-5 14-5-14-15-5 15-5Z" fill="#fff8d8" opacity=".8"/>''', (480, 300))]
    icons = {'arrow': '<path d="M8 16h16m-6-6 6 6-6 6"/>',
             'spark': '<path d="m16 3 4 9 9 4-9 4-4 9-4-9-9-4 9-4Z"/>',
             'shield': '<path d="m16 3 11 5v9q-2 8-11 12Q7 25 5 17V8Z"/><path d="m11 16 4 4 7-8"/>',
             'check': '<path d="m7 16 6 6L26 9"/>'}
    entries += [save(f'icons/{name}.svg', f'<g stroke="#0f6e7c" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">{path}</g>', (32, 32))
                for name, path in icons.items()]
    (ROOT / 'manifest.json').write_text(json.dumps({'version': '2.0.0', 'assets': entries}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Created {len(entries)} original native scrapbook SVG resources')


if __name__ == '__main__':
    build()
