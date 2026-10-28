import { CheckDraft } from '../../core/field/CheckDraft';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';

@Component
export struct CheckInForm {
  @Prop draft: CheckDraft;
  @Prop expectedLabel: string = '';
  @Prop locked: boolean = false;
  onField: (key: string, value: string) => void = () => {};

  build() {
    AppCard({ color: '#EAF4E8' }) {
      Text('① 先核对到点').fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      Text('模拟NFC不代表真实读卡或实际到场；人工签到必须说明原因。')
        .fontSize(12).fontColor(Theme.secondary);
      Row({ space: 8 }) {
        Button('模拟 NFC').height(48).backgroundColor(this.draft.method === 'nfc' ? Theme.brand : Theme.surface)
          .fontColor(this.draft.method === 'nfc' ? Color.White : Theme.brand).enabled(!this.locked)
          .onClick(() => this.onField('method', 'nfc')).id('arrival-nfc');
        Button('人工签到').height(48).backgroundColor(this.draft.method === 'manual' ? Theme.brand : Theme.surface)
          .fontColor(this.draft.method === 'manual' ? Color.White : Theme.brand).enabled(!this.locked)
          .onClick(() => this.onField('method', 'manual')).id('arrival-manual');
      }.width('100%');
      Text('本次核对的标签编号').fontSize(13).fontColor(Theme.text);
      TextInput({ text: this.draft.labelRead, placeholder: '输入读到的编号，不自动判定一致' }).height(52)
        .backgroundColor(Theme.surface).enabled(!this.locked)
        .onChange((value: string) => this.onField('labelRead', value)).id('arrival-label');
      Button('填入档案编号（模拟）').height(48).fontColor(Theme.brand).backgroundColor(Theme.cream)
        .enabled(!this.locked && this.expectedLabel !== '').onClick(() => this.onField('labelRead', this.expectedLabel))
        .id('arrival-use-label');
      if (!this.expectedLabel) {
        Text('该测点尚未登记标签，请先在Web档案中核对配置。').fontSize(12).fontColor(Theme.warning);
      }
      if (this.draft.method === 'manual') {
        TextArea({ text: this.draft.fallbackReason, placeholder: '说明读卡失败、标签损坏等人工核对原因' })
          .height(92).fontSize(14).backgroundColor(Theme.surface).enabled(!this.locked)
          .onChange((value: string) => this.onField('fallbackReason', value)).id('arrival-reason');
      }
    }
  }
}
