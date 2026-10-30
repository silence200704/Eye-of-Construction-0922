import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';
import { PlayButton } from '../../shared/playful/PlayButton';
import { PhotoOpen, SavedPhoto, photoErrorMessage } from '../../core/media/PhotoReader';
import { ApiError } from '../../core/network/ApiError';

@Component
export struct SavedPhotos {
  @Prop ids: string[] = [];
  @Prop issueId: string = '';
  @Prop orderId: string = '';
  @State preview: string = '';
  @State kind: string = '';
  @State message: string = '';
  @State loading: boolean = false;
  private generation: number = 0;
  onOpen: (request: PhotoOpen) => Promise<SavedPhoto | null> = async () => null;
  onClear: () => void = () => {};
  aboutToDisappear(): void { this.generation++; this.onClear(); }
  async open(id: string): Promise<void> {
    this.onClear(); const generation = ++this.generation; this.preview = ''; this.loading = true; this.message = '';
    try {
      const data = await this.onOpen({ attachmentId: id, issueId: this.issueId || undefined, orderId: this.orderId || undefined });
      if (generation !== this.generation) return;
      if (!data) throw new ApiError('UNAVAILABLE', '照片暂不可用，请重新打开重试。');
      this.preview = data.uri; this.kind = data.kind;
    } catch (cause) {
      if (generation !== this.generation) return;
      this.message = photoErrorMessage(cause as Error);
      try { this.getUIContext().getPromptAction().showToast({ message: this.message, duration: 3000 }); }
      catch (_) { /* The inline message remains available if the window cannot show a toast. */ }
    }
    finally { if (generation === this.generation) this.loading = false; }
  }
  build() {
    if (this.ids.length) {
      AppCard({ color: Theme.sky }) {
        Text('已提交的现场证据').fontSize(19).fontWeight(FontWeight.Bold).fontColor(Theme.text);
        if (this.message) { Text(this.message).fontSize(14).fontColor(Theme.danger).id('saved-photo-feedback'); }
        ForEach(this.ids, (id: string, index: number) => {
          PlayButton({ title: `查看第 ${index + 1} 张照片`, secondary: true, available: !this.loading,
            controlId: `saved-photo-${index}`, onAction: () => this.open(id) });
        }, (id: string) => id);
        if (this.loading) { Text('正在核验并读取照片…').fontSize(14).fontColor(Theme.brand); }
        if (this.preview) {
          Text(this.kind === 'before' ? '维修前照片' : this.kind === 'after' ? '维修后照片' : this.kind === 'acceptance' ? '验收照片' : '现场照片')
            .fontSize(15).fontColor(Theme.brand);
          Image(this.preview).width('100%').constraintSize({ minHeight: 220, maxHeight: 500 }).objectFit(ImageFit.Contain)
            .accessibilityText('服务端已保存的现场证据照片').id('saved-photo-preview');
        }
      }
    }
  }
}
