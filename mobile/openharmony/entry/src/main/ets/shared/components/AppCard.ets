import { Theme } from '../theme/Theme';

@Component
export struct AppCard {
  @Prop color: string = Theme.surface;
  @BuilderParam body: () => void;

  build() {
    Column({ space: 12 }) {
      this.body();
    }.alignItems(HorizontalAlign.Start).padding(18).width('100%')
      .backgroundColor(this.color).borderRadius(Theme.radius)
      .border({ width: 1.2, color: Theme.line }).shadow({ radius: 0, offsetY: 4, color: '#DCE6DC' });
  }
}
