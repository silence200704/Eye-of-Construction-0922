import audio from '@ohos.multimedia.audio';
import { SoundCue } from '../../core/alerts/SoundCue';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';
import { PlayButton } from '../../shared/playful/PlayButton';

@Component
export struct SignalPreview {
  @State active: boolean = false;
  @State message: string = '';
  private generation: number = 0;
  private cue: SoundCue = new SoundCue(async () => await audio.createAudioRenderer({
    streamInfo: { samplingRate: audio.AudioSamplingRate.SAMPLE_RATE_16000, channels: audio.AudioChannel.CHANNEL_1,
      sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE, encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW },
    rendererInfo: { usage: audio.StreamUsage.STREAM_USAGE_NOTIFICATION, rendererFlags: 0 }
  }));
  aboutToDisappear(): void { this.generation++; this.cue.stop().catch(() => {}); }
  async start(): Promise<void> {
    const generation = ++this.generation; this.active = true; this.message = '本机声光模拟：色块常亮，短音播放一次。';
    try {
      const bytes = await this.cue.play();
      if (generation === this.generation) this.message = `短音输出 ${bytes} 字节，色块保持模拟提示。`;
    } catch (_) { if (generation === this.generation) this.message = '提示音暂不可用；色块仍可预览。'; }
  }
  stop(): void {
    this.generation++; this.active = false; this.message = '模拟已停止，事件状态没有改变。';
    this.cue.stop().catch(() => {});
  }
  build() {
    AppCard({ color: this.active ? Theme.peach : Theme.sky }) {
      Text('声光模拟 · 仅本机预览').fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      Text('常亮色块 + 一次短音；不连接实体设备，停止预览不会确认或关闭事件。').fontSize(13).fontColor(Theme.secondary);
      if (this.message) { Text(this.message).fontSize(14).fontColor(Theme.brand).id('signal-feedback'); }
      PlayButton({ title: this.active ? '停止模拟提示' : '预览一次模拟提示', secondary: true,
        controlId: 'signal-preview', onAction: () => { if (this.active) this.stop(); else this.start(); } });
    }
  }
}
