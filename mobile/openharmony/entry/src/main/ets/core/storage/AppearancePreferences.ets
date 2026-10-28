import common from '@ohos.app.ability.common';
import preferences from '@ohos.data.preferences';

/** UI-only state. No identity, authorization or business data belongs in this store. */
export class AppearancePreferences {
  private store: preferences.Preferences;
  private queue: Promise<void> = Promise.resolve();

  constructor(context: common.UIAbilityContext) {
    this.store = preferences.getPreferencesSync(context, { name: 'zhutong_appearance' });
    AppStorage.setOrCreate('zhutong.motion', this.store.getSync('motion', true) as boolean);
  }

  setMotion(value: boolean): void {
    AppStorage.setOrCreate('zhutong.motion', value);
    this.queue = this.queue.then(async () => {
      this.store.putSync('motion', value);
      await this.store.flush();
    }).catch(() => {});
  }
}
