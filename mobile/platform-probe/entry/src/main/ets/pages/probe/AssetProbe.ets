import image from '@ohos.multimedia.image';
import resourceManager from '@ohos.resourceManager';
import util from '@ohos.util';
import fs from '@ohos.file.fs';
import deviceInfo from '@ohos.deviceInfo';
import { BusinessError } from '@ohos.base';
import { ArtworkEntry, ArtworkManifest, AssetResult, NativeReport, ProbeProgress } from './ProbeModels';

export interface ProbeOptions {
  resources: resourceManager.ResourceManager;
  update: (progress: ProbeProgress) => void;
}

async function decodeAsset(options: ProbeOptions, entry: ArtworkEntry, format: string): Promise<AssetResult> {
  const path = format === 'PNG' ? `design/${entry.png.path}` : `design/svg/${entry.path}`;
  let source: image.ImageSource | undefined = undefined;
  let pixels: image.PixelMap | undefined = undefined;
  try {
    const bytes = await options.resources.getRawFileContent(path);
    source = image.createImageSource(bytes.buffer);
    pixels = await source.createPixelMap();
    const info = await pixels.getImageInfo();
    const correct = info.size.width === entry.width && info.size.height === entry.height;
    return { path, format, passed: correct, width: info.size.width, height: info.size.height,
      message: correct ? 'Decoded and dimensions match' : 'Decoded, dimensions differ' };
  } catch (cause) {
    const error = cause as BusinessError;
    return { path, format, passed: false, width: 0, height: 0, message: `${error.code}: ${error.message}` };
  } finally {
    if (pixels !== undefined) await pixels.release();
    if (source !== undefined) await source.release();
  }
}

export async function runAssetProbe(options: ProbeOptions): Promise<NativeReport> {
  const bytes = await options.resources.getRawFileContent('design/manifest.json');
  const manifest = JSON.parse(util.TextDecoder.create('utf-8').decodeToString(bytes)) as ArtworkManifest;
  const progress: ProbeProgress = { completed: 0, total: manifest.assets.length * 2,
    current: '', pngPassed: 0, svgPassed: 0 };
  const results: AssetResult[] = [];
  for (const entry of manifest.assets) {
    for (const format of ['PNG', 'SVG']) {
      const result = await decodeAsset(options, entry, format);
      results.push(result);
      progress.completed++;
      progress.current = result.path;
      if (result.passed && format === 'PNG') progress.pngPassed++;
      if (result.passed && format === 'SVG') progress.svgPassed++;
      options.update({ completed: progress.completed, total: progress.total, current: progress.current,
        pngPassed: progress.pngPassed, svgPassed: progress.svgPassed });
    }
  }
  return { capturedAt: new Date().toISOString(), sdkApi: deviceInfo.sdkApiVersion,
    osFullName: deviceInfo.osFullName, scope: 'Native resource decoding probe; no business API or hardware data.',
    pngPreview: false, svgPreview: false, results };
}

export function saveReport(directory: string, report: NativeReport): string {
  const path = `${directory}/native-asset-report.json`;
  const file = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
  try {
    fs.writeSync(file.fd, JSON.stringify(report));
  } finally {
    fs.closeSync(file.fd);
  }
  return path;
}
