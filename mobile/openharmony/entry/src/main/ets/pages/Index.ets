import { applyBusinessSuggestion } from '../core/business/persistence/SuggestionBridge';
import { SyncCoordinator } from '../core/offline/field/SyncCoordinator';
import { DatasetPreferences } from '../core/storage/DatasetPreferences';
import { ShowcasePage } from '../features/showcase/ShowcasePage';
import { FieldQueue } from '../core/offline/field/FieldQueue';
import { FieldExecutor } from '../core/offline/field/FieldExecutor';
import { MediaLedger } from '../core/offline/media/MediaLedger';
import { NativeDurableFiles, setFileJournal } from '../core/offline/media/NativeDurableFiles';
import { OfflineInspection } from '../features/offline/OfflineInspection';
import { FieldOperation } from '../core/offline/field/FieldModels';
import { OfflinePack, scopeKey } from '../core/offline/OfflineModels';
import { conflictDraft } from '../core/offline/field/ConflictDraft';
import { BusinessDraft, businessFormKey } from '../core/business/BusinessDraft';
import { LiveRefresh } from '../core/business/refresh/LiveRefresh';
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
import { TrendPage } from '../features/trend/TrendPage';
import { EventSession, EventView } from '../core/alerts/EventSession';
import { PhotoReader } from '../core/media/PhotoReader';
import { SandboxPreviewFiles } from '../core/media/PreviewFiles';
import { BusinessPage } from '../features/business/BusinessPage';
import { IssueDetail } from '../features/business/IssueDetail';
import { startBusiness } from '../core/business/BusinessStart';
import { BusinessStore } from '../core/business/BusinessStore';
import { OfflineVault } from '../core/offline/OfflineVault';
import { NativeLocalSql } from '../core/offline/NativeLocalSql';
import { BusinessResult } from '../core/business/BusinessModels';
import { OfflinePage } from '../features/offline/OfflinePage';
import { AssistantPage } from '../features/assistant/AssistantPage';
import { AssistantSession } from '../core/assistant/AssistantSession';
import { AssistantContext, AssistantView } from '../data/models/Assistant';

