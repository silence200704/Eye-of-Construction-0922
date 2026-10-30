import fs from '@ohos.file.fs';
import fileUri from '@ohos.file.fileuri';
import cryptoFramework from '@ohos.security.cryptoFramework';
import { PreparedPhoto } from '../../../data/models/Reports';
import { DurablePhoto, DurableReader } from '../queue/QueueModels';
import { ApiError } from '../../network/ApiError';

async function digest(bytes: ArrayBuffer): Promise<string> {
  const md = cryptoFramework.createMd('SHA256');
  await md.update({ data: new Uint8Array(bytes) });
  return Array.from((await md.digest()).data).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export class NativeDurableFiles implements DurableReader {
  private directory: string;
  constructor(filesDir: string) { this.directory = `${filesDir}/offline-media`; }
  private path(id: string): string {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new ApiError('PHOTO_ID', '照片标识无效。');
    return `${this.directory}/${id}.jpg`;
  }
  private bytes(path: string): ArrayBuffer {
    const size = fs.statSync(path).size;
    if (size <= 0 || size > 200 * 1024) throw new ApiError('PHOTO_SIZE', '照片不完整或超过200KB。');
    const bytes = new ArrayBuffer(size), file = fs.openSync(path, fs.OpenMode.READ_ONLY);
    try { if (fs.readSync(file.fd, bytes) !== size) throw new ApiError('PHOTO_SIZE', '照片完整性检查失败。'); }
    finally { fs.closeSync(file); }
    return bytes;
  }
  async save(photo: PreparedPhoto): Promise<DurablePhoto> {
    const path = this.path(photo.draftId), temp = `${path}.tmp`;
    if (!photo.bytes.byteLength || photo.bytes.byteLength > 200 * 1024 || photo.mimeType !== 'image/jpeg') {
      throw new ApiError('PHOTO_SIZE', '请选择已压缩为JPEG且不超过200KB的照片。');
    }
    const sha256 = await digest(photo.bytes);
    if (!fs.accessSync(this.directory)) fs.mkdirSync(this.directory);
    if (fs.accessSync(path)) {
      if (await digest(this.bytes(path)) !== sha256) throw new ApiError('PHOTO_CONFLICT', '同一照片标识的字节冲突，原件已保留。');
    } else {
      try {
        const file = fs.openSync(temp, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
        try { if (fs.writeSync(file.fd, photo.bytes) !== photo.bytes.byteLength) throw new ApiError('PHOTO_SIZE', '照片写入不完整。'); }
        finally { fs.closeSync(file); }
        fs.renameSync(temp, path);
      } catch (cause) { try { fs.unlinkSync(temp); } catch (_) {} throw cause as Error; }
    }
    return { draftId: photo.draftId, path, uri: fileUri.getUriFromPath(path), fileName: `${photo.draftId}.jpg`,
      mimeType: 'image/jpeg', source: photo.source, size: photo.bytes.byteLength, sha256 };
  }
  async read(photo: DurablePhoto): Promise<ArrayBuffer> {
    if (photo.path !== this.path(photo.draftId)) throw new ApiError('PHOTO_PATH', '照片路径不属于本机持久目录。');
    const bytes = this.bytes(photo.path);
    if (bytes.byteLength !== photo.size || await digest(bytes) !== photo.sha256) throw new ApiError('PHOTO_INTEGRITY', '照片完整性检查失败，原稿保留，停止上传。');
    return bytes;
  }
}
