import { Identity } from '../../data/models/Identity';
import { Theme } from '../../shared/theme/Theme';
import curves from '@ohos.curves';

@Component
export struct IdentityTile {
  @Prop identity: Identity;
  @Prop selected: boolean = false;
  @Prop busy: boolean = false;
  @StorageLink('zhutong.motion') motion: boolean = true;
  onSelect: (id: string) => void = () => {};

  build() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        Image($rawfile('playful/icons/shield.svg')).width(44).height(44).padding(10)
          .backgroundColor(this.selected ? Theme.cream : Theme.pale).borderRadius(16).accessibilityLevel('no');
        Text(this.identity.roleLabel).fontSize(15).fontWeight(FontWeight.Medium).fontColor(Theme.text).layoutWeight(1);
        if (this.selected) {
          Image($rawfile('playful/icons/check.svg')).width(20).height(20).padding(5)
            .backgroundColor('#B4DCC5').borderRadius(15).accessibilityLevel('no');
        } else {
          Circle().width(16).height(16).fill(Color.Transparent).stroke('#AEC8BB').strokeWidth(1.5);
        }
      }.padding(12).width('100%');
    }.width('100%').backgroundColor(this.selected ? '#E2F0D4' : '#FFFFFF')
      .border({ width: this.selected ? 1.8 : 1, color: this.selected ? Theme.brand : Theme.line }).borderRadius(21)
      .shadow({ radius: 0, offsetY: this.selected ? 3 : 0, color: '#CEDFC6' })
      .animation({ duration: this.motion ? 220 : 0, curve: curves.springMotion(0.35, 0.85) })
      .enabled(!this.busy).onClick(() => this.onSelect(this.identity.id)).id(`identity-${this.identity.id}`)
      .accessibilityText(`${this.identity.roleLabel}${this.selected ? '，当前身份' : ''}`);
  }
}
