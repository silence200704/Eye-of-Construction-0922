"""Materialize only registered artwork referenced by the native online App."""

import json
import re
import hashlib
from pathlib import Path

from prepare_probe import ARTWORK, REPO, copy_checked


def prepare():
    project = REPO / 'mobile/openharmony'
    sources = '\n'.join(path.read_text(encoding='utf-8')
                        for path in (project / 'entry/src/main/ets').rglob('*.ets'))
    manifest = json.loads((ARTWORK / 'manifest.json').read_text(encoding='utf-8'))
    output = project / 'entry/src/main/resources/rawfile/design'
    copied = []
    for asset in manifest['assets']:
        svg = f"design/svg/{asset['path']}"
        png = f"design/{asset['png']['path']}"
        if svg in sources:
            copy_checked(asset, output / 'svg' / asset['path'])
            copied.append(svg)
        if png in sources:
            copy_checked(asset['png'], output / asset['png']['path'], ARTWORK.parent)
            copied.append(png)
    playful = project / 'artwork'
    playful_manifest = json.loads((playful / 'manifest.json').read_text(encoding='utf-8'))
    for asset in playful_manifest['assets']:
        path = f"playful/{asset['path']}"
        if path not in sources:
            continue
        data = (playful / asset['path']).read_bytes()
        if hashlib.sha256(data).hexdigest() != asset['sha256']:
            raise ValueError(f'Artwork checksum differs: {path}')
        target = project / 'entry/src/main/resources/rawfile' / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        copied.append(path)
    required = set(re.findall(r"\$rawfile\('([^']+)'\)", sources))
    missing = required - set(copied)
    if missing:
        raise ValueError(f'Native artwork not registered: {sorted(missing)}')
    for asset in playful_manifest['assets']:
        if not asset['path'].startswith('brand/'):
            continue
        for media in [project / 'AppScope/resources/base/media', project / 'entry/src/main/resources/base/media']:
            copy_checked(asset, media / f"playful_{Path(asset['path']).name}", playful)
    print(f'Prepared {len(copied)} verified native online App resources')


if __name__ == '__main__':
    prepare()
