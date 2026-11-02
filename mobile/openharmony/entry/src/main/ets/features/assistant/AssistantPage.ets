import { AppState } from '../../shared/state/AppState';
import { AssistantContext, AssistantFact, AssistantLink, AssistantTurn, AssistantView } from '../../data/models/Assistant';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';
import { PageHeading } from '../../shared/playful/PageHeading';
import { Mascot } from '../../shared/playful/Mascot';
import { PlayButton } from '../../shared/playful/PlayButton';
import { controlHeight } from '../../shared/layout/ReadingLayout';

@Component
export struct AssistantPage {
  @StorageProp('zhutong.fontScale') textScale: number = 1;
  @Prop state: AppState;
  @Watch('scrollToLatest') @Prop view: AssistantView;
  private scroller: Scroller = new Scroller();
  @Prop context: AssistantContext;
  @Prop contextLabel: string = '';
  @Prop canApply: boolean = false;
  @State question: string = '';
  @State applied: boolean = false;
  onAsk: (question: string) => void = () => {};
  onRetry: () => void = () => {};
  onClear: () => void = () => {};
  onClearContext: () => void = () => {};
  onLink: (kind: string, objectId: string) => void = () => {};
  onApply: (text: string) => void = () => {};

  scrollToLatest(): void {
    setTimeout(() => { this.scroller.scrollEdge(Edge.Bottom); }, 80);
  }

  private send(text: string): void {
    const clean = text.trim();
    if (clean.length === 0 || this.busy()) return;
    this.applied = false;
    this.question = '';
    this.onAsk(clean);
  }

  private busy(): boolean { return this.view.phase === 'sending' || this.view.phase === 'thinking'; }

  private thinkingSteps(): string[] {
    if (this.context.workOrderId) return ['读取工单与问题状态', '核对身份与处理条件', '整理下一步建议'];
    if (this.context.issueId) return ['读取问题与关联记录', '核对补充材料要求', '整理处理建议'];
    if (this.context.eventId) return ['读取预警与证据链', '核对恢复与关闭条件', '整理处置建议'];
    return ['识别问法与对象', '读取当前服务端数据', '整理结论与证据'];
  }

  private thinkingText(): string {
    const steps = this.thinkingSteps();
    const index = Math.min(this.view.thinkingStep, steps.length - 1);
    return `${steps[index]} · 第 ${index + 1}/${steps.length} 步`;
  }

  private lastTurn(): AssistantTurn | null {
    return this.view.turns.length === 0 ? null : this.view.turns[this.view.turns.length - 1];
  }

  private applyLast(): void {
    const last = this.lastTurn();
    if (last === null || this.applied) return;
    this.onApply(last.answer.conclusion);
    this.applied = true;
  }

  private prompts(): string[] {
    if (this.context.workOrderId) return ['这份工单下一步怎么处理？', '帮我整理工单上报说明', '这条工单关联的问题现在什么状态？'];
    if (this.context.issueId) return ['这条问题还需要补什么材料？', '帮我整理补充说明', '关联测点现在有什么风险？'];
    if (this.context.eventId) return ['这个预警现在该怎么处置？', '关闭这个预警还需要什么依据？'];
    if (this.context.pointId) return ['这个测点现在怎么样？', '这条测点最近有什么变化？'];
    return ['当前有哪些未关闭风险？', '帮我整理一条工单上报说明', '为什么这条预警是红色？', '把工单处理步骤说清楚'];
  }

  private linkLabel(kind: string): string {
    if (kind === 'workorder_detail') return '打开工单';
    if (kind === 'issue_detail') return '打开问题';
    if (kind === 'event_detail' || kind === 'event_report') return '打开预警';
    if (kind === 'point_trend' || kind === 'spatial_3d') return '打开测点';
    if (kind === 'media_page') return '打开测点影像';
    if (kind === 'alarm_queue') return '打开监测';
    if (kind === 'overview') return '回到工作台';
    if (kind === 'monitor') return '打开监测';
    if (kind === 'settings') return '打开设置';
    return '打开相关页面';
  }

