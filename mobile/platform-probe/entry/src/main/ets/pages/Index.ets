import common from '@ohos.app.ability.common';
import { runAssetProbe, saveReport } from './probe/AssetProbe';
import { ProbeProgress } from './probe/ProbeModels';
import { runCapabilities } from './probe/CapabilityProbe';

@Entry
@Component
struct Index {
  @State progress: ProbeProgress = { completed: 0, total: 104, current: '', pngPassed: 0, svgPassed: 0 };
  @State status: string = '准备核验资源';
  @State running: boolean = false;
  @State pngPreview: boolean = false;
  @State svgPreview: boolean = false;
  @State capabilities: string = '网络与存储尚未核验';

  aboutToAppear(): void {
    this.run();
  }

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.status = '正在由原生图片框架逐项解码';
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const report = await runAssetProbe({ resources: context.resourceManager,
        update: (value: ProbeProgress) => { this.progress = value; } });
      report.pngPreview = this.pngPreview;
      report.svgPreview = this.svgPreview;
      saveReport(context.filesDir, report);
      const failed = report.results.filter((item) => !item.passed).length;
      this.status = failed === 0 ? '原生解码核验完成' : `核验完成，${failed}项需处理`;
      const capabilities = await runCapabilities(context);
      const passed = capabilities.checks.filter((item) => item.passed).length;
      this.capabilities = `能力核验 ${passed}/${capabilities.checks.length} · 本地运行第${capabilities.persistedRun}次`;
    } catch (cause) {
      this.status = `核验失败：${(cause as Error).message}`;
    } finally {
      this.running = false;
    }
  }

  @Builder
  header() {
    Column({ space: 10 }) {
      Text('筑瞳 · 原生环境核验').fontSize(25).fontWeight(FontWeight.Bold).fontColor('#203A37');
      Text('阶段7A资源验证 · 非业务工作台').fontSize(13).fontColor('#52665F');
      Image($rawfile('design/exports/scenes/morning.png'))
        .height(165).width('100%').objectFit(ImageFit.Contain)
        .onComplete(() => { this.pngPreview = true; });
    }.padding(20).width('100%').backgroundColor('#E8EFDE').borderRadius(24);
  }

  @Builder
  previews() {
    Row({ space: 14 }) {
      Image($rawfile('design/svg/mascot/ready.svg'))
        .width(104).height(104).objectFit(ImageFit.Contain)
        .onComplete(() => { this.svgPreview = true; });
      Column({ space: 8 }) {
        Text('小瞳与校园，来到原生界面').fontSize(17).fontColor('#203A37');
        Text(`PNG显示：${this.pngPreview ? '完成' : '等待'}`).fontSize(13).fontColor('#52665F');
        Text(`SVG显示：${this.svgPreview ? '完成' : '等待'}`).fontSize(13).fontColor('#52665F');
      }.alignItems(HorizontalAlign.Start).layoutWeight(1);
    }.padding(18).width('100%').backgroundColor(Color.White).borderRadius(20);
  }

  @Builder
  results() {
    Column({ space: 12 }) {
      Text(this.status).fontSize(18).fontWeight(FontWeight.Medium).fontColor('#0F6E7C');
      Text(`已处理 ${this.progress.completed} / ${this.progress.total}`).fontSize(16).fontColor('#203A37');
      Text(`PNG通过 ${this.progress.pngPassed} · SVG通过 ${this.progress.svgPassed}`)
        .fontSize(14).fontColor('#52665F');
      Text(this.capabilities).fontSize(14).fontColor('#52665F');
      Text(this.progress.current).fontSize(11).fontColor('#52665F').maxLines(2);
      Button(this.running ? '正在核验' : '重新核验资源')
        .height(48).width('100%').backgroundColor('#0F6E7C')
        .enabled(!this.running).onClick(() => { this.run(); });
      Text('只核验本地美术资源；不读取监测业务，不生成上报或工单。')
        .fontSize(12).fontColor('#52665F');
    }.alignItems(HorizontalAlign.Start).padding(20).width('100%')
      .backgroundColor(Color.White).borderRadius(20);
  }

  build() {
    Scroll() {
      Column({ space: 16 }) {
        this.header();
        this.previews();
        this.results();
      }.padding({ top: 36, left: 20, right: 20, bottom: 36 }).width('100%');
    }.width('100%').height('100%').backgroundColor('#F3F6F2');
  }
}
