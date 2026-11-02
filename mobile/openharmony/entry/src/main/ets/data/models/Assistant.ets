export interface AssistantFact {
  label: string;
  value: string;
  unit: string;
}

export interface AssistantLink {
  kind: string;
  objectId: string;
}

export interface AssistantAnswer {
  intent: string;
  status: string;
  conclusion: string;
  facts: AssistantFact[];
  links: AssistantLink[];
  followups: string[];
  dataNotes: string[];
  objects: AssistantObjects;
}

export interface AssistantObjects {
  pointId: string | null;
  eventId: string | null;
  issueId: string | null;
  workOrderId: string | null;
  buildingId: string | null;
}

export interface AssistantTurn {
  id: string;
  seq: number;
  question: string;
  answer: AssistantAnswer;
  createdAt: string;
}

export interface AssistantContext {
  pointId?: string;
  eventId?: string;
  issueId?: string;
  workOrderId?: string;
}

export interface AssistantReply {
  sessionId: string;
  turnId: string;
  answer: AssistantAnswer;
}

export class AssistantView {
  phase: string = 'idle';
  message: string = '';
  sessionId: string = '';
  contextLabel: string = '';
  thinkingStep: number = 0;
  turns: AssistantTurn[] = [];

  copy(): AssistantView {
    const next = new AssistantView();
    next.phase = this.phase;
    next.message = this.message;
    next.sessionId = this.sessionId;
    next.contextLabel = this.contextLabel;
    next.thinkingStep = this.thinkingStep;
    next.turns = this.turns.slice();
    return next;
  }
}
