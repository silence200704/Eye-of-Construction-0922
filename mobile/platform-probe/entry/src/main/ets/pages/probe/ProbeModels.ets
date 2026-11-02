export interface PngExport {
  path: string;
}

export interface ArtworkEntry {
  path: string;
  width: number;
  height: number;
  png: PngExport;
}

export interface ArtworkManifest {
  assets: ArtworkEntry[];
}

export interface AssetResult {
  path: string;
  format: string;
  passed: boolean;
  width: number;
  height: number;
  message: string;
}

export interface ProbeProgress {
  completed: number;
  total: number;
  current: string;
  pngPassed: number;
  svgPassed: number;
}

export interface NativeReport {
  capturedAt: string;
  sdkApi: number;
  osFullName: string;
  scope: string;
  pngPreview: boolean;
  svgPreview: boolean;
  results: AssetResult[];
}

export interface CapabilityCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface CapabilityReport {
  capturedAt: string;
  scope: string;
  endpoint: string;
  previousRun: number;
  persistedRun: number;
  checks: CapabilityCheck[];
}
