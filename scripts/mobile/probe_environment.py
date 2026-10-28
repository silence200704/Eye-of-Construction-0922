"""Read local native tool metadata; never install, sign or download anything."""
import argparse
import json
import subprocess
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig')) if path.is_file() else {}


def version_command(args):
    result = subprocess.run(args, capture_output=True, text=True, errors='replace', timeout=15)
    return {'command': [str(arg) for arg in args], 'exitCode': result.returncode,
            'output': (result.stdout + result.stderr).strip()}


def probe_device(studio_root, target):
    hdc = studio_root / 'sdk/default/openharmony/toolchains/hdc.exe'
    keys = ['const.ohos.apiversion', 'const.ohos.fullname',
            'const.product.model', 'const.product.software.version']
    readings = {key: version_command([hdc, '-t', target, 'shell', 'param', 'get', key])
                for key in keys}
    return {'target': target, 'readings': readings,
            'readOnlyParamQueriesPassed': all(row['exitCode'] == 0 for row in readings.values()),
            'scope': 'Runtime system properties only; does not install or start an app.'}


def probe(options):
    root = options.studio_root.resolve()
    product = read_json(root / 'product-info.json')
    sdk_root = root / 'sdk/default'
    sdk = read_json(sdk_root / 'sdk-pkg.json').get('data', {})
    components = {}
    for name in ['ets', 'js', 'native', 'previewer', 'toolchains']:
        raw = read_json(sdk_root / 'openharmony' / name / 'oh-uni-package.json')
        components[name] = {key: raw.get(key) for key in ['apiVersion', 'version', 'releaseType']}
    packages = {}
    for name, path in {'ohpm': 'tools/ohpm/package.json',
                       'hvigor': 'tools/hvigor/hvigor/package.json',
                       'hvigorPlugin': 'tools/hvigor/hvigor-ohos-plugin/package.json'}.items():
        raw = read_json(root / path)
        packages[name] = {'name': raw.get('name'), 'version': raw.get('version')}
    node = root / 'tools/node/node.exe'
    commands = [version_command([node, '--version']),
                version_command([node, root / 'tools/ohpm/bin/pm-cli.js', '--version']),
                version_command([sdk_root / 'openharmony/toolchains/hdc.exe', '-v']),
                version_command([root / 'jbr/bin/java.exe', '-version'])]
    emulator = options.emulator_root.resolve()
    return {'capturedAt': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),
            'studio': {'path': str(root), 'name': product.get('name'),
                       'version': product.get('version'), 'build': product.get('buildNumber')},
            'bundledSdk': sdk, 'commonComponents': components, 'packageMetadata': packages,
            'versionCommands': commands,
            'configuredEmulatorDirectory': {'path': str(emulator), 'exists': emulator.is_dir(),
              'entries': [p.name for p in emulator.iterdir()] if emulator.is_dir() else []},
            'scope': 'Metadata and version commands only; no device discovery daemon, download, license acceptance or system PATH edits.',
            'readiness': {'toolVersions': all(row['exitCode'] == 0 for row in commands),
                         'nativeBuild': 'not_run', 'signingAndInstall': 'not_run',
                         'targetOpenHarmonySdkAndDeviceCompatibility': 'not_verified',
                         'currentSdkProduct': 'HarmonyOS SDK with common OpenHarmony component directory; not proof of target OpenHarmony compatibility'}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--studio-root', type=Path, required=True)
    parser.add_argument('--emulator-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--target', help='Explicit HDC target for optional read-only runtime queries')
    args = parser.parse_args()
    result = probe(args)
    if args.target:
        result['device'] = probe_device(args.studio_root.resolve(), args.target)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'studio': result['studio'], 'sdk': result['bundledSdk'],
                      'readiness': result['readiness']}, ensure_ascii=False, indent=2))
