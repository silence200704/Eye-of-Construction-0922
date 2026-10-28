import { Identity } from '../../data/models/Identity';
import { Workspace, emptyWorkspace } from '../../data/models/Workspace';

export class AppState {
  mode: string = 'idle';
  busy: boolean = false;
  message: string = '';
  baseUrl: string = '';
  user: Identity | null = null;
  identities: Identity[] = [];
  workspace: Workspace = emptyWorkspace();
  loadedAt: string = '';

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
    }
  }
}
