import fs from '@ohos.file.fs';
import fileUri from '@ohos.file.fileuri';
import { PreviewFiles } from './PhotoReader';

export class SandboxPreviewFiles implements PreviewFiles {
  private directory: string;
  private paths: Map<string, string> = new Map();
  constructor(cacheDir: string) { this.directory = `${cacheDir}/protected-photos`; }
  write(bytes: ArrayBuffer): string {
    fs.mkdirSync(this.directory, true);
    const path = `${this.directory}/preview-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const file = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
    try { fs.writeSync(file.fd, bytes); } finally { fs.closeSync(file); }
    const uri = fileUri.getUriFromPath(path); this.paths.set(uri, path); return uri;
  }
  remove(uri: string): void {
    const path = this.paths.get(uri); if (!path) return;
    this.paths.delete(uri); try { fs.unlinkSync(path); } catch (_) { /* Already removed by sandbox cleanup. */ }
  }
}
