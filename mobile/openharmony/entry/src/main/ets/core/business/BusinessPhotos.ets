import { DurablePhoto, DurableReader } from '../offline/queue/QueueModels';
import { TaskAccess } from '../field/TaskCommander';
import { MediaResult, PhotoLink } from '../../data/models/Reports';
import { Identity } from '../../data/models/Identity';
import { authorizationOf } from '../identity/authorization';
import { ApiError } from '../network/ApiError';

export interface BusinessPhoto extends DurablePhoto { kind: string; mediaId: string; }
export interface UploadOptions {
  access: TaskAccess; current: () => TaskAccess | null; files: DurableReader;
  save: (photo: BusinessPhoto) => Promise<void>;
  pointId?: string;
}
export async function uploadBusinessPhotos(photos: BusinessPhoto[], options: UploadOptions): Promise<PhotoLink[]> {
  const access = options.access, fingerprint = authorizationOf(access.user);
  const current = (): boolean => {
    const now = options.current();
    return now !== null && now.client === access.client && now.workspace.epoch === access.workspace.epoch && authorizationOf(now.user) === fingerprint;
  };
  for (const photo of photos) {
    if (!current()) throw new ApiError('CANCELLED', '身份变化，上传已暂停。');
    if (photo.mediaId) continue;
    const principal = await access.client.send<Identity>('/auth/me');
    if (!current() || authorizationOf(principal.data) !== fingerprint) throw new ApiError('AUTHORIZATION_CHANGED', '授权已变化。', 403);
    const bytes = await options.files.read(photo);
    if (!current()) throw new ApiError('CANCELLED', '上传已暂停。');
    const query = `fileName=${encodeURIComponent(photo.fileName)}${options.pointId ? `&pointId=${encodeURIComponent(options.pointId)}` : ''}`;
    const response = await access.client.send<MediaResult>(`/datasets/demo-main/media?${query}`, {
      method: 'POST', contentType: 'image/jpeg', body: bytes, idempotencyKey: `business-photo-${photo.draftId}`, datasetEpoch: access.workspace.epoch });
    const confirmed = await access.client.send<Identity>('/auth/me');
    if (!current() || authorizationOf(confirmed.data) !== fingerprint) throw new ApiError('AUTHORIZATION_CHANGED', '授权已变化。', 403);
    if (response.meta?.datasetEpoch !== access.workspace.epoch || response.data.sha256 !== photo.sha256 || response.data.size !== photo.size || !response.data.id) {
      throw new ApiError('INVALID_RESPONSE', '照片结果不完整，请用原照片核验。');
    }
    photo.mediaId = response.data.id; await options.save(photo);
  }
  return photos.map((photo): PhotoLink => ({ mediaId: photo.mediaId, draftId: photo.draftId, kind: photo.kind }));
}
