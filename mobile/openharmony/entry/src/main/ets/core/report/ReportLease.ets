import { TaskAccess } from '../field/TaskCommander';
import { Identity } from '../../data/models/Identity';
import { ArchiveSnapshot } from '../../data/models/Workspace';
import { ReportTarget } from '../../data/models/Reports';
import { authorizationOf } from '../identity/authorization';
import { ApiError } from '../network/ApiError';

export function reportStamp(access: TaskAccess): string {
  return `${access.baseUrl}|${access.workspace.epoch}|${authorizationOf(access.user)}`;
}

export class ReportLease {
  access: TaskAccess;
  private stamp: string;
  private read: () => TaskAccess | null;

  constructor(access: TaskAccess, read: () => TaskAccess | null) {
    this.access = access; this.stamp = reportStamp(access); this.read = read;
  }

  current(): boolean {
    const latest = this.read();
    return latest !== null && latest.client === this.access.client && reportStamp(latest) === this.stamp;
  }

  async authorize(target: ReportTarget): Promise<void> {
    if (!this.current()) throw new ApiError('CANCELLED', '当前上报已失效。');
    const principal = await this.access.client.send<Identity>('/auth/me');
    if (!this.current() || authorizationOf(principal.data) !== authorizationOf(this.access.user)) {
      throw new ApiError('AUTHORIZATION_CHANGED', '身份授权已变化，请重新读取。');
    }
    const archive = await this.access.client.send<ArchiveSnapshot>('/datasets/demo-main/archive');
    if (!this.current()) throw new ApiError('CANCELLED', '当前上报已失效。');
    if (archive.meta?.datasetEpoch !== this.access.workspace.epoch) throw new ApiError('EPOCH_CHANGED', '数据已复位，请重新读取。');
    const point = archive.data.points.find((row) => row.id === target.pointId && row.status === 'active');
    const building = archive.data.buildings.find((row) => row.id === target.buildingId && row.status === 'active');
    if (!building || (target.pointId && (!point || point.buildingId !== target.buildingId))) {
      throw new ApiError('AUTHORIZATION_CHANGED', '上报位置已归档或不在当前范围内。');
    }
  }
}
