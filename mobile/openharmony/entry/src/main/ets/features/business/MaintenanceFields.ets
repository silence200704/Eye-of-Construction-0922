import { BusinessDraft } from '../../core/business/BusinessDraft';
import { FormField } from './FormField';
import { AppCard } from '../../shared/components/AppCard';
import { ChecklistForm } from '../tasks/ChecklistForm';
import { ChecklistItem } from '../../data/models/Tasks';
import { PlayButton } from '../../shared/playful/PlayButton';
@Component
export struct MaintenanceFields {
  @Prop draft: BusinessDraft;
  @Prop items: ChecklistItem[] = [];
  @Prop locked: boolean = false;
  onField: (key: string, value: string) => void = () => {};
  onAnswer: (key: string, value: string, note: boolean) => void = () => {};
  build() {
    AppCard() {
      ChecklistForm({ items: this.items, answers: this.draft.answers, locked: this.locked,
        onChoose: (key, value) => this.onAnswer(key, value, false), onNote: (key, value) => this.onAnswer(key, value, true) });
      FormField({ title: '本次保养措施', value: this.draft.measures, multiline: true, locked: this.locked, onValue: (v) => this.onField('measures', v) });
      FormField({ title: '使用材料 · 选填', value: this.draft.materials, locked: this.locked, onValue: (v) => this.onField('materials', v) });
      FormField({ title: '下次保养日期 · YYYY-MM-DD', value: this.draft.nextDueDate, locked: this.locked, onValue: (v) => this.onField('nextDueDate', v) });
      PlayButton({ title: this.draft.createIssue ? '✓ 本次异常转问题' : '有异常，需要转问题', secondary: true, available: !this.locked,
        onAction: () => this.onField('createIssue', this.draft.createIssue ? 'false' : 'true') });
      if (this.draft.createIssue) {
        FormField({ title: '异常说明', value: this.draft.abnormalNote, multiline: true, locked: this.locked, onValue: (v) => this.onField('abnormalNote', v) });
      }
    }
  }
}
