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
import { TaskDetail } from '../features/tasks/TaskDetail';
import { ProfilePage } from '../features/profile/ProfilePage';
import { ReportPage } from '../features/reports/ReportPage';
import { IssuesPage } from '../features/reports/IssuesPage';
import { ReportSession } from '../core/report/ReportSession';
import { ReportView } from '../core/report/ReportView';
import { PhotoSelector } from '../core/media/PhotoSelector';
import { ReportTarget } from '../data/models/Reports';

@Entry
@Component
struct Index {
  @State state: AppState = new AppState();
  @State tab: number = 0;
  @State pointId: string = '';
  @State taskId: string = '';
  @State report: ReportView = new ReportView();
  private paths: NavPathStack = new NavPathStack();
  private controller: WorkspaceController | undefined = undefined;
  private showHome: boolean = true;
  private appearance: AppearancePreferences | undefined = undefined;
  private reporter: ReportSession | undefined = undefined;
  private photos: PhotoSelector | undefined = undefined;

  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.appearance = new AppearancePreferences(context);
    this.photos = new PhotoSelector(context);
    this.controller = new WorkspaceController({
      storage: new ConnectionPreferences(context), createClient: (settings) => new BackendClient(settings),
      onReset: () => { this.reporter?.deactivate(); this.paths.clear(); this.pointId = ''; this.taskId = ''; },
      onChange: (state: AppState) => {
        this.state = state;
        if (state.mode === 'ready' && this.showHome) { this.tab = 0; this.showHome = false; }
      }
    });
    this.reporter = new ReportSession({ access: () => this.controller?.fieldAccess() ?? null,
      onChange: (view) => { this.report = view; }, invalidate: (message) => this.controller?.invalidateReport(message),
      disposePhoto: (photo) => this.photos?.dispose(photo), onResult: (result) => this.controller?.acceptReport(result) });
    this.controller.initialize();
  }

  onPageHide(): void { if (!this.reporter?.isExternal()) this.controller?.suspend(); }
  onPageShow(): void { if (!this.reporter?.isExternal()) this.controller?.resume(); }

  openReport(target: ReportTarget): void {
    this.reporter?.start(target);
    if (this.report.draft) this.paths.pushPathByName('report', 'report');
  }

  discardReport(): void {
    AlertDialog.show({ title: '放弃这份未提交的草稿？', message: '文字和本机照片将清除，已上传但未关联的文件不会冒充已提交问题。',
      primaryButton: { value: '保留草稿', action: () => {} }, secondaryButton: {
        value: '放弃并返回', action: () => { this.reporter?.deactivate(); this.paths.pop(); } } });
  }

  @Builder
  destination(name: string) {
    if (name === 'point') {
      NavDestination() { PointDetail({ state: this.state, pointId: this.pointId, onReport: (target) => this.openReport(target) }); }
        .title('测点详情').backgroundColor(Theme.canvas);
    } else if (name === 'inspection-task') {
      NavDestination() {
        TaskDetail({ state: this.state, taskId: this.taskId,
          onSubmit: async (request) => this.controller?.submitInspection(request),
          onReport: (target) => this.openReport(target),
          onRetry: async () => this.controller?.retryInspection(), onReload: () => this.controller?.reloadInspection() });
      }.title('巡检手账').backgroundColor(Theme.canvas);
    } else if (name === 'issues') {
      NavDestination() { IssuesPage({ state: this.state, onNew: (target) => this.openReport(target), onRefresh: () => this.controller?.refresh() }); }
        .title('现场发现').backgroundColor(Theme.canvas);
    } else if (name === 'report') {
      NavDestination() {
        ReportPage({ state: this.state, report: this.report, onField: (key, value) => this.reporter?.field(key, value),
          onChoose: (source) => this.reporter?.choose(async () => await this.photos?.choose(source) ?? null),
          onRemove: (id) => this.reporter?.remove(id), onSubmit: () => this.reporter?.submit(), onRetry: () => this.reporter?.retry(),
          onReload: () => this.controller?.reloadInspection(), onAdopt: (rev) => this.reporter?.adoptRevision(rev),
          onDone: () => this.paths.pop(), onDiscard: () => this.discardReport() });
      }.title('记录现场发现').backgroundColor(Theme.canvas)
        .onBackPressed(() => ['picking', 'sending'].includes(this.report.phase));
    }
  }

  @Builder
  screens() {
    TabContent() {
      WorkbenchPage({ state: this.state, onTab: (index) => { this.tab = index; }, onRefresh: () => this.controller?.refresh(),
        onIssues: () => this.paths.pushPathByName('issues', 'issues') });
    };
    TabContent() {
      MonitoringPage({ state: this.state, onSettings: () => { this.tab = 3; }, onRefresh: () => this.controller?.refresh(),
        onOpen: (id) => { this.pointId = id; this.paths.pushPathByName('point', id); } });
    };
    TabContent() {
      TasksPage({ state: this.state, onSettings: () => { this.tab = 3; }, onRefresh: () => this.controller?.refresh(),
        onOpen: (id) => { this.taskId = id; this.paths.pushPathByName('inspection-task', id); } });
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
