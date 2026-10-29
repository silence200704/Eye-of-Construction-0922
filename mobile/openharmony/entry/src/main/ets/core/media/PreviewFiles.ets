import fs from '@ohos.file.fs';
import fileUri from '@ohos.file.fileuri';
import { PreviewFiles } from './PhotoReader';
import { ApiError } from '../network/ApiError';

export class SandboxPreviewFiles implements PreviewFiles {
  private directory: string;
  private paths: Map<string, string> = new Map();
  constructor(cacheDir: string) { this.directory = `${cacheDir}/protected-photos`; }
  write(bytes: ArrayBuffer): string {
    const path = `${this.directory}/preview-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    try {
      if (!fs.accessSync(this.directory)) fs.mkdirSync(this.directory, true);
      const file = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
      try {
        if (fs.writeSync(file.fd, bytes) !== bytes.byteLength) throw new Error('Incomplete photo cache write');
      } finally { fs.closeSync(file); }
      const uri = fileUri.getUriFromPath(path); this.paths.set(uri, path); return uri;
    } catch (_) {
      this.removePath(path);
      throw new ApiError('PHOTO_CACHE_FAILED', '照片预览暂不可用，请重新打开重试；仍失败请重启应用。');
    }
  }
  private removePath(path: string): void {
    try { fs.unlinkSync(path); } catch (_) { /* Missing or unwritable files need no further cleanup. */ }
  }
  remove(uri: string): void {
    const path = this.paths.get(uri); if (!path) return;
    this.paths.delete(uri); this.removePath(path);
  }
}
