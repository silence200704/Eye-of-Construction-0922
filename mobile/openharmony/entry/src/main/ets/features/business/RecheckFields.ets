import { BusinessDraft } from '../../core/business/BusinessDraft';
import { FormField } from './FormField';
import { AppCard } from '../../shared/components/AppCard';
import { Theme } from '../../shared/theme/Theme';
@Component
export struct RecheckFields {
  @Prop draft: BusinessDraft;
  @Prop locked: boolean = false;
  onField: (key: string, value: string) => void = () => {};
  build() {
    AppCard({ color: Theme.soft }) {
      if (this.draft.kind === 'recheck') {
        FormField({ title: '复查事项', value: this.draft.subject, locked: this.locked, onValue: (v) => this.onField('subject', v) });
        FormField({ title: '复查责任人', value: this.draft.owner, locked: this.locked, onValue: (v) => this.onField('owner', v) });
        FormField({ title: '目标日期 · YYYY-MM-DD', value: this.draft.dueDate, locked: this.locked, onValue: (v) => this.onField('dueDate', v) });
      } else {
        Text('本轮复查结论').fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
        Select([{ value: '确认恢复' }, { value: '继续观察' }, { value: '复发转处置' }])
          .value(this.draft.outcome === 'recovered' ? '确认恢复' : this.draft.outcome === 'observing' ? '继续观察' : '复发转处置')
          .enabled(!this.locked).onSelect((i: number) => this.onField('outcome', ['recovered', 'observing', 'recurred'][i]));
        FormField({ title: '复查依据和结论', value: this.draft.note, multiline: true, locked: this.locked, onValue: (v) => this.onField('note', v) });
        if (this.draft.outcome === 'observing') {
          FormField({ title: '下次复查日期 · YYYY-MM-DD', value: this.draft.nextDueDate, locked: this.locked, onValue: (v) => this.onField('nextDueDate', v) });
        }
      }
    }
  }
}
