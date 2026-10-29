import { Theme } from '../../shared/theme/Theme';
import { TaskFilter } from '../../core/monitoring/Selectors';

@Component
export struct TaskFilters {
  @Prop filter: TaskFilter;
  onStatus: (value: string) => void = () => {};
  onKind: (value: string) => void = () => {};
  onDate: (value: string) => void = () => {};
  build() {
    Column({ space: 10 }) {
      Select([{ value: '全部进度' }, { value: '待检查' }, { value: '部分完成' }, { value: '已检查' }, { value: '逾期未检' }])
        .value(['全部进度', '待检查', '部分完成', '已检查', '逾期未检'][['all', 'pending', 'partial', 'checked', 'missed'].indexOf(this.filter.status)])
        .height(50).width('100%').onSelect((index: number) => this.onStatus(['all', 'pending', 'partial', 'checked', 'missed'][index]))
        .accessibilityText('任务进度筛选').id('tasks-status');
      Select([{ value: '全部检查类型' }, { value: '巡检' }, { value: '点检' }])
        .value(this.filter.kind === 'patrol' ? '巡检' : this.filter.kind === 'inspection' ? '点检' : '全部检查类型')
        .height(50).width('100%').onSelect((index: number) => this.onKind(['all', 'patrol', 'inspection'][index]))
        .accessibilityText('检查类型筛选').id('tasks-kind');
      TextInput({ text: this.filter.date, placeholder: '计划日期：YYYY-MM-DD，留空看全部' }).height(54).fontSize(15)
        .onChange(this.onDate).backgroundColor(Theme.surface).accessibilityText('任务计划日期筛选').id('tasks-date');
      if (this.filter.date && !/^\d{4}-\d{2}-\d{2}$/.test(this.filter.date)) {
        Text('请按 YYYY-MM-DD 填写日期，或清空查看全部任务。').fontSize(13).fontColor(Theme.warning);
      }
    }.width('100%');
  }
}
