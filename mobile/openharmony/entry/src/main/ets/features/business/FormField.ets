import { Theme } from '../../shared/theme/Theme';
import { controlHeight } from '../../shared/layout/ReadingLayout';
@Component
export struct FormField {
  @Prop title: string = '';
  @Prop value: string = '';
  @Prop multiline: boolean = false;
  @Prop locked: boolean = false;
  @StorageProp('zhutong.fontScale') textScale: number = 1;
  onValue: (value: string) => void = () => {};
  build() {
    Column({ space: 7 }) {
      Text(this.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor(Theme.text);
      if (this.multiline) {
        TextArea({ text: this.value, placeholder: this.title }).height(controlHeight(110, this.textScale)).maxLength(4000)
          .fontSize(16).backgroundColor(Theme.surface).enabled(!this.locked).onChange(this.onValue);
      } else {
        TextInput({ text: this.value, placeholder: this.title }).height(controlHeight(52, this.textScale)).maxLength(300)
          .fontSize(16).backgroundColor(Theme.surface).enabled(!this.locked).onChange(this.onValue);
      }
    }.width('100%').alignItems(HorizontalAlign.Start);
  }
}
