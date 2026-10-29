import { DraftPreview } from '../../core/report/ReportView';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';

@Component
export struct HandlingFields {
  @Prop draft: DraftPreview;
  @Prop locked: boolean = false;
  onField: (key: string, value: string) => void = () => {};

  build() {
    AppCard({ color: Theme.cream }) {
      if (this.draft.target.issueId) {
        Text('原始记录，完整保留').fontSize(18).fontWeight(FontWeight.Bold).fontColor(Theme.text);
        Text(this.draft.description).fontSize(14).fontColor(Theme.secondary);
        Text('补充说明 · 至少10字').fontSize(17).fontWeight(FontWeight.Bold).fontColor(Theme.text);
        TextArea({ text: this.draft.note, placeholder: '补充位置、观察或测量信息；不修改原始描述' })
          .height(145).fontSize(15).maxLength(4000).enabled(!this.locked).backgroundColor(Theme.surface)
          .onChange((value: string) => this.onField('note', value)).id('supplement-note');
        if (this.draft.target.requirePhoto) {
          Text('本次审核要求新照片，请在下方选择；已有照片会保留。').fontSize(13).fontColor(Theme.warning);
        }
      } else {
        if (this.draft.target.action === 'submitted') {
          Text('这次做了哪些维修？').fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
          TextArea({ text: this.draft.measures, placeholder: '维修措施（必填），如更换固定件并复紧检查' })
            .height(140).fontSize(15).maxLength(4000).enabled(!this.locked).backgroundColor(Theme.surface)
            .onChange((value: string) => this.onField('measures', value)).id('handling-measures');
          TextInput({ text: this.draft.materials, placeholder: '使用材料（可选）' })
            .height(54).fontSize(15).maxLength(2000).enabled(!this.locked).backgroundColor(Theme.surface)
            .onChange((value: string) => this.onField('materials', value)).id('handling-materials');
        }
        Text(this.draft.target.requireNote ? '物业代接原因 · 必填' : '办理说明 · 可选').fontSize(16).fontColor(Theme.text);
        TextArea({ text: this.draft.note, placeholder: this.draft.target.requireNote ? '请说明为何代接，不会改写原指定维修人' : '可补充现场情况或交接提醒' })
          .height(100).fontSize(15).maxLength(4000).enabled(!this.locked).backgroundColor(Theme.surface)
          .onChange((value: string) => this.onField('note', value)).id('handling-note');
      }
    }
  }
}
