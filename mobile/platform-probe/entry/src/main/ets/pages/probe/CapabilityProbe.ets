import common from '@ohos.app.ability.common';
import http from '@ohos.net.http';
import { CapabilityReport } from './ProbeModels';
import { probeDatabase, probeFile, saveCapabilities } from './StorageProbe';

interface ReadyPayload { status: string; database: string; }
interface ReadyEnvelope { ok: boolean; data: ReadyPayload; }
interface Identity { id: string; role: string; }
interface IdentityEnvelope { ok: boolean; data: Identity[]; }

async function getJson(endpoint: string): Promise<string> {
  const request = http.createHttp();
  try {
    const response = await request.request(endpoint, {
      method: http.RequestMethod.GET, expectDataType: http.HttpDataType.STRING,
      connectTimeout: 5000, readTimeout: 5000, usingCache: false
    });
    if (response.responseCode !== 200) throw new Error(`HTTP ${response.responseCode}`);
    return response.result as string;
  } finally {
    request.destroy();
  }
}

async function probeNetwork(report: CapabilityReport): Promise<void> {
  try {
    const ready = JSON.parse(await getJson(`${report.endpoint}/health/ready`)) as ReadyEnvelope;
    report.checks.push({ name: 'native_http_ready', passed: ready.ok && ready.data.status === 'ready',
      detail: `status=${ready.data.status}; database=${ready.data.database}` });
    const identities = JSON.parse(await getJson(`${report.endpoint}/demo/identities`)) as IdentityEnvelope;
    const roles = identities.data.map((row: Identity) => row.role).sort();
    const expected = ['device', 'inspector', 'property', 'repair', 'safety'];
    const correct = identities.ok && expected.every((role: string) => roles.includes(role));
    report.checks.push({ name: 'identity_directory', passed: correct,
      detail: `${identities.data.length} identities; roles=${roles.join(',')}; GET only, no session created` });
  } catch (cause) {
    report.checks.push({ name: 'native_network', passed: false, detail: (cause as Error).message });
  }
}

export async function runCapabilities(context: common.UIAbilityContext): Promise<CapabilityReport> {
  const report: CapabilityReport = { capturedAt: new Date().toISOString(),
    scope: 'OpenHarmony API20 public SDK probe on a HarmonyOS-branded emulator; not production App acceptance.',
    endpoint: 'http://127.0.0.1:18080/api/v1', previousRun: 0, persistedRun: 0, checks: [] };
  await probeNetwork(report);
  try {
    const runs = await probeDatabase(context);
    report.previousRun = runs[0];
    report.persistedRun = runs[1];
    report.checks.push({ name: 'relational_store_reopen', passed: runs[1] === runs[0] + 1,
      detail: `previous=${runs[0]}; reopened=${runs[1]}; isolated app-private probe table` });
    report.checks.push({ name: 'sandbox_file_roundtrip', passed: probeFile(context.filesDir),
      detail: 'UTF-8 marker written and read back from app-private filesDir' });
  } catch (cause) {
    report.checks.push({ name: 'native_storage', passed: false, detail: (cause as Error).message });
  }
  saveCapabilities(context.filesDir, report);
  return report;
}
