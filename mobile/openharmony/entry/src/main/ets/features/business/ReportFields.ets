import { BusinessDraft } from '../../core/business/BusinessDraft';
import { FormField } from './FormField';
import { AppCard } from '../../shared/components/AppCard';
import { Theme } from '../../shared/theme/Theme';
@Component
export struct ReportFields {
  @Prop draft: BusinessDraft;
  @Prop locked: boolean = false;
  onField: (key: string, value: string) => void = () => {};
  build() {
    AppCard({ color: Theme.cream }) {
      if (this.draft.kind === 'report') {
        FormField({ title: '异常类型', value: this.draft.anomalyType, locked: this.locked, onValue: (v) => this.onField('anomalyType', v) });
        FormField({ title: '现场描述 · 写清位置、现象和观察情况', value: this.draft.description, multiline: true,
          locked: this.locked, onValue: (v) => this.onField('description', v) });
      } else {
        FormField({ title: '按审核要求补充说明 · 至少10字', value: this.draft.note, multiline: true,
          locked: this.locked, onValue: (v) => this.onField('note', v) });
      }
      Text('原始记录与已有照片保留；新内容提交后由服务端确认。').fontSize(13).fontColor(Theme.secondary);
    }
  }
}
