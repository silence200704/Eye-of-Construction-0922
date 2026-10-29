import curves from '@ohos.curves';
import { Theme } from '../theme/Theme';

@Component
export struct PlayButton {
  @Prop title: string;
  @Prop secondary: boolean = false;
  @Prop available: boolean = true;
  @Prop controlId: string = '';
  @StorageLink('zhutong.motion') motion: boolean = true;
  @State pressed: boolean = false;
  onAction: () => void = () => {};

  build() {
    Button({ type: ButtonType.Normal }) {
      Text(this.title).fontSize(16).fontWeight(FontWeight.Medium).width('100%').textAlign(TextAlign.Center)
        .fontColor(this.secondary ? Theme.brand : Color.White);
    }.width('100%').constraintSize({ minHeight: 50 }).padding({ left: 16, right: 16, top: 13, bottom: 13 })
      .backgroundColor(this.secondary ? Theme.pale : Theme.brand)
      .border({ width: 1.3, color: this.secondary ? '#B4CEC6' : Theme.ink, radius: 18 })
      .shadow({ radius: 0, offsetY: this.pressed ? 1 : 4, color: this.secondary ? '#C8DCD3' : '#164E59' })
      .scale({ x: this.motion && this.pressed ? 0.97 : 1, y: this.motion && this.pressed ? 0.97 : 1 })
      .translate({ y: this.motion && this.pressed ? 2 : 0 })
      .animation({ duration: this.motion ? 180 : 0, curve: curves.springMotion(0.3, 0.8) })
      .enabled(this.available).opacity(this.available ? 1 : 0.5).id(this.controlId)
      .onTouch((event: TouchEvent) => { this.pressed = event.type === TouchType.Down; })
      .onClick(this.onAction).accessibilityText(this.title);
  }
}
