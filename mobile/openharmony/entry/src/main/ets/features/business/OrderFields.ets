import { Identity } from '../../data/models/Identity';
import { BusinessDraft } from '../../core/business/BusinessDraft';
import { AppState } from '../../shared/state/AppState';
import { FormField } from './FormField';
import { PlayButton } from '../../shared/playful/PlayButton';
import { AppCard } from '../../shared/components/AppCard';
import { Theme } from '../../shared/theme/Theme';
@Component
export struct OrderFields {
  @Prop draft: BusinessDraft;
  @Prop state: AppState;
  @Prop locked: boolean = false;
  onField: (key: string, value: string) => void = () => {};
  workers(): Identity[] {
    const order = this.state.workspace.orders.find((row) => row.id === this.draft.targetId);
    const issue = this.state.workspace.issues.find((row) => row.id === order?.issueId);
    const building = this.state.workspace.points.find((row) => row.id === order?.pointId)?.buildingId ?? issue?.buildingId;
    return this.state.identities.filter((row) => ['repair', 'property'].includes(row.role) &&
      (row.buildingIds === null || !!building && row.buildingIds.includes(building)));
  }
  build() {
    AppCard({ color: Theme.cream }) {
      if (this.draft.kind === 'manual') {
        FormField({ title: '维修工单标题', value: this.draft.title, locked: this.locked, onValue: (v) => this.onField('title', v) });
        Text('选择测点；无测点手工单仅限无楼栋范围限制的管理身份。').fontSize(13).fontColor(Theme.secondary);
        Select(this.state.workspace.points.filter((row) => row.status === 'active').map((row): SelectOption => ({ value: row.name })))
          .value(this.state.workspace.points.find((row) => row.id === this.draft.pointId)?.name ?? '选择测点')
          .enabled(!this.locked).onSelect((index: number) => this.onField('pointId', this.state.workspace.points.filter((row) => row.status === 'active')[index].id));
      }
      if (this.draft.action === 'assigned' && this.draft.kind === 'order') {
        Text('把这一单，交给合适的人').fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
        ForEach(this.workers(), (person: Identity) => {
          PlayButton({ title: `${this.draft.assigneeId === person.id ? '✓ ' : ''}${person.name} · ${person.roleLabel}`,
            secondary: this.draft.assigneeId !== person.id, available: !this.locked,
            onAction: () => this.onField('assigneeId', person.id), controlId: `dispatch-${person.id}` });
        });
      }
      if (this.draft.kind === 'manual' || this.draft.action === 'assigned') {
        Row({ space: 8 }) {
          PlayButton({ title: '明天完成', secondary: true, available: !this.locked, onAction: () => this.onField('dueAt', new Date(Date.now() + 32 * 3600000).toISOString().slice(0, 10)) });
          PlayButton({ title: '三天内完成', secondary: true, available: !this.locked, onAction: () => this.onField('dueAt', new Date(Date.now() + 80 * 3600000).toISOString().slice(0, 10)) });
        }
        FormField({ title: '截止日期 · 选填 YYYY-MM-DD，默认18:00', value: this.draft.dueAt,
          locked: this.locked, onValue: (v) => this.onField('dueAt', v) });
      }
      if (this.draft.action === 'submitted') {
        FormField({ title: '维修措施 · 必填', value: this.draft.measures, multiline: true, locked: this.locked, onValue: (v) => this.onField('measures', v) });
        FormField({ title: '材料 · 选填', value: this.draft.materials, locked: this.locked, onValue: (v) => this.onField('materials', v) });
      }
      FormField({ title: ['verified', 'returned'].includes(this.draft.action) ? '验收意见 · 必填，退回请说明返工要求' : '说明 · 物业代接必填',
        value: this.draft.note, multiline: true, locked: this.locked, onValue: (v) => this.onField('note', v) });
      if (this.draft.action === 'verified') {
        Text('验收通过后关联问题进入待复查，问题及预警分别按条件关闭。').fontSize(13).fontColor(Theme.brand);
      }
    }
  }
}