@Entry
@Component
struct Index {
  @State state: AppState = new AppState();
  @StorageLink('zhutong.motion') motion: boolean = true;
  @State tab: number = 0;
  @State taskView: string = '';
  @State issueFilter: string = 'all';
  @State offlineSync: boolean = false;
  @State issueId: string = '';
  @State suggestionScope: string = '';
  @State suggestionKey: string = '';
  @State businessInitial: string = '';
  @State cachedBusinessState: AppState = new AppState();
  private mediaLedger: MediaLedger | undefined = undefined;
  private mediaFiles: NativeDurableFiles | undefined = undefined;
  private sync: SyncCoordinator | undefined = undefined;
  private fieldQueue: FieldQueue | undefined = undefined;
  private fieldExecutor: FieldExecutor | undefined = undefined;
  private businessStore: BusinessStore | undefined = undefined;
  @State dataset: string = 'demo-main';
  private datasets: DatasetPreferences | undefined = undefined;
  private localVault: OfflineVault | undefined = undefined;
  private lastBusinessResult: BusinessResult | undefined = undefined;
  @State pointId: string = '';
  @State trendPointId: string = '';
  @State taskId: string = '';
  @State orderId: string = '';
  @State handlingId: string = '';
  @State eventId: string = '';
  @State eventCommand: EventView = new EventView();
  @State report: ReportView = new ReportView();
  @State assistant: AssistantView = new AssistantView();
  @State assistantContext: AssistantContext = {};
  @State assistantLabel: string = '';
  private paths: NavPathStack = new NavPathStack();
  private controller: WorkspaceController | undefined = undefined;
  private liveRefresh: LiveRefresh | undefined = undefined;
  private showHome: boolean = true;
  private appearance: AppearancePreferences | undefined = undefined;
  private reporter: ReportSession | undefined = undefined;
  private photos: PhotoSelector | undefined = undefined;
  private events: EventSession | undefined = undefined;
  private reader: PhotoReader | undefined = undefined;
  private offlinePicking: boolean = false;
  private assistantSession: AssistantSession | undefined = undefined;

  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.datasets = new DatasetPreferences(context); this.dataset = this.datasets.current();
    this.localVault = new OfflineVault(new NativeLocalSql(context));
    this.businessStore = new BusinessStore(this.localVault);
    this.mediaLedger = new MediaLedger(this.localVault); this.mediaFiles = new NativeDurableFiles(context.filesDir);
    setFileJournal(async (entry) => {
      const state = this.state.user ? this.state : this.cachedBusinessState;
      if (!state.user) throw new Error('请先选择离线草稿身份。');
      await this.mediaLedger?.record({ id: entry.id, path: entry.path, phase: entry.phase, at: entry.at,
        scope: scopeKey({ baseUrl: state.baseUrl, user: state.user, workspace: state.workspace }) });
    });
    this.fieldQueue = new FieldQueue(this.localVault);
    this.sync = new SyncCoordinator({ vault: this.localVault, access: () => this.controller?.fieldAccess() ?? null,
      files: new NativeDurableFiles(context.filesDir), onResult: (result) => { this.controller?.acceptReport(result); } });
    this.fieldExecutor = this.sync.field;
    this.appearance = new AppearancePreferences(context);
    this.photos = new PhotoSelector(context);
    this.reader = new PhotoReader({ access: () => this.controller?.fieldAccess() ?? null, files: new SandboxPreviewFiles(context.cacheDir) });
    this.controller = new WorkspaceController({
      storage: new ConnectionPreferences(context), createClient: (settings) => new BackendClient(settings),
      onReset: () => { this.reporter?.deactivate(); this.events?.deactivate(); this.assistantSession?.deactivate(); this.reader?.clear(); this.paths.clear(); this.suggestionScope = ''; this.suggestionKey = ''; this.pointId = ''; this.trendPointId = ''; this.taskId = ''; this.orderId = ''; this.handlingId = ''; this.eventId = ''; this.assistantContext = {}; this.assistantLabel = ''; },
      onChange: (state: AppState) => {
        this.state = state;
        if (state.mode === 'ready' && this.showHome) { this.tab = 0; this.showHome = false; }
      }
    });
    this.controller.setJournal(this.businessStore.journal());
    this.reporter = new ReportSession({ access: () => this.controller?.fieldAccess() ?? null,
      onChange: (view) => { this.report = view; }, invalidate: (message) => this.controller?.invalidateReport(message),
      disposePhoto: (photo) => this.photos?.dispose(photo), onResult: (result) => this.controller?.acceptReport(result) });
    this.assistantSession = new AssistantSession({ access: () => this.controller?.fieldAccess() ?? null,
      onChange: (view) => { this.assistant = view; }, invalidate: (message) => this.controller?.invalidateReport(message) });
    this.events = new EventSession({ journal: this.businessStore.journal(), access: () => this.controller?.fieldAccess() ?? null,
      onChange: (view) => { this.eventCommand = view; }, onEvent: (event) => this.controller?.acceptEvent(event),
      invalidate: (message) => this.controller?.invalidateReport(message) });
    this.liveRefresh = new LiveRefresh({ read: async () => { await this.controller?.refreshVisible(); const access = this.controller?.fieldAccess();
      if (access) await this.sync?.run(); } });
    this.controller.initialize().then(() => { void this.liveRefresh?.start(); });
  }

  onPageHide(): void { this.liveRefresh?.stop(); if (!this.reporter?.isExternal() && !this.offlinePicking) this.controller?.suspend(); }
  onPageShow(): void { void this.liveRefresh?.start(); if (!this.reporter?.isExternal() && !this.offlinePicking) this.controller?.resume(); }

  async cleanupMedia(scope: string): Promise<void> {
    try { const count = await this.mediaLedger?.collect(scope, this.mediaFiles!);
      this.getUIContext().getPromptAction().showToast({ message: `已清理 ${count ?? 0} 个未被引用的旧文件；草稿与队列照片保留。` }); }
    catch (_) { this.getUIContext().getPromptAction().showToast({ message: '照片清理未完成，原数据保留。' }); }
  }
  async switchDataset(id: string): Promise<void> {
    try {
      const userId = this.state.user?.id ?? '', base = this.state.baseUrl;
      await this.datasets?.save(id); this.dataset = id; await this.controller?.connect(base, userId);
    } catch (_) { this.getUIContext().getPromptAction().showToast({ message: '数据集切换未完成，请检查连接。' }); }
  }
  openCached(pack: OfflinePack, kind: string, id: string): void {
    const cached = new AppState(); cached.mode = 'ready'; cached.baseUrl = pack.baseUrl; cached.user = pack.user;
    cached.workspace = pack.workspace; cached.identities = this.state.identities; cached.loadedAt = pack.downloadedAt; this.cachedBusinessState = cached;
    if (kind === 'inspection') { this.taskId = id; this.paths.pushPathByName('offline-inspection', id); }
    else { const action = kind === 'order' ? cached.workspace.orders.find((row) => row.id === id)?.status === 'repairing' ? 'submitted' : 'draft' : '';
      this.businessInitial = startBusiness(cached, kind, id, action); this.paths.pushPathByName('business', id); }
  }
  async resolveField(row: FieldOperation): Promise<void> {
    try {
      await this.controller?.refreshVisible(); if (this.state.mode !== 'ready' || !this.state.user) return;
      if (row.write.kind === 'task') {
        const cached = new AppState(this.state); this.cachedBusinessState = cached; this.taskId = row.write.targetId;
        await this.fieldQueue?.abandon(row.id, row.scope); this.paths.pushPathByName('offline-inspection', row.write.targetId); return;
      }
      const draft = conflictDraft(row, this.state);
      await this.fieldQueue?.abandon(row.id, row.scope);
      await this.businessStore?.saveForm(row.scope, businessFormKey(draft), JSON.stringify({ draft, photos: row.photos }));
      this.cachedBusinessState = this.state; this.businessInitial = JSON.stringify(draft); this.paths.pushPathByName('business', row.id);
    } catch (cause) { this.getUIContext().getPromptAction().showToast({ message: (cause as Error).message }); }
  }
  openIssue(id: string): void { this.issueId = id; this.paths.pushPathByName('issue-detail', id); }
  openOrder(id: string): void { this.orderId = id; this.paths.pushPathByName('work-order', id); }
  manage(kind: string, id: string, action: string = ''): void {
    try { this.cachedBusinessState = this.state; this.businessInitial = startBusiness(this.state, kind, id, action); this.paths.pushPathByName('business', id); }
    catch (cause) { this.getUIContext().getPromptAction().showToast({ message: (cause as Error).message }); }
  }
  businessDone(): void {
    this.paths.pop();
    const names = this.paths.getAllPathName(), top = names[names.length - 1];
    const order = this.lastBusinessResult?.order, issue = this.lastBusinessResult?.issue;
    if (order?.status === 'created' && this.state.user?.role === 'safety') { this.manage('order', order.id, 'assigned'); return; }
    if (order && (top !== 'work-order' || this.orderId !== order.id)) this.openOrder(order.id);
    else if (!order && issue && (top !== 'issue-detail' || this.issueId !== issue.id)) this.openIssue(issue.id);
  }

  openTrend(pointId: string): void {
    if (!pointId) return;
    this.trendPointId = pointId;
    this.paths.pushPathByName('trend', pointId);
  }

  openAssistant(context: AssistantContext, label: string): void {
    this.assistantContext = context;
    this.assistantLabel = label;
    this.assistantSession?.setContext(context, label);
    // 小瞳是根 Tab；从压栈的详情页进来时先回到根页，否则切 Tab 被 NavDestination 盖住，看起来像按钮没反应。
    if (this.paths.size() > 0) this.paths.clear();
    this.tab = 3;
  }

  askAssistant(question: string): void { this.assistantSession?.ask(question); }

  async applyAssistant(text: string): Promise<void> {
    if (!this.suggestionKey || !this.businessStore || !this.state.user) { this.reporter?.applySuggestion(text); return; }
    try {
      const scope = scopeKey({ baseUrl: this.state.baseUrl, user: this.state.user, workspace: this.state.workspace });
      if (scope !== this.suggestionScope) throw new Error('身份或数据已变化，请重新打开草稿。');
      const draft = await applyBusinessSuggestion(this.businessStore, scope, this.suggestionKey, text);
      this.businessInitial = JSON.stringify(draft); this.paths.pushPathByName('business', draft.targetId);
    } catch (cause) { this.getUIContext().getPromptAction().showToast({ message: (cause as Error).message }); }
  }
  askBusiness(draft: BusinessDraft): void {
    const context: AssistantContext = draft.kind === 'order' ? { workOrderId: draft.targetId } :
      ['review', 'supplement', 'recheck', 'outcome'].includes(draft.kind) ? { issueId: draft.targetId } : draft.pointId ? { pointId: draft.pointId } : {};
    this.openAssistant(context, '当前办理对象');
  }

  clearAssistantContext(): void {
    this.assistantContext = {};
    this.assistantLabel = '';
    this.assistantSession?.setContext({}, '');
  }

  openAssistantLink(kind: string, objectId: string): void {
    if (kind === 'workorder_detail' && objectId) { this.orderId = objectId; this.paths.pushPathByName('work-order', objectId); return; }
    if ((kind === 'event_detail' || kind === 'event_report') && objectId) { this.eventId = objectId; this.paths.pushPathByName('event', objectId); return; }
    if (kind === 'point_trend' && objectId) { this.openTrend(objectId); return; }
    if ((kind === 'spatial_3d' || kind === 'media_page') && objectId) {
      this.pointId = objectId; this.paths.pushPathByName('point', objectId); return;
    }
    if (kind === 'issue_detail' && objectId) { this.openIssue(objectId); return; }
    if (kind === 'alarm_queue' || kind === 'monitor') { this.tab = 1; return; }
    if (kind === 'overview') { this.tab = 0; return; }
    if (kind === 'settings') { this.tab = 4; return; }
  }

  reportEvent(): void {
    const event = this.state.workspace.events.find((row) => row.id === this.eventId);
    const point = this.state.workspace.points.find((row) => row.id === event?.pointId); if (!event || !point) return;
    const draft = new BusinessDraft(); draft.kind = 'report'; draft.eventId = event.id; draft.pointId = point.id;
    draft.buildingId = point.buildingId; draft.floorId = point.floorId; draft.anomalyType = '预警现场核查';
    this.cachedBusinessState = this.state; this.businessInitial = JSON.stringify(draft); this.paths.pushPathByName('business', event.id);
  }
  openReport(target: ReportTarget): void {
    this.cachedBusinessState = this.state; const draft = new BusinessDraft(); draft.kind = 'report'; draft.taskId = target.taskId; draft.pointId = target.pointId;
    draft.buildingId = target.buildingId; draft.floorId = target.floorId; draft.rev = target.expectedRev;
    this.businessInitial = JSON.stringify(draft); this.paths.pushPathByName('business', 'report');
  }

  handlingBusy(): boolean { return ['loading', 'sending', 'picking'].includes(this.report.phase); }

  async openHandling(request: HandlingRequest): Promise<void> {
    if (request.issueId) { this.manage('supplement', request.issueId); return; }
    if (request.orderId) { this.manage('order', request.orderId, request.action ?? 'submitted'); return; }
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
    if (name === 'showcase') {
      NavDestination() { ShowcasePage({ state: this.state, store: this.businessStore, access: () => this.controller?.fieldAccess() ?? null,
        onReload: (reset) => { if (reset) void this.controller?.refresh(); else void this.controller?.refreshVisible(); } }); }.title('比赛演示').backgroundColor(Theme.canvas);
    } else if (name === 'offline-inspection') {
      NavDestination() { OfflineInspection({ state: this.cachedBusinessState, taskId: this.taskId, store: this.businessStore,
        queue: this.fieldQueue, onExternal: (value) => { this.offlinePicking = value; } }); }.title('离线巡检').backgroundColor(Theme.canvas);
    } else if (name === 'business') {
      NavDestination() { BusinessPage({ state: this.state.mode === 'ready' ? this.state : this.cachedBusinessState, initial: this.businessInitial, store: this.businessStore, queue: this.fieldQueue, onAsk: (draft) => this.askBusiness(draft),
        onDraft: (scope, key) => { this.suggestionScope = scope; this.suggestionKey = key; }, access: () => this.controller?.fieldAccess() ?? null, onExternal: (value) => { this.offlinePicking = value; },
        onResult: (result) => { this.lastBusinessResult = result; this.controller?.acceptReport(result); void this.controller?.reloadHandling(); },
        onDone: () => this.businessDone() }); }.title('业务办理').backgroundColor(Theme.canvas);
    } else if (name === 'issue-detail') {
      NavDestination() { IssueDetail({ state: this.state, issueId: this.issueId, onIssue: (id) => this.openIssue(id),
        onManage: (kind, id) => this.manage(kind, id), onOrder: (id) => this.openOrder(id),
        onEvent: (id) => { this.eventId = id; this.paths.pushPathByName('event', id); void this.events?.restore(); },
        onSupplement: (id) => this.openHandling({ issueId: id }), onPhoto: async (request) => await this.reader?.open(request) ?? null,
        onClearPhotos: () => this.reader?.clear() }); }.title('问题与处置').backgroundColor(Theme.canvas);
    } else if (name === 'point') {
      NavDestination() { PointDetail({ state: this.state, pointId: this.pointId, onReport: (target) => this.openReport(target),
        onTrend: (id) => this.openTrend(id) }); }
        .title('测点详情').backgroundColor(Theme.canvas);
    } else if (name === 'trend') {
      NavDestination() { TrendPage({ state: this.state, pointId: this.trendPointId,
        onLoad: async (id) => await this.controller?.readTrend(id) ?? null }); }
        .title('监测趋势').backgroundColor(Theme.canvas);
    } else if (name === 'inspection-task') {
      NavDestination() {
        TaskDetail({ state: this.state, store: this.businessStore, taskId: this.taskId,
          onSubmit: async (request) => this.controller?.submitInspection(request),
          onReport: (target) => this.openReport(target),
          onAsk: (label, pointId) => this.openAssistant(pointId ? { pointId } : {}, label),
          onRetry: async () => this.controller?.retryInspection(), onReload: () => this.controller?.reloadInspection() });
      }.title('巡检手账').backgroundColor(Theme.canvas);
    } else if (name === 'event') {
      NavDestination() { EventDetail({ state: this.state, store: this.businessStore, onIssue: (id) => this.openIssue(id), onReport: () => this.reportEvent(), eventId: this.eventId, command: this.eventCommand,
        onWrite: (write) => this.events?.submit(write), onRetry: () => this.events?.retry(), onReload: () => this.controller?.reloadHandling() }); }
        .title('预警处置').backgroundColor(Theme.canvas).onBackPressed(() => ['sending', 'unknown'].includes(this.eventCommand.phase));
    } else if (name === 'statistics') {
      NavDestination() { StatisticsPage({ state: this.state, onLoad: async (query) => await this.controller?.readInsights(query) ?? null }); }
        .title('守护统计').backgroundColor(Theme.canvas);
    } else if (name === 'offline') {
      NavDestination() { OfflinePage({ state: this.state, initialSync: this.offlineSync, sharedVault: this.localVault, fieldQueue: this.fieldQueue, fieldExecutor: this.fieldExecutor,
        onOpenCached: (pack, kind, id) => this.openCached(pack, kind, id), onResolve: (row) => this.resolveField(row), onResume: (scope) => { void this.sync?.approve(scope).then(() => this.sync?.run()); }, onCleanup: (scope) => this.cleanupMedia(scope), onAccess: () => this.controller?.fieldAccess() ?? null,
        onExternal: (value) => { this.offlinePicking = value; }, onSynced: (result) => this.controller?.acceptReport(result) }); }.title('离线随身包').backgroundColor(Theme.canvas);
    } else if (name === 'issues') {
      NavDestination() { IssuesPage({ state: this.state, filter: this.issueFilter, onNew: (target) => this.openReport(target), onRefresh: () => this.controller?.reloadHandling(),
        onPhoto: async (request) => await this.reader?.open(request) ?? null, onClearPhotos: () => this.reader?.clear(),
        onOpen: (id) => this.openIssue(id), onSupplement: (id) => this.openHandling({ issueId: id }), onAsk: (id, label) => this.openAssistant({ issueId: id }, label),
        feedback: this.report.message, busy: this.handlingBusy() }); }
        .title('现场发现').backgroundColor(Theme.canvas).onBackPressed(() => this.handlingBusy());
    } else if (name === 'work-order') {
      NavDestination() {
        OrderDetail({ state: this.state, orderId: this.orderId, busy: this.handlingBusy(),
          onPhoto: async (request) => await this.reader?.open(request) ?? null, onClearPhotos: () => this.reader?.clear(),
          feedback: this.handlingId === this.orderId ? this.report.message : '',
          onAsk: (label) => this.openAssistant({ workOrderId: this.orderId }, label),
          onManage: (action) => this.manage('order', this.orderId, action), onIssue: (id) => this.openIssue(id),
          onEvent: (id) => { this.eventId = id; this.paths.pushPathByName('event', id); void this.events?.restore(); },
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
        onSync: () => { this.offlineSync = true; this.paths.pushPathByName('offline', 'offline'); },
        onWork: (kind, status) => { if (kind === 'issues') { this.issueFilter = status; this.paths.pushPathByName('issues', status); }
          else { this.taskView = `${kind}:${status}`; this.tab = 2; } },
        onIssues: () => { this.issueFilter = 'all'; this.paths.pushPathByName('issues', 'issues'); } });
    };
    TabContent() {
      MonitoringPage({ state: this.state, onSettings: () => { this.tab = 4; }, onRefresh: () => this.controller?.refresh(),
        onEvent: (id) => { this.eventId = id; this.paths.pushPathByName('event', id); void this.events?.restore(); },
        onStats: () => this.paths.pushPathByName('statistics', 'statistics'),
        onTrend: (id) => this.openTrend(id),
        onOpen: (id) => { this.pointId = id; this.paths.pushPathByName('point', id); } });
    };
    TabContent() {
      TasksPage({ state: this.state, view: this.taskView, onSettings: () => { this.tab = 4; }, onRefresh: () => this.controller?.refresh(),
        onManual: () => this.manage('manual', ''), onMaintenance: (id) => this.manage('maintenance', id),
        onOpenOrder: (id) => { this.orderId = id; this.paths.pushPathByName('work-order', id); },
        onOpen: (id) => { this.taskId = id; this.paths.pushPathByName('inspection-task', id); } });
    };
    TabContent() {
      AssistantPage({ state: this.state, view: this.assistant, context: this.assistantContext, contextLabel: this.assistantLabel,
        canApply: this.report.draft !== null || !!this.suggestionKey, onAsk: (question) => this.askAssistant(question),
        onRetry: () => { void this.assistantSession?.retry(); }, onClear: () => this.assistantSession?.clearConversation(),
        onClearContext: () => this.clearAssistantContext(), onLink: (kind, id) => this.openAssistantLink(kind, id),
        onApply: (text) => this.applyAssistant(text) });
    };
    TabContent() {
      ProfilePage({ state: this.state, dataset: this.dataset, onDataset: (id) => this.switchDataset(id), onDemo: () => this.paths.pushPathByName('showcase', 'showcase'), onMotion: (enabled) => this.appearance?.setMotion(enabled), onRefresh: () => this.controller?.refresh(),
        onOffline: () => { this.offlineSync = false; this.paths.pushPathByName('offline', 'offline'); },
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
