import { PhotoPreview } from '../../core/report/ReportView';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';
import { PlayButton } from '../../shared/playful/PlayButton';

@Component
export struct PhotoCards {
  @Prop photos: PhotoPreview[];
  @Prop locked: boolean = false;
  onChoose: (source: string) => void = () => {};
  onRemove: (id: string) => void = () => {};

  build() {
    AppCard({ color: Theme.sky }) {
      Text('② 给变化留一份证据').fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      Text(`已选择 ${this.photos.length}/3 张 · ${Math.ceil(this.photos.reduce((size, row) => size + row.size, 0) / 1024)}/600 KB`)
        .fontSize(13).fontColor(Theme.brand).id('report-photo-count');
      Text('自动压缩为JPEG，单张不超过200 KB。照片可选；未上传不算已提交。')
        .fontSize(12).fontColor(Theme.secondary);
      Row({ space: 10 }) {
        PlayButton({ title: '相册选图', secondary: true, available: !this.locked && this.photos.length < 3,
          controlId: 'report-album', onAction: () => this.onChoose('album') }).layoutWeight(1);
        PlayButton({ title: '拍一张', secondary: true, available: !this.locked && this.photos.length < 3,
          controlId: 'report-camera', onAction: () => this.onChoose('camera') }).layoutWeight(1);
      }.width('100%');
      ForEach(this.photos, (photo: PhotoPreview, index: number) => {
        Column({ space: 10 }) {
          Image(photo.uri).width('100%').height(160).objectFit(ImageFit.Contain)
            .borderRadius(15).backgroundColor(Theme.surface).accessibilityText(`第${index + 1}张待提交照片`);
          Text(`${index + 1} · ${photo.source === 'camera' ? '相机' : '相册'} · ${photo.mediaId ? '已上传，待关联' : '本机待上传'}`)
            .fontSize(13).fontColor(Theme.brand).id(`report-photo-state-${index}`);
          Button('移除这张照片').height(48).backgroundColor(Theme.surface).fontColor(Theme.danger)
            .enabled(!this.locked).onClick(() => this.onRemove(photo.draftId)).id(`report-photo-remove-${index}`);
        }.padding(12).width('100%').backgroundColor(Theme.pale).borderRadius(20);
      }, (photo: PhotoPreview) => photo.draftId);
    }
  }
}
