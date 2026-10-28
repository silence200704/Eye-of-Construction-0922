import curves from '@ohos.curves';
import { Theme } from '../theme/Theme';

@Component
export struct ActionTile {
  @Prop title: string;
  @Prop caption: string;
  @Prop icon: Resource;
  @Prop color: string = Theme.cream;
  @Prop controlId: string = '';
  @State pressed: boolean = false;
  @StorageLink('zhutong.motion') motion: boolean = true;
  onAction: () => void = () => {};

  build() {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 9 }) {
        Row() {
          Image(this.icon).width(30).height(30).objectFit(ImageFit.Contain).accessibilityLevel('no');
          Blank();
          Image($rawfile('playful/icons/arrow.svg')).width(22).height(22).accessibilityLevel('no');
        }.width('100%');
        Text(this.title).fontSize(19).fontWeight(FontWeight.Bold).fontColor(Theme.text);
        Text(this.caption).fontSize(12).fontColor(Theme.secondary);
      }.alignItems(HorizontalAlign.Start).padding(18).width('100%');
    }.backgroundColor(this.color).width('100%').constraintSize({ minHeight: 138 })
      .border({ width: 1.3, color: '#BBCDC4', radius: 24 }).shadow({ radius: 0, offsetY: 4, color: '#D4DFD2' })
      .scale({ x: this.motion && this.pressed ? 0.96 : 1, y: this.motion && this.pressed ? 0.96 : 1 })
      .animation({ duration: this.motion ? 220 : 0, curve: curves.springMotion(0.35, 0.75) })
      .onTouch((event: TouchEvent) => { this.pressed = event.type === TouchType.Down; })
      .onClick(this.onAction).id(this.controlId);
  }
}
