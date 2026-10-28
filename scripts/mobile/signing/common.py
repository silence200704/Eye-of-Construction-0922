"""Sign registered development Apps with public OpenHarmony SDK fixtures only."""

import argparse
from dataclasses import dataclass
import hashlib
import json
import re
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class SigningProject:
    directory: Path
    output: Path
    bundle_id: str


def execute(arguments):
    result = subprocess.run([str(value) for value in arguments], capture_output=True,
                            text=True, encoding='utf-8', errors='replace', timeout=60)
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result.stdout + result.stderr


def prepare_profile(options, project):
    app = json.loads((project.directory / 'AppScope/app.json5').read_text(encoding='utf-8'))['app']
    if app['bundleName'] != project.bundle_id:
        raise ValueError('Bundle does not match this development signing target')
    hdc = options.studio / 'sdk/default/openharmony/toolchains/hdc.exe'
    response = execute([hdc, '-t', options.target, 'shell', 'bm', 'get', '-u'])
    identifiers = re.findall(r'(?<![A-Za-z0-9])[A-Fa-f0-9]{64}(?![A-Za-z0-9])', response)
    if len(identifiers) != 1:
        raise ValueError('Target must return exactly one emulator UDID')
    lib = options.sdk / '20/toolchains/lib'
    profile = json.loads((lib / 'UnsgnedDebugProfileTemplate.json').read_text(encoding='utf-8'))
    profile['uuid'] = str(uuid.uuid4())
    now = int(time.time())
    profile['validity'] = {'not-before': now - 300, 'not-after': now + 30 * 24 * 3600}
    profile['bundle-info']['bundle-name'] = app['bundleName']
    profile['debug-info']['device-ids'] = identifiers
    profile['acls']['allowed-acls'] = []
    profile['permissions']['restricted-permissions'] = []
    project.output.mkdir(parents=True, exist_ok=True)
    (project.output / 'debug-profile.json').write_text(json.dumps(profile), encoding='utf-8')
    certificates = re.findall(r'-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----',
                             (lib / 'OpenHarmonyProfileDebug.pem').read_text(encoding='utf-8'))
    if len(certificates) != 3:
        raise ValueError('Unexpected SDK fixture certificate chain; inspect before signing')
    chain = '\n'.join([*certificates[:2], profile['bundle-info']['development-certificate']])
    (project.output / 'application-chain.pem').write_text(chain, encoding='utf-8')
    return profile


def sign(options, project):
    profile = prepare_profile(options, project)
    lib = options.sdk / '20/toolchains/lib'
    tool = [options.studio / 'jbr/bin/java.exe', '-jar', lib / 'hap-sign-tool.jar']
    # These are SDK-distributed public development fixture credentials, not user secrets.
    credentials = ['-keystoreFile', lib / 'OpenHarmony.p12', '-keyPwd', '123456',
                   '-keystorePwd', '123456', '-signAlg', 'SHA256withECDSA', '-mode', 'localSign']
    logs = [execute([*tool, 'sign-profile', *credentials,
                     '-keyAlias', 'openharmony application profile debug',
                     '-profileCertFile', lib / 'OpenHarmonyProfileDebug.pem',
                     '-inFile', project.output / 'debug-profile.json', '-outFile', project.output / 'debug-profile.p7b'])]
    hap = project.directory / 'entry/build/default/outputs/default/entry-default-unsigned.hap'
    signed = project.output / 'entry-default-debug-signed.hap'
    logs.append(execute([*tool, 'sign-app', *credentials,
                         '-keyAlias', 'openharmony application release',
                         '-appCertFile', project.output / 'application-chain.pem',
                         '-profileFile', project.output / 'debug-profile.p7b', '-inFile', hap,
                         '-outFile', signed, '-compatibleVersion', '20']))
    logs.append(execute([*tool, 'verify-app', '-inFile', signed,
                         '-outCertChain', project.output / 'verified-chain.cer',
                         '-outProfile', project.output / 'verified-profile.p7b']))
    if 'verify-app success' not in logs[-1]:
        raise RuntimeError('Signer did not report successful verification')
    (project.output / 'signing.log').write_text('\n'.join(logs), encoding='utf-8')
    record = {'capturedAt': datetime.now(timezone.utc).isoformat(),
              'bundleName': profile['bundle-info']['bundle-name'], 'profileType': 'debug',
              'fixtureSource': 'Public SDK OpenHarmony.p12; NOT production signing identity',
              'profileExpiresAt': datetime.fromtimestamp(profile['validity']['not-after'], timezone.utc).isoformat(),
              'deviceIdOmittedFromThisRecord': True, 'deviceBindingCount': 1, 'elevatedAcls': [],
              'codeSigning': True, 'verified': True, 'install': 'not_run_by_this_script',
              'unsignedSha256': hashlib.sha256(hap.read_bytes()).hexdigest(),
              'signedSha256': hashlib.sha256(signed.read_bytes()).hexdigest(), 'signedBytes': signed.stat().st_size}
    (project.output / 'signing-result.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
    print(json.dumps(record, indent=2))


def parse_options():
    parser = argparse.ArgumentParser(description='Local debug signing with public SDK development fixtures only')
    parser.add_argument('--studio', type=Path, required=True)
    parser.add_argument('--sdk', type=Path, required=True)
    parser.add_argument('--target', required=True)
    return parser.parse_args()
