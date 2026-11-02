import { AssistantAnswer, AssistantContext, AssistantReply, AssistantTurn, AssistantView } from '../../data/models/Assistant';
import { TaskAccess } from '../field/TaskCommander';
import { ApiError, errorMessage } from '../network/ApiError';

interface AssistantQueryContext {
  chosen: boolean;
  pointId?: string;
  eventId?: string;
  issueId?: string;
  workOrderId?: string;
  source: string;
}

interface AssistantQueryBody {
  question: string;
  context: AssistantQueryContext;
  sessionId?: string;
}

export interface AssistantOptions {
  access: () => TaskAccess | null;
  onChange: (view: AssistantView) => void;
  invalidate: (message: string) => void;
}

export class AssistantSession {
  private options: AssistantOptions;
  private view: AssistantView = new AssistantView();
  private context: AssistantContext = {};
  private generation: number = 0;
  private sequence: number = 0;
  private lastQuestion: string = '';

  constructor(options: AssistantOptions) { this.options = options; }

  deactivate(): void {
    this.generation += 1;
    this.view = new AssistantView();
    this.context = {};
    this.lastQuestion = '';
    this.options.onChange(this.view.copy());
  }

  setContext(context: AssistantContext, label: string): void {
    this.context = context;
    this.view.contextLabel = label;
    this.view.turns = [];
    this.view.sessionId = '';
    this.view.message = '';
    this.view.phase = 'idle';
    this.view.thinkingStep = 0;
    this.options.onChange(this.view.copy());
  }

  clearConversation(): void {
    this.view.turns = [];
    this.view.sessionId = '';
    this.view.message = '';
    this.view.phase = 'idle';
    this.view.thinkingStep = 0;
    this.options.onChange(this.view.copy());
  }

  private publish(): void { this.options.onChange(this.view.copy()); }

  private contextBody(): AssistantQueryContext {
    const body: AssistantQueryContext = { chosen: false, source: 'page' };
    let bound = false;
    if (this.context.pointId) { body.pointId = this.context.pointId; bound = true; }
    if (this.context.eventId) { body.eventId = this.context.eventId; bound = true; }
    if (this.context.issueId) { body.issueId = this.context.issueId; bound = true; }
    if (this.context.workOrderId) { body.workOrderId = this.context.workOrderId; bound = true; }
    body.chosen = bound;
    return body;
  }

  async ask(question: string): Promise<void> {
    const text = question.trim();
    if (text.length === 0 || ['sending', 'thinking'].includes(this.view.phase)) return;
    const access = this.options.access();
    if (!access) { this.view.phase = 'error'; this.view.message = '请先连接校园服务并选择身份。'; this.publish(); return; }
    const generation = this.generation;
    this.lastQuestion = text;
    this.view.phase = 'thinking';
    this.view.thinkingStep = 0;
    this.view.message = '小瞳正在理解问题…';
    this.publish();
    const body: AssistantQueryBody = { question: text, context: this.contextBody() };
    if (this.view.sessionId) body.sessionId = this.view.sessionId;
    this.sequence += 1;
    const request = access.client.send<AssistantReply>('/datasets/demo-main/assistant/query', {
        method: 'POST',
        body: JSON.stringify(body),
        idempotencyKey: `mobile-assistant-${Date.now()}-${this.sequence}`,
        datasetEpoch: access.workspace.epoch,
      });
    try {
      const response = await request;
      if (generation !== this.generation) return;
      // 服务端事实已返回后，再按三步思考节奏呈现，答案不会瞬间弹出。
      const current = await this.advanceThinking(generation);
      if (!current) return;
      if (response.meta?.datasetEpoch !== access.workspace.epoch) throw new ApiError('EPOCH_CHANGED', '演示数据已变化，请重新读取。');
      const reply = response.data;
      if (!reply || !reply.answer || typeof reply.answer.conclusion !== 'string' || !reply.sessionId) {
        throw new ApiError('INVALID_RESPONSE', '小瞳返回内容不完整，请重试。');
      }
      const answer = this.normalize(reply.answer);
      this.view.sessionId = reply.sessionId;
      this.view.turns = this.view.turns.concat([{
        id: reply.turnId || `turn-${this.view.turns.length + 1}`,
        seq: this.view.turns.length + 1,
        question: text,
        answer,
        createdAt: new Date().toISOString(),
      }]);
      this.view.phase = 'ready';
      this.view.thinkingStep = 2;
      this.view.message = '';
      this.publish();
    } catch (cause) {
      if (generation !== this.generation) return;
      const error = cause as ApiError;
      if (error.code === 'AUTHORIZATION_CHANGED' || error.code === 'EPOCH_CHANGED' || [401, 403].includes(error.status ?? 0)) {
        this.deactivate();
        this.options.invalidate(errorMessage(error as Error));
        return;
      }
      this.view.phase = 'error';
      this.view.thinkingStep = 0;
      this.view.message = errorMessage(error as Error);
      this.publish();
    }
  }

  private async advanceThinking(generation: number): Promise<boolean> {
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    if (generation !== this.generation) return false;
    this.view.thinkingStep = 1;
    this.publish();
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    if (generation !== this.generation) return false;
    this.view.thinkingStep = 2;
    this.publish();
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    return generation === this.generation;
  }

  async retry(): Promise<void> {
    if (!this.lastQuestion) return;
    this.view.phase = 'idle';
    await this.ask(this.lastQuestion);
  }

  private normalize(answer: AssistantAnswer): AssistantAnswer {
    return {
      intent: typeof answer.intent === 'string' ? answer.intent : '',
      status: typeof answer.status === 'string' ? answer.status : '',
      conclusion: answer.conclusion,
      facts: Array.isArray(answer.facts) ? answer.facts : [],
      links: Array.isArray(answer.links) ? answer.links : [],
      followups: Array.isArray(answer.followups) ? answer.followups : [],
      dataNotes: Array.isArray(answer.dataNotes) ? answer.dataNotes : [],
      objects: answer.objects ?? { pointId: null, eventId: null, issueId: null, workOrderId: null, buildingId: null },
    };
  }
}
