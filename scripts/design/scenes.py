"""Four campus compositions drawn as local vectors."""
from artwork import save


def building(x, y, width, levels):
    height = levels * 28 + 26
    windows = ''.join(f'<rect x="{x+16+col*25}" y="{y+20+row*28}" width="10" height="15" rx="2" fill="#699e99"/>'
                      for row in range(levels) for col in range(max(1, int((width-20)//25))))
    return (f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="5" fill="#d2e4dc"/>'
            f'<path d="M{x-7} {y}h{width+14}l-10-13h-{width-6}z" fill="#4f8b82"/>' + windows)


def tree(x, y, size=24):
    return (f'<path d="M{x} {y}v{size+12}" stroke="#7f8e65" stroke-width="4"/>'
            f'<ellipse cx="{x}" cy="{y}" rx="{size*.7}" ry="{size}" fill="#8eb39b"/>')


def morning():
    art = '<circle cx="514" cy="74" r="45" fill="#f1d79d"/>'
    art += '<path d="M35 270Q320 174 600 270l-5 54H40z" fill="#dae8d6"/>'
    art += '<path d="M270 340q-60-80 60-118" stroke="#faf4df" stroke-width="40"/>'
    art += building(115, 150, 126, 3) + building(282, 109, 160, 4) + building(465, 190, 84, 2)
    art += ''.join(tree(x, y, size) for x, y, size in [(70, 244, 27), (570, 250, 23), (263, 277, 19), (454, 284, 25)])
    art += '<path d="M83 79h65m-25 13h58M421 52h37" stroke="#e1ece6" stroke-width="12" stroke-linecap="round"/>'
    save('scenes', 'morning', art, (640, 360))


def inspection():
    art = '<rect x="52" y="34" width="535" height="285" rx="85" fill="#e9f0e3"/>'
    art += '<path d="M92 259h150q50 0 50-60t52-60h200" stroke="#fff8e8" stroke-width="33" stroke-linecap="round"/>'
    art += '<path d="M92 259h150q50 0 50-60t52-60h200" stroke="#9db698" stroke-width="2" stroke-dasharray="6 9"/>'
    art += building(110, 90, 115, 3) + building(360, 200, 122, 2)
    art += tree(520, 270, 28) + tree(292, 69, 28) + tree(66, 171, 25)
    for x, y, label in [(120, 260, '1'), (293, 188, '2'), (496, 139, '3')]:
        art += f'<circle cx="{x}" cy="{y}" r="20" fill="#0f6e7c"/><text x="{x}" y="{y+6}" text-anchor="middle" font-family="sans-serif" font-size="17" fill="white">{label}</text>'
    save('scenes', 'inspection', art, (640, 360))


def field_report():
    art = '<ellipse cx="300" cy="293" rx="235" ry="27" fill="#dfeadc"/>'
    art += building(59, 133, 144, 4) + tree(565, 254, 30)
    art += '<rect x="270" y="41" width="178" height="266" rx="27" fill="#4f8379"/>'
    art += '<rect x="282" y="57" width="154" height="227" rx="17" fill="#fffdf8"/>'
    art += '<rect x="316" y="32" width="83" height="28" rx="11" fill="#e9d49e"/>'
    art += '<rect x="302" y="83" width="114" height="75" rx="12" fill="#e3eee8"/>'
    art += '<path d="m310 147 30-37 23 25 17-15 25 27" stroke="#82a78e" stroke-width="4" stroke-linecap="round"/>'
    art += '<circle cx="388" cy="103" r="8" fill="#e8ce8f"/>'
    art += '<path d="M306 187h10m-5-5v10m22-5h63m-90 30h10m-5-5v10m22-5h63m-90 30h10m-5-5v10m22-5h44" stroke="#648d7e" stroke-width="4" stroke-linecap="round"/>'
    art += '<path d="m458 275 53-151 15 5-53 151z" fill="#e8cb8b"/>'
    save('scenes', 'field-report', art, (640, 360))


def maintenance():
    art = '<circle cx="320" cy="179" r="142" fill="#e8efe3"/>'
    art += building(70, 145, 144, 4) + building(467, 191, 95, 2) + tree(55, 281, 23)
    art += '<rect x="225" y="191" width="224" height="112" rx="20" fill="#87a994"/>'
    art += '<path d="M289 192v-32h94v32" stroke="#507865" stroke-width="14" stroke-linejoin="round"/>'
    art += '<rect x="225" y="216" width="224" height="35" rx="8" fill="#a7c2a7"/>'
    art += '<rect x="321" y="229" width="30" height="35" rx="6" fill="#f5dfac"/>'
    art += '<path d="M334 66q-47-8-38 37l-31 34 19 19 36-33q43 9 37-35l-22 23-22-21z" fill="#709892"/>'
    art += '<circle cx="438" cy="99" r="34" fill="#fffdf8" stroke="#b3cbb5" stroke-width="2"/>'
    art += '<path d="m420 98 12 12 24-27" stroke="#608361" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
    save('scenes', 'maintenance', art, (640, 360))


def build_scenes():
    morning()
    inspection()
    field_report()
    maintenance()
