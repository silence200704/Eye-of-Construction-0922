import { test } from 'node:test'
import assert from 'node:assert/strict'
import { native } from '../../nativeLoader.mjs'
test('dataset selection isolates cached ownership and rejects arbitrary data sets', () => {
  const { selectedDataset, selectDataset, datasetPath } = native('core/network/DatasetSelection.ets')
  const { ownerKey } = native('core/offline/OfflineModels.ets')
  const first = ownerKey('http://localhost', 's')
  selectDataset('demo-showcase')
  assert.equal(selectedDataset(), 'demo-showcase')
  assert.equal(datasetPath('/datasets/demo-main/work-orders'), '/datasets/demo-showcase/work-orders')
  assert.notEqual(ownerKey('http://localhost', 's'), first)
  assert.throws(() => selectDataset('arbitrary'))
  selectDataset('demo-main')
})
