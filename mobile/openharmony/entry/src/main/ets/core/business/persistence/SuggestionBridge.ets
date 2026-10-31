import { BusinessStore } from '../BusinessStore';
import { BusinessDraft } from '../BusinessDraft';
import { BusinessPhoto } from '../BusinessPhotos';
interface SuggestionForm { draft: BusinessDraft; photos: BusinessPhoto[]; }
export async function applyBusinessSuggestion(store: BusinessStore, scope: string, target: string, text: string): Promise<BusinessDraft> {
  if (await store.pending(scope)) throw new Error('有办理结果待核验，暂不修改草稿。');
  const raw = await store.form(scope, target);
  if (!raw) throw new Error('草稿已提交或已入队，请先打开新的办理草稿。');
  const saved = JSON.parse(raw) as SuggestionForm, draft = saved.draft;
  const suggestion = text.trim().slice(0, 4000);
  if (draft.kind === 'order' && draft.action === 'submitted') draft.measures = [draft.measures.trim(), suggestion].filter((value) => !!value).join('\n').slice(0, 4000);
  else if (draft.kind === 'report' && !draft.description.trim()) draft.description = suggestion;
  else draft.note = [draft.note.trim(), suggestion].filter((value) => !!value).join('\n').slice(0, 4000);
  await store.saveForm(scope, target, JSON.stringify(saved)); return draft;
}
