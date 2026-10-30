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
import { OrderDetail } from '../features/tasks/OrderDetail';
import { ProfilePage } from '../features/profile/ProfilePage';
import { ReportPage } from '../features/reports/ReportPage';
import { IssuesPage } from '../features/reports/IssuesPage';
import { ReportSession } from '../core/report/ReportSession';
import { ReportView } from '../core/report/ReportView';
import { PhotoSelector } from '../core/media/PhotoSelector';
import { ReportTarget, HandlingRequest } from '../data/models/Reports';
import { EventDetail } from '../features/alerts/EventDetail';
import { StatisticsPage } from '../features/statistics/StatisticsPage';
import { EventSession, EventView } from '../core/alerts/EventSession';
import { PhotoReader } from '../core/media/PhotoReader';
import { SandboxPreviewFiles } from '../core/media/PreviewFiles';
import { OfflinePage } from '../features/offline/OfflinePage';

@Entry
@Component
struct Index {
  @State state: AppState = new AppState();
  @StorageLink('zhutong.motion') motion: boolean = true;
  @State tab: number = 0;
  @State pointId: string = '';
  @State taskId: string = '';
  @State orderId: string = '';
  @State handlingId: string = '';
  @State eventId: string = '';
  @State eventCommand: EventView = new EventView();
  @State report: ReportView = new ReportView();
  private paths: NavPathStack = new NavPathStack();
  private controller: WorkspaceController | undefined = undefined;
  private showHome: boolean = true;
  private appearance: AppearancePreferences | undefined = undefined;
  private reporter: ReportSession | undefined = undefined;
  private photos: PhotoSelector | undefined = undefined;
  private events: EventSession | undefined = undefined;
  private reader: PhotoReader | undefined = undefined;
  private offlinePicking: boolean = false;

  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.appearance = new AppearancePreferences(context);
    this.photos = new PhotoSelector(context);
    this.reader = new PhotoReader({ access: () => this.controller?.fieldAccess() ?? null, files: new SandboxPreviewFiles(context.cacheDir) });
    this.controller = new WorkspaceController({
      storage: new ConnectionPreferences(context), createClient: (settings) => new BackendClient(settings),
      onReset: () => { this.reporter?.deactivate(); this.events?.deactivate(); this.reader?.clear(); this.paths.clear(); this.pointId = ''; this.taskId = ''; this.orderId = ''; this.handlingId = ''; this.eventId = ''; },
      onChange: (state: AppState) => {
        this.state = state;
        if (state.mode === 'ready' && this.showHome) { this.tab = 0; this.showHome = false; }
      }
    });
    this.reporter = new ReportSession({ access: () => this.controller?.fieldAccess() ?? null,
      onChange: (view) => { this.report = view; }, invalidate: (message) => this.controller?.invalidateReport(message),
      disposePhoto: (photo) => this.photos?.dispose(photo), onResult: (result) => this.controller?.acceptReport(result) });
    this.events = new EventSession({ access: () => this.controller?.fieldAccess() ?? null,
      onChange: (view) => { this.eventCommand = view; }, onEvent: (event) => this.controller?.acceptEvent(event),
      invalidate: (message) => this.controller?.invalidateReport(message) });
    this.controller.initialize();
  }

  onPageHide(): void { if (!this.reporter?.isExternal() && !this.offlinePicking) this.controller?.suspend(); }
  onPageShow(): void { if (!this.reporter?.isExternal() && !this.offlinePicking) this.controller?.resume(); }

  openReport(target: ReportTarget): void {
    this.reporter?.start(target);
    if (this.report.draft) this.paths.pushPathByName('report', 'report');
  }

  handlingBusy(): boolean { return ['loading', 'sending', 'picking'].includes(this.report.phase); }

  async openHandling(request: HandlingRequest): Promise<void> {
    this.handlingId = request.issueId ?? request.orderId ?? '';
    const opened = await this.reporter?.startHandling(request);
    if (!opened) {
      if (this.report.draft && this.report.phase !== 'done') this.paths.pushPathByName('report', 'report');
      return;
    }
    if (request.action === 'repairing' && !this.report.draft?.target.requireNote) {
      await this.reporter?.submit();
      if (this.report.phase === 'done') return;
    }
    this.paths.pushPathByName('report', 'report');
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
    } else if (name === 'event') {
      NavDestination() { EventDetail({ state: this.state, eventId: this.eventId, command: this.eventCommand,
        onWrite: (write) => this.events?.submit(write), onRetry: () => this.events?.retry(), onReload: () => this.controller?.reloadHandling() }); }
        .title('预警处置').backgroundColor(Theme.canvas).onBackPressed(() => ['sending', 'unknown'].includes(this.eventCommand.phase));
    } else if (name === 'statistics') {
      NavDestination() { StatisticsPage({ state: this.state, onLoad: async (query) => await this.controller?.readInsights(query) ?? null }); }
        .title('守护统计').backgroundColor(Theme.canvas);
    } else if (name === 'offline') {
      NavDestination() { OfflinePage({ state: this.state, onAccess: () => this.controller?.fieldAccess() ?? null,
        onExternal: (value) => { this.offlinePicking = value; }, onSynced: (result) => this.controller?.acceptReport(result) }); }.title('离线随身包').backgroundColor(Theme.canvas);
    } else if (name === 'issues') {
      NavDestination() { IssuesPage({ state: this.state, onNew: (target) => this.openReport(target), onRefresh: () => this.controller?.reloadHandling(),
        onPhoto: async (request) => await this.reader?.open(request) ?? null, onClearPhotos: () => this.reader?.clear(),
        onSupplement: (id) => this.openHandling({ issueId: id }), feedback: this.report.message, busy: this.handlingBusy() }); }
        .title('现场发现').backgroundColor(Theme.canvas).onBackPressed(() => this.handlingBusy());
    } else if (name === 'work-order') {
      NavDestination() {
        OrderDetail({ state: this.state, orderId: this.orderId, busy: this.handlingBusy(),
          onPhoto: async (request) => await this.reader?.open(request) ?? null, onClearPhotos: () => this.reader?.clear(),
          feedback: this.handlingId === this.orderId ? this.report.message : '',
          onHandle: (action) => this.openHandling({ orderId: this.orderId, action }), onReload: () => this.controller?.reloadHandling() });
      }.title('维修手账').backgroundColor(Theme.canvas).onBackPressed(() => this.handlingBusy());
    } else if (name === 'report') {
      NavDestination() {
        ReportPage({ state: this.state, report: this.report, onField: (key, value) => this.reporter?.field(key, value),
          onChoose: (source) => this.reporter?.choose(async () => await this.photos?.choose(source) ?? null),
          onRemove: (id) => this.reporter?.remove(id), onSubmit: () => this.reporter?.submit(), onRetry: () => this.reporter?.retry(),
          onReload: () => this.report.draft?.target.issueId || this.report.draft?.target.orderId ? this.controller?.reloadHandling() : this.controller?.reloadInspection(),
          onAdopt: (rev) => this.reporter?.adoptRevision(rev), onKind: (id, kind) => this.reporter?.photoKind(id, kind),
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
        onEvent: (id) => { this.eventId = id; this.paths.pushPathByName('event', id); },
        onStats: () => this.paths.pushPathByName('statistics', 'statistics'),
        onOpen: (id) => { this.pointId = id; this.paths.pushPathByName('point', id); } });
    };
    TabContent() {
      TasksPage({ state: this.state, onSettings: () => { this.tab = 3; }, onRefresh: () => this.controller?.refresh(),
        onOpenOrder: (id) => { this.orderId = id; this.paths.pushPathByName('work-order', id); },
        onOpen: (id) => { this.taskId = id; this.paths.pushPathByName('inspection-task', id); } });
    };
    TabContent() {
      ProfilePage({ state: this.state, onMotion: (enabled) => this.appearance?.setMotion(enabled), onRefresh: () => this.controller?.refresh(),
        onOffline: () => this.paths.pushPathByName('offline', 'offline'),
        onSelect: (id) => { this.showHome = false; this.controller?.select(id); },
        onConnect: (address) => { this.showHome = true; this.controller?.connect(address); } });
    };
  }

  build() {
    Navigation(this.paths) {
      Column() {
        Tabs({ index: this.tab }) {
          this.screens();
        }.onChange((index: number) => { this.tab = index; }).animationDuration(this.motion ? 180 : 0)
          .barHeight(0).width('100%').layoutWeight(1);
        BottomDock({ selected: this.tab, onSelect: (index) => { this.tab = index; } });
      }.width('100%').height('100%');
    }.navDestination(this.destination).hideTitleBar(true).width('100%').height('100%').backgroundColor(Theme.canvas)
      .onAreaChange((_previous: Area, current: Area) => {
        const width = Number(current.width);
        if (Number.isFinite(width) && width > 0) AppStorage.setOrCreate('zhutong.windowWidth', width);
      });
  }
}
