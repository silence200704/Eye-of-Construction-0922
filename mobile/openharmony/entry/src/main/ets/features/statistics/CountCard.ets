import { InsightCount } from '../../data/models/online/Insights';
import { InsightPage, countPage } from '../../core/monitoring/InsightPaging';
import { Theme } from '../../shared/theme/Theme';
import { AppCard } from '../../shared/components/AppCard';
import { PlayButton } from '../../shared/playful/PlayButton';
import { label } from '../../shared/format/display';

@Component
export struct CountCard {
  @Prop title: string;
  @Prop @Watch('resetPage') rows: InsightCount[] = [];
  @Prop types: boolean = false;
  @Prop controlId: string = '';
  @State listing: InsightPage = new InsightPage();
  aboutToAppear(): void { this.resetPage(); }
  resetPage(): void { this.listing = countPage(this.rows, 0); }
  move(delta: number): void { this.listing = countPage(this.rows, this.listing.page + delta); }

  build() {
    AppCard() {
      Text(this.title).fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.text);
      ForEach(this.listing.items, (row: InsightCount) => {
        Row({ space: 12 }) {
          Text(this.types ? label(row.label) : row.label).fontSize(15).fontColor(Theme.text).layoutWeight(1);
          Text(String(row.count)).fontSize(20).fontWeight(FontWeight.Bold).fontColor(Theme.brand);
        }.width('100%').padding({ top: 7, bottom: 7 }).accessibilityGroup(true)
          .accessibilityText(`${this.types ? label(row.label) : row.label}，${row.count}`);
      }, (row: InsightCount) => row.id);
      if (!this.listing.total) {
        Text(this.types ? '当前范围暂无在用传感器测点。' : '本期没有触发预警的对象。').fontSize(15).fontColor(Theme.secondary);
      }
      if (this.listing.pages > 1) {
        Text(`共${this.listing.total}项 · 第${this.listing.page + 1}/${this.listing.pages}页 · 每页20项`)
          .fontSize(14).fontColor(Theme.secondary).id(`${this.controlId}-page`);
        Row({ space: 12 }) {
          PlayButton({ title: '上一页', secondary: true, available: this.listing.page > 0,
            controlId: `${this.controlId}-previous`, onAction: () => this.move(-1) }).layoutWeight(1);
          PlayButton({ title: '下一页', secondary: true, available: this.listing.page + 1 < this.listing.pages,
            controlId: `${this.controlId}-next`, onAction: () => this.move(1) }).layoutWeight(1);
        }.width('100%');
      }
      if (!this.types) {
        Text('按预警频次从高到低排列，仅展示本期触发过预警的对象；没有预警不等于已确认安全。')
          .fontSize(12).fontColor(Theme.secondary);
      }
    }
  }
}
