import { Theme } from '../theme/Theme';
import { Mascot } from './Mascot';

@Component
export struct StoryHero {
  @Prop role: string = '';
  @State tips: boolean = false;
  @StorageLink('zhutong.motion') motion: boolean = true;
  onExplore: () => void = () => {};

  toggleTips(): void {
    this.getUIContext().animateTo({ duration: this.motion ? 180 : 0, curve: Curve.EaseOut },
      () => { this.tips = !this.tips; });
  }

  @Builder
  guide() {
    Column({ space: 9 }) {
      Text('嗨！今天先看哪里？').fontSize(16).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      Text('监测小站能查看读数与历史预警；现场任务查看检查和维修进度。')
        .fontSize(12).fontColor(Theme.secondary);
      Row({ space: 10 }) {
        Button('带我去监测').height(48).fontSize(14).backgroundColor(Theme.brand).fontColor(Color.White)
          .layoutWeight(1).onClick(() => { this.tips = false; this.onExplore(); }).id('guide-monitor');
        Button('先收好').height(48).fontSize(14).backgroundColor('#F8FFEB').fontColor(Theme.brand)
          .layoutWeight(1).onClick(() => this.toggleTips()).id('guide-dismiss');
      }.width('100%');
    }.width('100%').alignItems(HorizontalAlign.Start).padding(14).backgroundColor('#FFFBEA')
      .border({ radius: 18, width: 1, color: '#BCD2B5' }).id('mascot-guide');
  }

  build() {
    Stack({ alignContent: Alignment.BottomEnd }) {
      Image($rawfile('playful/scenes/campus.svg')).width(198).height(125).opacity(0.63)
        .translate({ x: 20, y: 18 }).accessibilityLevel('no');
      Column({ space: 14 }) {
        Row() {
          Text('小瞳的守护手账').fontSize(12).fontWeight(FontWeight.Medium).fontColor(Theme.brand)
            .padding({ left: 10, right: 10, top: 6, bottom: 6 }).backgroundColor('#F8FFEB')
            .border({ width: 1, color: '#AFCFAD' }).borderRadius(12).rotate({ angle: -3 });
          Blank();
          Text('一起出发').fontSize(11).fontColor(Theme.brand);
        }.width('100%');
        Row({ space: 2 }) {
          Column({ space: 10 }) {
            Text('把校园里的\n每一处照顾好。').fontSize(25).fontWeight(FontWeight.Bold)
              .lineHeight(33).fontColor(Theme.text);
            Text(this.role || '小瞳，陪你一起看变化。').fontSize(12).fontColor(Theme.secondary);
            Text('戳戳小瞳，打个招呼').fontSize(11).fontColor(Theme.brand);
          }.alignItems(HorizontalAlign.Start).layoutWeight(1);
          Mascot({ dimension: 115, interactive: true, floating: true, onGreet: () => this.toggleTips() });
        }.width('100%').alignItems(VerticalAlign.Center);
        Text('比赛演示 · 硬件输入模拟').fontSize(11).fontColor(Theme.brand);
        if (this.tips) { this.guide(); }
      }.alignItems(HorizontalAlign.Start).padding(20).width('100%');
    }.width('100%').backgroundColor(Theme.soft)
      .backgroundImage($rawfile('playful/patterns/doodle.svg')).backgroundImageSize(ImageSize.Cover)
      .borderRadius(28).clip(true)
      .border({ width: 1.4, color: '#A9CCB5' }).shadow({ radius: 0, offsetY: 5, color: '#CEDFCB' });
  }
}
