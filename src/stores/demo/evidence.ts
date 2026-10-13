import { useDemoScenarioStore } from './scenarios'

/** 问答和影像页共用素材登记口径，不把一组裂缝图借给其他测点。 */
export function evidencePreparedFor(pointId: string): boolean {
  const demo = useDemoScenarioStore()
  return pointId !== '' && demo.stateOf('mediaEvidence').ready
    && (demo.last.mediaEvidence?.anchors?.some(
      (anchor) => anchor.kind === 'point' && anchor.id === pointId,
    ) ?? false)
}