  @Builder
  contextCard() {
    if (this.contextLabel) {
      AppCard({ color: Theme.cream }) {
        Row({ space: 10 }) {
          Column({ space: 4 }) {
            Text('当前正在处理').fontSize(12).fontColor(Theme.brand);
            Text(this.contextLabel).fontSize(16).fontWeight(FontWeight.Medium).fontColor(Theme.text).maxLines(2);
          }.alignItems(HorizontalAlign.Start).layoutWeight(1);
          Button('清除').height(controlHeight(44, this.textScale)).fontSize(12).fontColor(Theme.brand)
            .backgroundColor(Theme.surface).border({ width: 1, color: Theme.line }).borderRadius(14)
            .onClick(() => this.onClearContext()).id('assistant-clear-context');
        }.width('100%');
      }
    }
  }

  @Builder
  factRows(facts: AssistantFact[]) {
    ForEach(facts, (fact: AssistantFact) => {
      Row({ space: 8 }) {
        Text(fact.label).fontSize(12).fontColor(Theme.secondary).width(110);
        Text(`${fact.value}${fact.unit}`).fontSize(13).fontColor(Theme.text).layoutWeight(1);
      }.width('100%');
    }, (fact: AssistantFact) => `${fact.label}-${fact.value}`);
  }

  @Builder
  answerCard(turn: AssistantTurn) {
    AppCard({ color: Theme.surface }) {
      Text('小瞳').fontSize(12).fontWeight(FontWeight.Bold).fontColor(Theme.brand);
      Text(turn.question).fontSize(13).fontColor(Theme.secondary);
      Text(turn.answer.conclusion).fontSize(15).lineHeight(23).fontColor(Theme.text);
      if (turn.answer.facts.length > 0) { this.factRows(turn.answer.facts); }
      if (turn.answer.links.length > 0) {
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(turn.answer.links, (link: AssistantLink) => {
            Button(this.linkLabel(link.kind)).height(controlHeight(42, this.textScale)).fontSize(12)
              .fontColor(Theme.brand).backgroundColor(Theme.pale).borderRadius(14).margin({ right: 6, bottom: 6 })
              .onClick(() => this.onLink(link.kind, link.objectId)).id(`assistant-link-${link.kind}`);
          }, (link: AssistantLink) => `${link.kind}-${link.objectId}`);
        }.width('100%');
      }
      if (turn.answer.followups.length > 0) {
        Text('可以接着问').fontSize(11).fontColor(Theme.secondary);
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(turn.answer.followups, (item: string) => {
            Button(item).height(controlHeight(38, this.textScale)).fontSize(11).fontColor(Theme.brand)
              .backgroundColor(Theme.canvas).border({ width: 1, color: Theme.line }).borderRadius(12)
              .margin({ right: 6, bottom: 6 }).onClick(() => this.send(item));
          }, (item: string) => item);
        }.width('100%');
      }
      ForEach(turn.answer.dataNotes, (note: string) => {
        Text(note).fontSize(10.5).fontColor(Theme.secondary).lineHeight(16);
      }, (note: string) => note);
      Text('演示级小瞳：读取当前服务端事实；不会自动提交业务单据。').fontSize(10).fontColor(Theme.secondary);
    }
  }

  @Builder
  thinkingCard() {
    AppCard({ color: Theme.soft }) {
      Row({ space: 12 }) {
        Mascot({ dimension: 54, floating: true });
        Column({ space: 5 }) {
          Text('小瞳正在整理答案…').fontSize(16).fontWeight(FontWeight.Bold).fontColor(Theme.text);
          Text(this.thinkingText()).fontSize(12).fontColor(Theme.brand);
          Row({ space: 6 }) {
            ForEach(this.thinkingSteps(), (step: string, index: number) => {
              Text('●').fontSize(10).fontColor(index <= this.view.thinkingStep ? Theme.brand : Theme.line);
            }, (step: string) => step);
          }.width('100%');
        }.alignItems(HorizontalAlign.Start).layoutWeight(1);
      }.width('100%');
      Text('按当前服务端事实分步核对；不会调用在线模型，也不会替你提交。').fontSize(10.5).fontColor(Theme.secondary);
    }
  }

  @Builder
  conversation() {
    if (this.view.turns.length === 0 && !this.busy()) {
      AppCard({ color: Theme.soft }) {
        Text('问小瞳').fontSize(21).fontWeight(FontWeight.Bold).fontColor(Theme.text);
        Text('工单怎么处理、上报要写什么、这条预警为什么亮起，都可以问。小瞳会引用当前演示库的事实，但不会替你提交。')
          .fontSize(13).lineHeight(21).fontColor(Theme.secondary);
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(this.prompts(), (prompt: string, index: number) => {
            Button(prompt).height(controlHeight(40, this.textScale)).fontSize(11).fontColor(Theme.brand)
              .backgroundColor(Theme.surface).border({ width: 1, color: Theme.line }).borderRadius(13)
              .margin({ right: 6, bottom: 6 }).onClick(() => this.send(prompt)).id(`assistant-prompt-${index}`);
          }, (prompt: string) => prompt);
        }.width('100%');
      }
    } else {
      ForEach(this.view.turns, (turn: AssistantTurn) => { this.answerCard(turn); }, (turn: AssistantTurn) => turn.id);
      if (this.busy()) { this.thinkingCard(); }
      if (this.view.phase === 'error') {
        AppCard({ color: Theme.peach }) {
          Text(this.view.message || '小瞳暂时没有回答。').fontSize(13).fontColor(Theme.danger);
          PlayButton({ title: '用同一个问题重试', secondary: true, controlId: 'assistant-retry', onAction: this.onRetry });
        }
      }
      if (this.canApply && this.lastTurn() !== null && !this.busy()) {
        PlayButton({ title: this.applied ? '已填入当前上报草稿，请核对' : '把建议填入当前上报草稿', secondary: true,
          available: !this.applied, controlId: 'assistant-apply', onAction: () => this.applyLast() });
        Text('只填入备注/描述，不自动提交；最终内容和权限仍由你核对。').fontSize(10.5).fontColor(Theme.secondary);
      }
    }
  }

  @Builder
  composer() {
    Row({ space: 8 }) {
      TextInput({ text: this.question, placeholder: '问工单、上报、预警或校园监测…' })
        .layoutWeight(1).height(controlHeight(48, this.textScale)).fontSize(14)
        .fontColor(Theme.text).backgroundColor(Theme.canvas)
        .border({ width: 1, color: Theme.line }).borderRadius(15)
        .onChange((value: string) => { this.question = value; }).id('assistant-input');
      Button(this.busy() ? '思考中' : '发送')
        .width(74).height(controlHeight(48, this.textScale)).fontSize(13).fontColor(Color.White)
        .backgroundColor(Theme.brand).borderRadius(15)
        .enabled(!this.busy() && this.question.trim().length > 0)
        .onClick(() => this.send(this.question)).id('assistant-send');
    }.width('100%').padding(8).backgroundColor(Theme.surface)
      .border({ width: 1.2, color: Theme.line }).borderRadius(21)
      .shadow({ radius: 10, offsetY: 3, color: '#D7E4DB' });
  }

  build() {
    Column() {
      Scroll(this.scroller) {
        Column({ space: 18 }) {
          PageHeading({ title: '有小瞳，就不一个人扛', subtitle: '工单、上报与问题解答 · 演示级问答', kicker: 'COMPANION / 小瞳' });
          Row({ space: 12 }) {
            Mascot({ dimension: 78, floating: true });
            Text('我是小瞳。工单、上报和预警，都可以先问我；最后一步仍由你确认。')
              .fontSize(12).fontColor(Theme.secondary).layoutWeight(1);
          }.width('100%').padding(12).backgroundColor(Theme.pale).borderRadius(18);
          if (this.state.mode !== 'ready') {
            AppCard({ color: Theme.peach }) {
              Text('先连上校园服务').fontSize(18).fontWeight(FontWeight.Bold).fontColor(Theme.text);
              Text('小瞳需要服务端身份与演示数据；到「我的」设置连接后再问。').fontSize(13).fontColor(Theme.secondary);
            }
          } else {
            this.contextCard();
            this.conversation();
          }
          Blank().height(10);
        }.width('100%').constraintSize({ maxWidth: 840 }).padding({ top: 20, left: 18, right: 18, bottom: 16 })
          .alignItems(HorizontalAlign.Start);
      }.width('100%').layoutWeight(1).scrollBar(BarState.Off).align(Alignment.Top);
      if (this.state.mode === 'ready') {
        Column() { this.composer(); }
          .width('100%').padding({ left: 18, right: 18, top: 6, bottom: 10 })
          .backgroundColor(Theme.canvas);
      }
    }.width('100%').height('100%').backgroundColor(Theme.canvas)
      .backgroundImage($rawfile('playful/patterns/dots.svg')).backgroundImageSize(ImageSize.Cover);
  }


}
