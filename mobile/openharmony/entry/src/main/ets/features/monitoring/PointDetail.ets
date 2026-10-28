import { Point, Device, MonitorRecord } from '../../data/models/Monitoring';
import { AppState } from '../../shared/state/AppState';
import { ReportTarget } from '../../data/models/Reports';
import { PlayButton } from '../../shared/playful/PlayButton';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';
import { PageStage } from '../../shared/playful/PageStage';
import { latestRecord, reading, label, timeText, pointLocation, freshness } from '../../shared/format/display';

@Component
export struct PointDetail {
  @Prop state: AppState;
  @Prop pointId: string;
  onReport: (target: ReportTarget) => void = () => {};

  point(): Point | undefined {
    return this.state.workspace.points.find((point) => point.id === this.pointId && point.status === 'active');
  }

  records(): MonitorRecord[] {
    return this.state.workspace.records.filter((record) => record.pointId === this.pointId)
      .sort((left, right) => Date.parse(right.sampleTime) - Date.parse(left.sampleTime)).slice(0, 5);
  }

  @Builder
  current() {
    AppCard({ color: '#E5F2E9' }) {
      Text(this.point()?.name ?? '').fontSize(25).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      Text(this.point()?.code ?? '').fontSize(14).fontColor(Theme.brand);
      Text(reading(latestRecord(this.state.workspace, this.pointId), this.point()?.type ?? ''))
        .fontSize(25).fontColor(Theme.text);
      Text(freshness(latestRecord(this.state.workspace, this.pointId))).fontSize(14).fontColor(Theme.warning);
      Text('比赛演示 · 硬件输入模拟').fontSize(13).fontColor(Theme.brand);
    }
  }

  @Builder
  devices() {
    AppCard() {
      Text('设备台账').fontSize(19).fontWeight(FontWeight.Medium).fontColor(Theme.text);
      ForEach(this.state.workspace.devices.filter((device) => device.pointId === this.pointId && device.status === 'active'),
        (device: Device) => {
          Text(`${device.name} · ${label(device.health || 'unknown')}`).fontSize(14).fontColor(Theme.text);
        }, (device: Device) => device.id);
      Text('电量与最近设备上报时间：当前服务未提供，暂显示未知。').fontSize(13).fontColor(Theme.secondary);
    }
  }

  @Builder
  recordCard(record: MonitorRecord) {
    AppCard() {
      Text(record.recordNo).fontSize(16).fontWeight(FontWeight.Medium).fontColor(Theme.text);
      Text(reading(record, this.point()?.type ?? '')).fontSize(19).fontColor(Theme.brand);
      Text(`采样 ${timeText(record.sampleTime)}`).fontSize(13).fontColor(Theme.secondary);
      Text(`${label(record.source)} · ${label(record.quality)}${record.isBackfill ? ' · 历史补录' : ''}`)
        .fontSize(13).fontColor(record.quality === 'valid' ? Theme.secondary : Theme.danger);
      Text(record.assessment ? label(record.assessment.state) : '尚无服务端判定')
        .fontSize(14).fontColor(Theme.text);
      Text(`规则版本 ${record.ruleVersion ?? '未提供'}`).fontSize(12).fontColor(Theme.secondary);
    }
  }

  build() {
    PageStage() {
        if (this.state.mode === 'ready' && this.point()) {
          this.current();
          PlayButton({ title: '记录这个测点的现场发现', secondary: true, controlId: 'point-report', onAction: () => this.onReport({
            pointId: this.pointId, buildingId: this.point()!.buildingId, floorId: this.point()!.floorId, taskId: '', expectedRev: 0 }) });
          this.devices();
          Text('最近载入记录').fontSize(22).fontWeight(FontWeight.Medium).fontColor(Theme.text);
          ForEach(this.records(), (record: MonitorRecord) => { this.recordCard(record); }, (record: MonitorRecord) => record.id);
          if (this.records().length === 0) {
            Text('暂无记录，不判为正常。').fontSize(16).fontColor(Theme.secondary);
          }
        } else {
          AppCard() {
            Text('测点当前不可查看').fontSize(20).fontColor(Theme.text);
            Text('连接、身份或档案已变化，请返回重新读取。').fontSize(14).fontColor(Theme.secondary);
          }
        }
    }
  }
}
