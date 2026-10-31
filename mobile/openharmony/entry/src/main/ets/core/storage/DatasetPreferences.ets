import common from '@ohos.app.ability.common';
import preferences from '@ohos.data.preferences';
import { selectDataset, selectedDataset } from '../network/DatasetSelection';
export class DatasetPreferences {
  private store: preferences.Preferences;
  constructor(context: common.UIAbilityContext) {
    this.store = preferences.getPreferencesSync(context, { name: 'zhutong_dataset' });
    const stored = this.store.getSync('datasetId', 'demo-main') as string;
    selectDataset(['demo-main', 'demo-showcase'].includes(stored) ? stored : 'demo-main');
  }
  current(): string { return selectedDataset(); }
  async save(id: string): Promise<void> {
    if (!['demo-main', 'demo-showcase'].includes(id)) throw new Error('数据集不可用。');
    this.store.putSync('datasetId', id); await this.store.flush(); selectDataset(id);
  }
}
