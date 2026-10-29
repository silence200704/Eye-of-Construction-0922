import UIAbility from '@ohos.app.ability.UIAbility';
import window from '@ohos.window';
import hilog from '@ohos.hilog';
import { Configuration as AbilityConfiguration } from '@ohos.app.ability.Configuration';
import accessibility from '@ohos.accessibility';
import { fontScale } from '../shared/layout/ReadingLayout';

export default class EntryAbility extends UIAbility {
  private recordEnvironment(config: AbilityConfiguration): void {
    AppStorage.setOrCreate('zhutong.fontScale', fontScale(config.fontSizeScale ?? 1));
    hilog.info(0x01, 'ZhutongUX', 'fontScale=%{public}s; screenReader=%{public}s; orientation=%{public}s',
      String(config.fontSizeScale ?? 1), String(accessibility.isScreenReaderOpenSync()), String(config.direction));
  }
  onConfigurationUpdate(config: AbilityConfiguration): void { this.recordEnvironment(config); }
  onWindowStageCreate(stage: window.WindowStage): void {
    this.recordEnvironment(this.context.config);
    stage.loadContent('pages/Index', (error) => {
      if (error.code) hilog.error(0x01, 'ZhutongProbe', 'Load failed: %{public}s', error.message);
    });
  }
}
