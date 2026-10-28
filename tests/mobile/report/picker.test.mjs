import assert from 'node:assert/strict'
import { test } from 'node:test'
import { native, nativeModules } from '../nativeLoader.mjs'
let released = 0, closed = 0, cancelled = false, denied = false
const writes = []
nativeModules.set('@ohos.file.photoAccessHelper', {
 PhotoViewMIMETypes: { IMAGE_TYPE: 'image/*' }, PhotoSelectOptions: class {},
 PhotoViewPicker: class { async select() { if (denied) throw Error('denied'); return { photoUris: cancelled ? [] : ['file://gallery/image'] } } },
})
nativeModules.set('@ohos.multimedia.cameraPicker', { PickerMediaType: { PHOTO: 'photo' }, pick: async () => ({ resultCode: 0, resultUri: 'file://camera/photo' }) })
nativeModules.set('@ohos.multimedia.camera', { CameraPosition: { CAMERA_POSITION_BACK: 1 } })
nativeModules.set('@ohos.file.fs', { OpenMode: { READ_ONLY: 0, READ_WRITE: 2, CREATE: 64, TRUNC: 512 },
 openSync: () => ({fd: 4}), closeSync: () => { closed++ }, writeSync: (fd, data) => writes.push(data), unlinkSync: () => {} })
nativeModules.set('@ohos.file.fileuri', { getUriFromPath: path => `file://${path}` })
nativeModules.set('@ohos.multimedia.image', { PropertyKey: { ORIENTATION: 'Orientation' },
 createImageSource: () => ({ getImageInfo: async () => ({size:{width:4000,height:3000}}), getImageProperty: async () => '1',
 createPixelMap: async () => ({ release: async () => { released++ }, rotate: async () => {}, flip: async () => {} }), release: async () => {released++} }),
 createImagePacker: () => ({ packing: async () => new Uint8Array([255,216,255,217]).buffer, release: async () => {released++} }),
})
const { PhotoSelector } = native('core/media/PhotoSelector.ets')

test('native picker cancel yields no fabricated photo; selected bytes are compressed and resources closed', async () => {
 const selector = new PhotoSelector({ cacheDir: '/cache' })
 cancelled = true; assert.equal(await selector.choose('album'), null)
 cancelled = false; const photo = await selector.choose('album')
 assert.equal(photo.mimeType, 'image/jpeg'); assert.equal(photo.source, 'album')
 assert.ok(photo.uri.startsWith('file:///cache/zt-report-')); assert.equal(photo.bytes.byteLength, 4)
 assert.equal(writes.length, 1); assert.ok(released >= 3); assert.equal(closed, 2)
})

test('native camera uses the system picker; denied selection stays explicit', async () => {
 const selector = new PhotoSelector({ cacheDir: '/cache' })
 assert.equal((await selector.choose('camera')).source, 'camera')
 denied = true; await assert.rejects(selector.choose('album'), /权限|拒绝|取消/); denied = false
})
