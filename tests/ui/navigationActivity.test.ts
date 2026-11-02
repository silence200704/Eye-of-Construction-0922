import { expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { createNavigationActivity } from "@/core/ui/navigationActivity";

it("快速切换时，被取消的旧导航不能结束最新导航的加载反馈", async () => {
  const component = { render: () => null };
  let finishA!: (value: typeof component) => void;
  let finishB!: (value: typeof component) => void;
  const loaderA = vi.fn(
    () =>
      new Promise<typeof component>((resolve) => {
        finishA = resolve;
      }),
  );
  const loaderB = vi.fn(
    () =>
      new Promise<typeof component>((resolve) => {
        finishB = resolve;
      }),
  );
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component },
      { path: "/a", component: loaderA },
      { path: "/b", component: loaderB },
    ],
  });
  await router.push("/");
  const activity = createNavigationActivity(router);
  const first = router.push("/a");
  await vi.waitFor(() => expect(loaderA).toHaveBeenCalled());
  const latest = router.push("/b");
  await vi.waitFor(() => expect(loaderB).toHaveBeenCalled());
  finishA(component);
  await first;
  expect(activity.pending.value).toBe(true);
  finishB(component);
  await latest;
  expect(activity.pending.value).toBe(false);
  activity.dispose();
});
