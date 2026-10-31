import { IssueRecord } from '../../data/models/Reports';
import { AlarmEvent } from '../../data/models/Monitoring';
import { BusinessDraft } from '../../core/business/BusinessDraft';
import { AppState } from '../../shared/state/AppState';
import { AppCard } from '../../shared/components/AppCard';
import { PlayButton } from '../../shared/playful/PlayButton';
import { Theme } from '../../shared/theme/Theme';
import { FormField } from './FormField';
import { reviewActions, ActionChoice } from '../../core/business/BusinessPolicy';

@Component
export struct ReviewFields {
  @Prop draft: BusinessDraft;
  @Prop state: AppState;
  @Prop locked: boolean = false;
  onField: (key: string, value: string) => void = () => {};
  choices(): ActionChoice[] {
    const issue = this.state.workspace.issues.find((row) => row.id === this.draft.targetId);
    return issue ? reviewActions(issue, this.state.user) : [];
  }
  categories(): string[] {
    if (this.draft.action === 'to_repair') return ['equipment', 'general'];
    if (this.draft.action === 'to_investigate') return ['crack', 'tilt', 'structure'];
    if (this.draft.action === 'recheck') return ['unclear', 'remeasure'];
    if (this.draft.action === 'need_evidence') return ['image', 'location', 'description', 'measurement'];
    if (this.draft.action === 'link_object') return ['issue', 'event'];
    return ['no_fault', 'false_alarm', 'reading_stable', 'non_structural', 'handled'];
  }
  names(): string[] {
    if (this.draft.action === 'to_repair') return ['设备故障', '一般维修'];
    if (this.draft.action === 'to_investigate') return ['裂缝排查', '倾斜排查', '结构排查'];
    if (this.draft.action === 'recheck') return ['情况待明', '需要复测'];
    if (this.draft.action === 'need_evidence') return ['补充照片', '补充位置', '补充描述', '补充测量'];
    if (this.draft.action === 'link_object') return ['已有问题', '已有预警'];
    return ['无故障', '误报', '读数稳定', '非结构问题', '已当场处理'];
  }
  build() {
    AppCard({ color: Theme.cream }) {
      Text('选择处理方向').fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      Select(this.choices().map((row): SelectOption => ({ value: row.title }))).value(this.choices().find((row) => row.key === this.draft.action)?.title ?? '')
        .enabled(!this.locked).onSelect((index: number) => { this.onField('action', this.choices()[index].key); });
      Select(this.names().map((value): SelectOption => ({ value }))).value(this.names()[this.categories().indexOf(this.draft.category)] ?? '请选择具体情况')
        .enabled(!this.locked).onSelect((index: number) => this.onField('category', this.categories()[index]));
      if (this.draft.action === 'link_object') {
        if (this.draft.category === 'issue') {
          ForEach(this.state.workspace.issues.filter((row) => row.id !== this.draft.targetId && row.status !== 'closed'), (row: IssueRecord) => {
            PlayButton({ title: `${this.draft.duplicateOf === row.id ? '✓ ' : ''}${row.issueNo} ${row.anomalyType}`, secondary: true,
              available: !this.locked, onAction: () => this.onField('duplicateOf', row.id) });
          });
        } else {
          ForEach(this.state.workspace.events.filter((row) => row.status !== 'closed'), (row: AlarmEvent) => {
            PlayButton({ title: `${this.draft.linkedEventId === row.id ? '✓ ' : ''}${row.eventNo}`, secondary: true,
              available: !this.locked, onAction: () => this.onField('linkedEventId', row.id) });
          });
        }
      }
      FormField({ title: '审核意见 · 说明依据和安排', value: this.draft.note, multiline: true, locked: this.locked, onValue: (v) => this.onField('note', v) });
      if (this.draft.action === 'close_no_fault' && this.draft.category === 'handled') {
        FormField({ title: '无法拍照原因 · 有照片时可留空', value: this.draft.noPhotoReason, multiline: true,
          locked: this.locked, onValue: (v) => this.onField('noPhotoReason', v) });
      }
      Text(this.draft.action === 'to_repair' ? '审核通过后创建待派工工单，再选择维修人派单。' : '服务端将校验权限、对象状态及必要依据。')
        .fontSize(13).fontColor(Theme.secondary);
    }
  }
}
