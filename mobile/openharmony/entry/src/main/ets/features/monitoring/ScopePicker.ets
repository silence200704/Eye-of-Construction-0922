import { Workspace } from '../../data/models/Workspace';
import { Theme } from '../../shared/theme/Theme';

@Component
export struct ScopePicker {
  @Prop workspace: Workspace;
  @Prop buildingId: string = '';
  @Prop floorId: string = '';
  @Prop showFloor: boolean = true;
  onBuilding: (id: string) => void = () => {};
  onFloor: (id: string) => void = () => {};

  build() {
    Column({ space: 10 }) {
      Select([{ value: '全部楼栋' }, ...this.workspace.buildings.filter((row) => row.status === 'active').map((row): SelectOption => ({ value: row.name }))])
        .value(this.workspace.buildings.find((row) => row.id === this.buildingId)?.name ?? '全部楼栋')
        .onSelect((index: number) => this.onBuilding(index === 0 ? '' : this.workspace.buildings.filter((row) => row.status === 'active')[index - 1]?.id ?? ''))
        .height(50).width('100%').font({ size: 16 }).backgroundColor(Theme.surface).id('scope-building').accessibilityText('楼栋筛选');
      if (this.showFloor && this.buildingId) {
        Select([{ value: '全部楼层' }, ...this.workspace.floors.filter((row) => row.status === 'active' && row.buildingId === this.buildingId).map((row): SelectOption => ({ value: row.name }))])
          .value(this.workspace.floors.find((row) => row.id === this.floorId)?.name ?? '全部楼层')
          .onSelect((index: number) => this.onFloor(index === 0 ? '' : this.workspace.floors.filter((row) => row.status === 'active' && row.buildingId === this.buildingId)[index - 1]?.id ?? ''))
          .height(50).width('100%').font({ size: 16 }).backgroundColor(Theme.surface).id('scope-floor').accessibilityText('楼层筛选');
      }
    }.width('100%');
  }
}
