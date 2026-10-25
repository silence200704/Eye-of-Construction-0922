"""Validate resource integrity and design-source structure without native SDK claims."""
import ast
import hashlib
import json
import struct
import subprocess
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

BASE = Path(__file__).resolve().parents[2]
STUDIO = BASE / 'public/design-studio'
EVIDENCE = BASE / 'docs/implementation/evidence/stage7a-design-studio'


def validate_assets():
    data = json.loads((STUDIO / 'assets/manifest.json').read_text(encoding='utf-8'))
    assert len(data['assets']) == 52
    total = 0
    for item in data['assets']:
        path = STUDIO / 'assets' / item['path']
        raw = path.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == item['sha256']
        svg = ET.fromstring(raw)
        for node in svg.iter():
            assert node.tag.rsplit('}', 1)[-1] not in {'script', 'foreignObject'}
            assert not any('href' in key for key in node.attrib), path
        png = STUDIO / item['png']['path']
        image = png.read_bytes()
        assert image[:8] == b'\x89PNG\r\n\x1a\n'
        assert struct.unpack('>II', image[16:24]) == (item['width'], item['height'])
        assert hashlib.sha256(image).hexdigest() == item['png']['sha256']
        total += len(raw) + len(image)
    return {'svg': len(data['assets']), 'png': len(data['assets']), 'totalAssetBytes': total,
            'externalAssetReferences': 0, 'hashesAndPngDimensions': 'passed'}


def validate_bundle():
    path = STUDIO / 'downloads/zhutong-artwork-v1.zip'
    with zipfile.ZipFile(path) as bundle:
        names = bundle.namelist()
        assert len(names) == 107
        assert all(not name.startswith('/') and '..' not in Path(name).parts for name in names)
        for name in names:
            assert bundle.read(name) == (STUDIO / name).read_bytes(), name
    return {'entries': len(names), 'bytes': path.stat().st_size,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'result': 'passed'}


def validate_sources():
    files = [p for folder in [BASE / 'scripts/design', STUDIO] for p in folder.rglob('*')
             if p.suffix in {'.py', '.js', '.mjs', '.css', '.html'}]
    for path in files:
        code = path.read_text(encoding='utf-8-sig')
        assert len(code.splitlines()) <= 450, path
        if path.suffix == '.py':
            tree = ast.parse(code)
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    assert node.end_lineno - node.lineno + 1 <= 80, (path, node.name)
                    assert len(node.args.args) <= 5, (path, node.name)
        if path.suffix in {'.js', '.mjs'}:
            subprocess.run(['node', '--check', str(path)], check=True, capture_output=True)
    for root in [BASE / 'scripts/design', STUDIO]:
        for directory in [root, *[p for p in root.rglob('*') if p.is_dir()]]:
            if '__pycache__' in directory.parts:
                continue
            assert len([p for p in directory.iterdir() if p.is_file()]) <= 8, directory
    return {'files': len(files), 'fileLimit': 450, 'pythonFunctionLimit': 80,
            'pythonParameterLimit': 5, 'directoryFileLimit': 8, 'result': 'passed'}


if __name__ == '__main__':
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    result = {'assets': validate_assets(), 'bundle': validate_bundle(), 'sourceStructure': validate_sources(),
              'nativeSdkCompatibility': 'not_verified; stage8 prerequisite'}
    (EVIDENCE / 'assets-check.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))
