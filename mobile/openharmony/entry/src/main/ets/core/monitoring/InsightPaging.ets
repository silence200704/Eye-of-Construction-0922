import { InsightCount } from '../../data/models/online/Insights';

export class InsightPage {
  items: InsightCount[] = [];
  total: number = 0;
  page: number = 0;
  pages: number = 1;
}

export function countPage(rows: InsightCount[], requestedPage: number): InsightPage {
  const ranked = rows.filter((row) => row.count > 0).sort((left, right) =>
    right.count - left.count || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const result = new InsightPage();
  result.total = ranked.length; result.pages = Math.max(1, Math.ceil(ranked.length / 20));
  result.page = Math.min(result.pages - 1, Math.max(0, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0));
  result.items = ranked.slice(result.page * 20, (result.page + 1) * 20);
  return result;
}
