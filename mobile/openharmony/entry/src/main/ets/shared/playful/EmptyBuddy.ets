import { Theme } from '../theme/Theme';
import { AppCard } from '../components/AppCard';

@Component
export struct EmptyBuddy {
  @Prop title: string = '暂时没有待办，小瞳准备好了';
  @Prop note: string = '这里显示当前身份与范围内的真实任务。';

  build() {
    AppCard({ color: '#FFFCED' }) {
      Column({ space: 12 }) {
        Image($rawfile('playful/scenes/toolbox.svg')).width(196).height(150).objectFit(ImageFit.Contain)
          .accessibilityLevel('no');
        Text(this.title).fontSize(19).fontWeight(FontWeight.Medium).fontColor(Theme.text).textAlign(TextAlign.Center);
        Text(this.note).fontSize(13).fontColor(Theme.secondary).textAlign(TextAlign.Center);
      }.width('100%').padding({ top: 10, bottom: 14 });
    }
  }
}
