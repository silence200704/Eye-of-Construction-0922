import { Theme } from '../theme/Theme';
import curves from '@ohos.curves';

@Component
export struct MetricTile {
  @Prop title: string;
  @Prop @Watch('valueChanged') value: string;
  @Prop color: string = '#F0F6DF';
  @Prop note: string = '当前授权范围';
  @StorageLink('zhutong.motion') motion: boolean = true;
  @State bump: number = 1;
  private active: boolean = false;

  aboutToAppear(): void { this.active = true; }
  aboutToDisappear(): void { this.active = false; }

  valueChanged(): void {
    if (!this.motion || this.value === '—') return;
    this.getUIContext().animateTo({ duration: 100, curve: Curve.EaseOut,
      onFinish: () => {
        if (!this.active) return;
        this.getUIContext().animateTo({ duration: this.motion ? 280 : 0,
          curve: curves.springMotion(0.3, 0.72) }, () => { this.bump = 1; });
      } }, () => { this.bump = 1.08; });
  }

  build() {
    Column({ space: 6 }) {
      Text(this.title).fontSize(13).fontWeight(FontWeight.Medium).fontColor(Theme.text);
      Text(this.value).fontSize(36).fontWeight(FontWeight.Bold).fontColor(Theme.brand)
        .scale({ x: this.bump, y: this.bump });
      Text(this.note).fontSize(10).fontColor(Theme.secondary);
    }.alignItems(HorizontalAlign.Start).width('100%').padding(18).backgroundColor(this.color).borderRadius(24)
      .border({ width: 1.2, color: '#CAD7BC' }).shadow({ radius: 0, offsetY: 4, color: '#DBE1CF' });
  }
}
