import common from '@ohos.app.ability.common';
import photoAccessHelper from '@ohos.file.photoAccessHelper';
import cameraPicker from '@ohos.multimedia.cameraPicker';
import camera from '@ohos.multimedia.camera';
import image from '@ohos.multimedia.image';
import fs from '@ohos.file.fs';
import fileUri from '@ohos.file.fileuri';
import { PreparedPhoto } from '../../data/models/Reports';
import { reportId } from '../report/ReportDraft';
import { ApiError } from '../network/ApiError';

export class PhotoSelector {
  private context: common.UIAbilityContext;
  constructor(context: common.UIAbilityContext) { this.context = context; }

  async choose(source: string): Promise<PreparedPhoto | null> {
    let uri: string;
    try {
      if (source === 'camera') {
        const result = await cameraPicker.pick(this.context, [cameraPicker.PickerMediaType.PHOTO],
          { cameraPosition: camera.CameraPosition.CAMERA_POSITION_BACK });
        uri = result.resultCode === 0 ? result.resultUri : '';
      } else {
        const options = new photoAccessHelper.PhotoSelectOptions();
        options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE; options.maxSelectNumber = 1;
        const result = await new photoAccessHelper.PhotoViewPicker().select(options);
        uri = result.photoUris[0] ?? '';
      }
    } catch (_) { throw new ApiError('PHOTO_PERMISSION', '照片选择未完成，可能已取消、权限被拒绝或设备能力不可用。填写内容已保留。'); }
    return uri ? this.prepare(uri, source) : null;
  }

  private async orient(source: image.ImageSource, pixels: image.PixelMap): Promise<void> {
    let orientation = '1';
    try { orientation = await source.getImageProperty(image.PropertyKey.ORIENTATION); } catch (_) { /* No EXIF is a valid image. */ }
    if (['2', '5', '7'].includes(orientation)) await pixels.flip(true, false);
    if (orientation === '4') await pixels.flip(false, true);
    if (['3', '4'].includes(orientation)) { if (orientation === '3') await pixels.rotate(180); }
    if (['5', '6'].includes(orientation)) await pixels.rotate(90);
    if (['7', '8'].includes(orientation)) await pixels.rotate(270);
  }

  private async encode(source: image.ImageSource, packer: image.ImagePacker): Promise<ArrayBuffer> {
    const info = await source.getImageInfo();
    if (!info.size.width || !info.size.height || info.size.width * info.size.height > 48000000) {
      throw new ApiError('PHOTO_TOO_LARGE', '照片尺寸过大或无效，请选择4800万像素以内的照片。');
    }
    for (const edge of [1600, 1000, 640]) {
      const scale = Math.min(1, edge / Math.max(info.size.width, info.size.height));
      const pixels = await source.createPixelMap({ desiredSize: {
        width: Math.max(1, Math.round(info.size.width * scale)), height: Math.max(1, Math.round(info.size.height * scale)) } });
      try {
        await this.orient(source, pixels);
        const bytes = await packer.packing(pixels, { format: 'image/jpeg', quality: 78 });
        if (bytes.byteLength <= 200 * 1024) return bytes;
      } finally { await pixels.release(); }
    }
    throw new ApiError('PHOTO_TOO_LARGE', '压缩后仍超过单张200 KB，请裁减后重新选择；不会静默丢弃照片。');
  }

  private async prepare(uri: string, origin: string): Promise<PreparedPhoto> {
    const file = fs.openSync(uri, fs.OpenMode.READ_ONLY);
    let source: image.ImageSource | undefined = undefined;
    let packer: image.ImagePacker | undefined = undefined;
    try {
      source = image.createImageSource(file.fd); packer = image.createImagePacker();
      const bytes = await this.encode(source, packer);
      const id = reportId(); const path = `${this.context.cacheDir}/zt-report-${id}.jpg`;
      const output = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      try { fs.writeSync(output.fd, bytes); } finally { fs.closeSync(output); }
      return { draftId: id, bytes, uri: fileUri.getUriFromPath(path), cachePath: path,
        fileName: `${id}.jpg`, mimeType: 'image/jpeg', source: origin };
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      throw new ApiError('PHOTO_DECODE_FAILED', '照片读取或压缩失败，请重新选择；原填写内容保留。');
    } finally {
      if (packer) await packer.release();
      if (source) await source.release();
      fs.closeSync(file);
    }
  }

  dispose(photo: PreparedPhoto): void {
    const path = photo.cachePath ?? '';
    if (!path.startsWith(`${this.context.cacheDir}/zt-report-`)) return;
    try { fs.unlinkSync(path); } catch (_) { /* A reclaimed cache file is already disposed. */ }
  }
}
