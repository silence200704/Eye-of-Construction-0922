import { controlHeight } from '../../shared/layout/ReadingLayout';
import { ChecklistItem, ChecklistAnswer } from '../../data/models/Tasks';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';

@Component
export struct ChecklistForm {
  @StorageProp('zhutong.fontScale') textScale: number = 1;
  @Prop items: ChecklistItem[];
  @Prop answers: ChecklistAnswer[];
  @Prop locked: boolean = false;
  onChoose: (key: string, value: string) => void = () => {};
  onNote: (key: string, value: string) => void = () => {};

  @Builder
  choice(item: ChecklistItem) {
    Row({ space: 8 }) {
      Button('正常').height(controlHeight(48, this.textScale)).layoutWeight(1)
        .backgroundColor(this.answers.find((row) => row.key === item.key)?.result === 'ok' ? Theme.brand : Theme.pale)
        .fontColor(this.answers.find((row) => row.key === item.key)?.result === 'ok' ? Color.White : Theme.brand)
        .enabled(!this.locked).onClick(() => this.onChoose(item.key, 'ok')).id(`answer-${item.key}-ok`);
      Button('异常').height(controlHeight(48, this.textScale)).layoutWeight(1)
        .backgroundColor(this.answers.find((row) => row.key === item.key)?.result === 'abnormal' ? Theme.danger : Theme.peach)
        .fontColor(this.answers.find((row) => row.key === item.key)?.result === 'abnormal' ? Color.White : Theme.danger)
        .enabled(!this.locked).onClick(() => this.onChoose(item.key, 'abnormal')).id(`answer-${item.key}-abnormal`);
    }.width('100%');
  }

  build() {
    Column({ space: 16 }) {
      Text('② 一项一项，认真查看').fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      Text('按任务生成时的清单填写；未作答的必填项不能提交。').fontSize(12).fontColor(Theme.secondary);
      ForEach(this.items, (item: ChecklistItem) => {
        AppCard({ color: '#FFFBE9' }) {
          Text(`${item.required ? '必答 · ' : '选答 · '}${item.label}`).fontSize(17).fontWeight(FontWeight.Medium).fontColor(Theme.text);
          if (item.hint) { Text(item.hint).fontSize(12).fontColor(Theme.secondary); }
          this.choice(item);
          TextArea({ text: this.answers.find((row) => row.key === item.key)?.note ?? '', placeholder: '补充现场观察（可选）' })
            .height(controlHeight(80, this.textScale)).fontSize(14).enabled(!this.locked).backgroundColor(Theme.surface)
            .onChange((value: string) => this.onNote(item.key, value)).id(`answer-${item.key}-note`);
        }
      }, (item: ChecklistItem) => item.key);
    }.width('100%').alignItems(HorizontalAlign.Start);
  }
}
