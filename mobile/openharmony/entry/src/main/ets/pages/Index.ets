import common from '@ohos.app.ability.common';
import { BackendClient } from '../core/network/BackendClient';
import { ConnectionPreferences } from '../core/storage/ConnectionPreferences';
import { AppearancePreferences } from '../core/storage/AppearancePreferences';
import { WorkspaceController } from '../core/identity/WorkspaceController';
import { AppState } from '../shared/state/AppState';
import { Theme } from '../shared/theme/Theme';
import { BottomDock } from '../shared/playful/BottomDock';
import { WorkbenchPage } from '../features/workbench/WorkbenchPage';
import { MonitoringPage } from '../features/monitoring/MonitoringPage';
import { PointDetail } from '../features/monitoring/PointDetail';
import { TasksPage } from '../features/tasks/TasksPage';
import { ProfilePage } from '../features/profile/ProfilePage';

@Entry
@Component
struct Index {
  @State state: AppState = new AppState();
  @State tab: number = 0;
  @State pointId: string = '';
  private paths: NavPathStack = new NavPathStack();
  private controller: WorkspaceController | undefined = undefined;
  private showHome: boolean = true;
  private appearance: AppearancePreferences | undefined = undefined;

  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.appearance = new AppearancePreferences(context);
    this.controller = new WorkspaceController({
      storage: new ConnectionPreferences(context), createClient: (settings) => new BackendClient(settings),
      onReset: () => { this.paths.clear(); this.pointId = ''; },
      onChange: (state: AppState) => {
        this.state = state;
        if (state.mode === 'ready' && this.showHome) { this.tab = 0; this.showHome = false; }
      }
    });
    this.controller.initialize();
  }

  onPageHide(): void { this.controller?.suspend(); }
  onPageShow(): void { this.controller?.resume(); }

  @Builder
  destination(name: string) {
    if (name === 'point') {
      NavDestination() { PointDetail({ state: this.state, pointId: this.pointId }); }
        .title('测点详情').backgroundColor(Theme.canvas);
    }
  }

  @Builder
  screens() {
    TabContent() {
      WorkbenchPage({ state: this.state, onTab: (index) => { this.tab = index; }, onRefresh: () => this.controller?.refresh() });
    };
    TabContent() {
      MonitoringPage({ state: this.state, onSettings: () => { this.tab = 3; }, onRefresh: () => this.controller?.refresh(),
        onOpen: (id) => { this.pointId = id; this.paths.pushPathByName('point', id); } });
    };
    TabContent() {
      TasksPage({ state: this.state, onSettings: () => { this.tab = 3; }, onRefresh: () => this.controller?.refresh() });
    };
    TabContent() {
      ProfilePage({ state: this.state, onMotion: (enabled) => this.appearance?.setMotion(enabled), onRefresh: () => this.controller?.refresh(),
        onSelect: (id) => { this.showHome = false; this.controller?.select(id); },
        onConnect: (address) => { this.showHome = true; this.controller?.connect(address); } });
    };
  }

  build() {
    Navigation(this.paths) {
      Column() {
        Tabs({ index: this.tab }) {
          this.screens();
        }.onChange((index: number) => { this.tab = index; }).animationDuration(180)
          .barHeight(0).width('100%').layoutWeight(1);
        BottomDock({ selected: this.tab, onSelect: (index) => { this.tab = index; } });
      }.width('100%').height('100%');
    }.navDestination(this.destination).hideTitleBar(true).width('100%').height('100%').backgroundColor(Theme.canvas);
  }
}
