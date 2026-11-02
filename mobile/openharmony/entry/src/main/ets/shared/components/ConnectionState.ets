import { AppState } from '../state/AppState';
import { Theme } from '../theme/Theme';
import { AppCard } from './AppCard';
import { PlayButton } from '../playful/PlayButton';
import { Mascot } from '../playful/Mascot';

@Component
export struct ConnectionState {
  @Prop state: AppState;
  onSettings: () => void = () => {};
  onRetry: () => void = () => {};

  build() {
    if (this.state.mode === 'ready' && this.state.message) {
      AppCard({ color: Theme.cream }) {
        Text(this.state.message).fontSize(14).fontColor(Theme.warning);
        PlayButton({ title: '重新读取最新进度', secondary: true, onAction: this.onRetry });
      }
    } else if (this.state.mode !== 'ready') {
      AppCard({ color: this.state.mode === 'error' ? '#FFF1E5' : '#FFF9DF' }) {
        Row({ space: 10 }) {
          Mascot({ art: $rawfile('playful/characters/xiaotong.png'), dimension: 68 });
          Column({ space: 6 }) {
            Text(this.state.busy ? '小瞳正在读数据…' : this.state.mode === 'error' ? '连接暂时打了个盹' : '先连上校园服务吧')
              .fontSize(18).fontWeight(FontWeight.Bold).fontColor(Theme.text);
            Text(this.state.busy ? '稍等一下，正在认真核对。' : '小瞳在这儿，陪你重新试一次。').fontSize(12).fontColor(Theme.secondary);
          }.alignItems(HorizontalAlign.Start).layoutWeight(1);
        }.width('100%');
        Text(this.state.message || (this.state.busy ? '请稍候，完成后会显示当前身份可见的数据。' :
          '在“我的”中填写筑瞳服务地址，即可读取监测和待办，无需账号密码。'))
          .fontSize(14).fontColor(Theme.secondary);
        if (this.state.busy) {
          LoadingProgress().height(32).width(32).color(Theme.brand);
        } else {
          Row({ space: 12 }) {
            PlayButton({ title: '设置连接', onAction: this.onSettings, controlId: 'open-settings' }).layoutWeight(1);
            if (this.state.baseUrl) {
              PlayButton({ title: '再试一次', secondary: true, onAction: this.onRetry, controlId: 'retry-read' }).layoutWeight(1);
            }
          }
        }
      }
    }
  }
}
