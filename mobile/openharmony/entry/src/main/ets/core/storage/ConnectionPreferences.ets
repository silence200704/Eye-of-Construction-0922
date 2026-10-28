import common from '@ohos.app.ability.common';
import preferences from '@ohos.data.preferences';
import { ConnectionSettings } from '../../data/models/Identity';

export interface SettingsStorage {
  load(): Promise<ConnectionSettings>;
  save(value: ConnectionSettings): Promise<void>;
}

export class ConnectionPreferences implements SettingsStorage {
  private store: preferences.Preferences;
  private queue: Promise<void> = Promise.resolve();

  constructor(context: common.UIAbilityContext) {
    this.store = preferences.getPreferencesSync(context, { name: 'zhutong_connection' });
  }

  async load(): Promise<ConnectionSettings> {
    return { baseUrl: this.store.getSync('baseUrl', '') as string,
      identityId: this.store.getSync('identityId', '') as string };
  }

  save(value: ConnectionSettings): Promise<void> {
    const next = this.queue.then(async () => {
      this.store.putSync('baseUrl', value.baseUrl);
      this.store.putSync('identityId', value.identityId);
      await this.store.flush();
    });
    this.queue = next.catch(() => {});
    return next;
  }
}
