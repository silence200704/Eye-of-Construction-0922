import curves from '@ohos.curves';
import { Theme } from '../theme/Theme';

@Component
export struct BottomDock {
  @Prop selected: number = 0;
  @StorageLink('zhutong.motion') motion: boolean = true;
  onSelect: (index: number) => void = () => {};

  @Builder
  item(index: number, title: string, icon: Resource) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 4 }) {
        Image(icon).width(22).height(22).objectFit(ImageFit.Contain).accessibilityLevel('no');
        Text(title).fontSize(12).fontWeight(this.selected === index ? FontWeight.Bold : FontWeight.Regular)
          .fontColor(this.selected === index ? Theme.brand : Theme.secondary);
      }.width('100%').padding({ top: 9, bottom: 9 });
    }.backgroundColor(this.selected === index ? Theme.soft : Color.Transparent).borderRadius(19)
      .layoutWeight(this.selected === index ? 1.35 : 1)
      .animation({ duration: this.motion ? 250 : 0, curve: curves.springMotion(0.35, 0.82) })
      .onClick(() => this.onSelect(index)).id(`tab-${index}`).accessibilityText(title);
  }

  build() {
    Row({ space: 6 }) {
      this.item(0, '工作台', $rawfile('design/svg/icons/monitoring/campus.svg'));
      this.item(1, '监测', $rawfile('design/svg/icons/monitoring/monitor.svg'));
      this.item(2, '任务', $rawfile('design/svg/icons/field/inspection.svg'));
      this.item(3, '我的', $rawfile('design/svg/icons/common/identity.svg'));
    }.padding(7).width('94%').constraintSize({ maxWidth: 620 }).backgroundColor(Theme.surface)
      .border({ width: 1.4, color: Theme.line }).borderRadius(27)
      .shadow({ radius: 16, offsetY: 4, color: '#162D5A46' }).margin({ top: 6, bottom: 10 });
  }
}
