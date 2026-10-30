import { controlHeight } from '../../shared/layout/ReadingLayout';
import curves from '@ohos.curves';
import { Identity } from '../../data/models/Identity';
import { AppState } from '../../shared/state/AppState';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';
import { PageStage } from '../../shared/playful/PageStage';
import { PlayButton } from '../../shared/playful/PlayButton';
import { Mascot } from '../../shared/playful/Mascot';
import { IdentityTile } from './IdentityTile';
import { timeText } from '../../shared/format/display';

@Component
export struct ProfilePage {
  @StorageProp('zhutong.fontScale') textScale: number = 1;
  @Prop @Watch('syncAddress') state: AppState;
  @State address: string = '';
  @State expanded: boolean = true;
  @StorageLink('zhutong.motion') motion: boolean = true;
  private syncedBase: string = '';
  private autoFolded: boolean = false;
  onConnect: (address: string) => void = () => {};
  onSelect: (id: string) => void = () => {};
  onRefresh: () => void = () => {};
  onMotion: (enabled: boolean) => void = () => {};
  onOffline: () => void = () => {};

  aboutToAppear(): void { this.syncAddress(); }

  syncAddress(): void {
    if (this.syncedBase !== this.state.baseUrl) {
      this.syncedBase = this.state.baseUrl;
      this.address = this.state.baseUrl;
    }
    if (this.state.mode === 'ready' && !this.autoFolded) {
      this.expanded = false;
      this.autoFolded = true;
    }
    if (this.state.mode === 'error') this.expanded = true;
  }

  toggleConnection(): void {
    this.getUIContext().animateTo({ duration: this.motion ? 260 : 0, curve: curves.springMotion(0.4, 0.85) },
      () => { this.expanded = !this.expanded; });
  }

  @Builder
  connectionFields() {
    Text('筑瞳服务地址').fontSize(13).fontColor(Theme.text);
    TextInput({ text: this.address, placeholder: 'http://电脑局域网IP:8080' }).height(controlHeight(52, this.textScale))
      .type(InputType.Normal).backgroundColor(Theme.canvas).fontColor(Theme.text)
      .border({ width: 1, color: Theme.line }).borderRadius(16)
      .onChange((text: string) => { this.address = text; }).id('service-address');
    Text('填入提供筑瞳服务的电脑地址；模拟器可使用明确配置的反向转发地址。')
      .fontSize(12).fontColor(Theme.secondary);
    PlayButton({ title: this.state.busy ? '小瞳正在连接…' : '连接并读取数据', available: !this.state.busy,
      onAction: () => this.onConnect(this.address), controlId: 'connect-service' });
    if (this.state.message) { Text(this.state.message).fontSize(13).fontColor(Theme.danger); }
  }

  @Builder
  connection() {
    AppCard({ color: '#F0F6ED' }) {
      Row({ space: 10 }) {
        Column({ space: 5 }) {
          Text('校园服务连接').fontSize(18).fontWeight(FontWeight.Bold).fontColor(Theme.text);
          Text(this.state.mode === 'ready' ? '已连上，数据有来处' : this.state.busy ? '小瞳正在重新连线…' : '从这里，连上你的校园')
            .fontSize(12).fontColor(Theme.brand);
        }.alignItems(HorizontalAlign.Start).layoutWeight(1);
        Button(this.expanded ? '收起' : '设置').height(controlHeight(48, this.textScale)).fontSize(13).fontColor(Theme.brand)
          .backgroundColor(Theme.surface).border({ width: 1, color: Theme.line }).borderRadius(16)
          .onClick(() => this.toggleConnection()).id('service-settings');
      }.width('100%');
      if (this.expanded) { this.connectionFields(); }
      if (this.state.mode === 'ready') {
        Text(`当前服务 ${this.state.baseUrl}`).fontSize(11).fontColor(Theme.secondary);
      }
    }
  }

  @Builder
  identities() {
    AppCard() {
      Row({ space: 12 }) {
        Mascot({ art: $rawfile('playful/characters/guide.svg'), dimension: 66 });
        Column({ space: 5 }) {
          Text('今天，由谁来守护？').fontSize(19).fontWeight(FontWeight.Bold).fontColor(Theme.text);
          Text(this.state.user ? `当前：${this.state.user.roleLabel}` : '连接后选择演示身份')
            .fontSize(12).fontColor(Theme.brand).id('current-identity');
        }.alignItems(HorizontalAlign.Start).layoutWeight(1);
      }.width('100%');
      ForEach(this.state.identities, (identity: Identity) => {
        IdentityTile({ identity, selected: this.state.user?.id === identity.id,
          busy: this.state.busy, onSelect: this.onSelect });
      }, (identity: Identity) => identity.id);
      Text('只切换身份，不用账号密码。权限与可见范围由服务端核验。').fontSize(11).fontColor(Theme.secondary);
    }
  }

  @Builder
  preferences() {
    AppCard({ color: '#FFF8DE' }) {
      Row({ space: 12 }) {
        Column({ space: 5 }) {
          Text('轻动效').fontSize(17).fontWeight(FontWeight.Medium).fontColor(Theme.text);
          Text(this.motion ? '小瞳会轻轻动，按钮会回弹' : '安静模式，所有操作照常可用')
            .fontSize(12).fontColor(Theme.secondary);
        }.alignItems(HorizontalAlign.Start).layoutWeight(1);
        Toggle({ type: ToggleType.Switch, isOn: this.motion }).selectedColor(Theme.brand)
          .onChange((enabled: boolean) => this.onMotion(enabled)).id('motion-toggle').accessibilityText('轻动效');
      }.width('100%');
    }
  }

  build() {
    PageStage() {
      Row({ space: 10 }) {
        Column({ space: 6 }) {
          Text('我的守护手账').fontSize(26).fontWeight(FontWeight.Bold).fontColor(Theme.text);
          Text('身份、连接和小偏好，都在这里。').fontSize(12).fontColor(Theme.secondary);
        }.alignItems(HorizontalAlign.Start).layoutWeight(1);
        Image($rawfile('playful/icons/spark.svg')).width(28).height(28).rotate({ angle: 12 }).accessibilityLevel('no');
      }.width('100%');
      this.connection();
      this.identities();
      this.preferences();
      PlayButton({ title: '离线随身包 · 任务与现场笔记', secondary: true, controlId: 'open-offline', onAction: this.onOffline });
      PlayButton({ title: '刷新当前授权范围', secondary: true,
        available: !this.state.busy && !!this.state.baseUrl, onAction: this.onRefresh, controlId: 'refresh-workspace' });
      Text(this.state.mode === 'ready' ? `最近读取 ${timeText(this.state.loadedAt)}` : '尚未读取服务端业务数据')
        .fontSize(11).fontColor(Theme.secondary);
      Text('筑瞳原生 App 0.8.0 · 硬件输入模拟\n在线监测、预警、巡检、上报与工单；完整离线同步按后续阶段提供。')
        .fontSize(10).fontColor(Theme.secondary);
    }
  }
}
