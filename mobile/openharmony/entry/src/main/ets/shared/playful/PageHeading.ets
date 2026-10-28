import { Theme } from '../theme/Theme';

@Component
export struct PageHeading {
  @Prop title: string;
  @Prop subtitle: string = '';
  @Prop kicker: string = '筑瞳 · 校园守护';

  build() {
    Row({ space: 14 }) {
      Column({ space: 7 }) {
        Text(this.kicker).fontSize(12).fontWeight(FontWeight.Medium).fontColor(Theme.brand).letterSpacing(1);
        Text(this.title).fontSize(26).fontWeight(FontWeight.Bold).fontColor(Theme.text);
        if (this.subtitle) { Text(this.subtitle).fontSize(13).fontColor(Theme.secondary); }
      }.alignItems(HorizontalAlign.Start).layoutWeight(1);
      Image($rawfile('playful/icons/spark.svg')).width(32).height(32).padding(10)
        .backgroundColor(Theme.cream).borderRadius(18).rotate({ angle: 9 }).accessibilityLevel('no');
    }.width('100%').padding({ bottom: 4 });
  }
}
