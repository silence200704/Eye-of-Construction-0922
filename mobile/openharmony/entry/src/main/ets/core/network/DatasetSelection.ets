let activeDataset: string = 'demo-main';
export function selectedDataset(): string { return activeDataset; }
export function selectDataset(id: string): void {
  if (!['demo-main', 'demo-showcase'].includes(id)) throw new Error('仅支持筑瞳业务集与专用比赛演示集。');
  activeDataset = id;
}
export function datasetPath(path: string, id: string = activeDataset): string {
  return path.replace(/^\/datasets\/demo-main(?=\/|$)/, `/datasets/${id}`);
}
