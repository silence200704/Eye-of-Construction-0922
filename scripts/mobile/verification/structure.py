"""Check native helper scale and validate original artwork without changing files."""

import ast
import hashlib
import json
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def check_python():
    violations, sizes = [], []
    for path in (ROOT / 'scripts/mobile').rglob('*.py'):
        source = path.read_text(encoding='utf-8')
        name = path.relative_to(ROOT).as_posix()
        size = len(source.splitlines())
        sizes.append({'path': name, 'lines': size})
        if size > 450:
            violations.append({'path': name, 'fileLines': size})
        for node in ast.walk(ast.parse(source)):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            lines = node.end_lineno - node.lineno + 1
            arguments = len(node.args.args) + len(node.args.posonlyargs) + len(node.args.kwonlyargs)
            if node.args.vararg:
                arguments += 1
            if node.args.kwarg:
                arguments += 1
            if lines > 80 or arguments > 5:
                violations.append({'path': name, 'function': node.name, 'lines': lines, 'parameters': arguments})
    return {'files': sizes, 'violations': violations}


def check_artwork():
    directory = ROOT / 'mobile/openharmony/artwork'
    manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
    for asset in manifest['assets']:
        data = (directory / asset['path']).read_bytes()
        assert hashlib.sha256(data).hexdigest() == asset['sha256'], asset['path']
        assert len(data) == asset['bytes'], asset['path']
        tree = ET.fromstring(data)
        for node in tree.iter():
            for key, value in node.attrib.items():
                if key.endswith('href'):
                    assert value.startswith('#'), f'External asset: {asset["path"]}'
        assert b'<script' not in data and b'@import' not in data
    return {'registered': len(manifest['assets']), 'allHashesVerified': True,
            'allXmlParsed': True, 'externalArtworkReferences': 0, 'aiAssisted': True}


def run():
    result = {'python': check_python(), 'artwork': check_artwork()}
    output = ROOT / 'docs/implementation/evidence/stage8-playful/builds/structure-assets.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))
    if result['python']['violations']:
        raise SystemExit(1)


if __name__ == '__main__':
    run()
