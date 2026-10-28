import { Identity } from '../../data/models/Identity';
import { Workspace, emptyWorkspace } from '../../data/models/Workspace';
import { TaskCommandState } from '../../data/models/Inspection';

export class AppState {
  mode: string = 'idle';
  busy: boolean = false;
  message: string = '';
  baseUrl: string = '';
  user: Identity | null = null;
  identities: Identity[] = [];
  workspace: Workspace = emptyWorkspace();
  loadedAt: string = '';
  command: TaskCommandState = new TaskCommandState();

  constructor(other?: AppState) {
    if (other) {
      this.mode = other.mode;
      this.busy = other.busy;
      this.message = other.message;
      this.baseUrl = other.baseUrl;
      this.user = other.user;
      this.identities = other.identities;
      this.workspace = other.workspace;
      this.loadedAt = other.loadedAt;
      this.command = other.command;
    }
  }
}
