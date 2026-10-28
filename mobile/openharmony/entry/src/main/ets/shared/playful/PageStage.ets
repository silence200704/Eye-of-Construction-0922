import { Theme } from '../theme/Theme';

@Component
export struct PageStage {
  @BuilderParam body: () => void;

  build() {
    Stack({ alignContent: Alignment.Top }) {
      Image($rawfile('playful/patterns/dots.svg')).width('100%').height('100%')
        .objectFit(ImageFit.Cover).opacity(0.42).accessibilityLevel('no');
      Scroll() {
        Column({ space: 18 }) {
          this.body();
        }.alignItems(HorizontalAlign.Start).padding({ top: 20, left: 18, right: 18, bottom: 28 })
          .width('100%').constraintSize({ maxWidth: 840 });
      }.width('100%').height('100%').align(Alignment.Top).scrollBar(BarState.Off);
    }.width('100%').height('100%').backgroundColor(Theme.canvas);
  }
}
