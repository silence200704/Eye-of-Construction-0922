import curves from '@ohos.curves';

@Component
export struct Mascot {
  @Prop art: Resource = $rawfile('playful/characters/xiaotong.png');
  @Prop dimension: number = 132;
  @Prop interactive: boolean = false;
  @Prop floating: boolean = false;
  @StorageLink('zhutong.motion') motion: boolean = true;
  @State lift: boolean = false;
  @State greeting: boolean = false;
  onGreet: () => void = () => {};

  @Builder
  picture() {
    Image(this.art).width(this.dimension).height(this.dimension * 1.05).objectFit(ImageFit.Contain)
      .translate({ y: this.motion && this.floating && this.lift ? -5 : 0 })
      .animation({ duration: this.motion && this.floating ? 2400 : 0,
        iterations: this.motion && this.floating ? -1 : 1, playMode: PlayMode.Alternate, curve: Curve.EaseInOut })
      .rotate({ angle: this.motion && this.greeting ? 8 : -3 })
      .animation({ duration: this.motion ? 320 : 0, curve: curves.springMotion(0.45, 0.68) })
      .onAppear(() => { this.lift = true; }).accessibilityLevel('no');
  }

  build() {
    if (this.interactive) {
      Button({ type: ButtonType.Normal }) { this.picture(); }
        .backgroundColor(Color.Transparent).padding(0).borderRadius(30)
        .onClick(() => { this.greeting = !this.greeting; this.onGreet(); })
        .accessibilityText('向小瞳打个招呼，展开操作提示').id('greet-mascot');
    } else {
      this.picture();
    }
  }
}
