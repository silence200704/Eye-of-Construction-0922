"""Copy registered design bytes into the isolated native capability project."""

import hashlib
import json
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
PROJECT = REPO / 'mobile/platform-probe'
ARTWORK = REPO / 'public/design-studio/assets'


def copy_checked(asset, destination, base=ARTWORK):
    source = (base / asset['path']).resolve()
    if not source.is_relative_to(base.resolve()):
        raise ValueError('Artwork source escapes the registered directory')
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != asset['sha256']:
        raise ValueError(f"Artwork checksum differs: {asset['path']}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)


def prepare():
    manifest = json.loads((ARTWORK / 'manifest.json').read_text(encoding='utf-8'))
    output = PROJECT / 'entry/src/main/resources/rawfile/design'
    for asset in manifest['assets']:
        copy_checked(asset, output / 'svg' / asset['path'])
        copy_checked(asset['png'], output / asset['png']['path'], ARTWORK.parent)
    (output / 'manifest.json').write_bytes((ARTWORK / 'manifest.json').read_bytes())
    print(f"Prepared {len(manifest['assets']) * 2} verified native resources in {PROJECT}")


if __name__ == '__main__':
    prepare()
