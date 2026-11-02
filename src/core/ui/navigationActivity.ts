/** Navigation feedback follows router completion, never a decorative timer. */
import { ref } from "vue";
import {
  isNavigationFailure,
  NavigationFailureType,
  type Router,
} from "vue-router";

export function createNavigationActivity(router: Router) {
  const pending = ref(false);
  let active: object | null = null;
  const offStart = router.beforeEach((to) => {
    active = to;
    pending.value = true;
  });
  function settle(to: object): void {
    if (active !== to) return;
    active = null;
    pending.value = false;
  }
  const offFinish = router.afterEach((to, _from, failure) => {
    if (isNavigationFailure(failure, NavigationFailureType.duplicated)) {
      active = null;
      pending.value = false;
    } else settle(to);
  });
  const offError = router.onError((_error, to) => settle(to));
  function dispose(): void {
    offStart();
    offFinish();
    offError();
  }
  return { pending, dispose };
}
