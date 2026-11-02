import { describe, expect, it, vi } from "vitest";
import { useFormModel } from "@/core/useForm";

describe("表单真实提交反馈", () => {
  it("请求未结束前保持pending并拒绝重复提交，完成后允许下一次提交", async () => {
    const form = useFormModel(() => []);
    let finish!: () => void;
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = form.run(action);
    expect(form.pending.value).toBe(true);
    expect(await form.run(action)).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
    finish();
    expect(await first).toBe(true);
    expect(form.pending.value).toBe(false);
    expect(await form.run(async () => {})).toBe(true);
  });

  it("失败后结束忙碌状态、展示真实错误，随后可重试", async () => {
    const form = useFormModel(() => []);
    const result = await form.run(async () => {
      throw new Error("后端不可用");
    });
    expect(result).toBe(false);
    expect(form.submitError.value).toBe("后端不可用");
    expect(form.pending.value).toBe(false);
    expect(await form.run(async () => {})).toBe(true);
    expect(form.submitError.value).toBe("");
  });
});
