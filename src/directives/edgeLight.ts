/** Pointer-following rim light. One frame per active surface; no background animation loop. */
import type { ObjectDirective } from "vue";

const disposers = new WeakMap<HTMLElement, () => void>();

function attach(target: HTMLElement): () => void {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  let frame = 0;
  let point = { x: 0, y: 0 };

  function paint(): void {
    frame = 0;
    const rect = target.getBoundingClientRect();
    target.style.setProperty("--edge-x", `${point.x - rect.left}px`);
    target.style.setProperty("--edge-y", `${point.y - rect.top}px`);
    target.classList.add("edge-surface--active");
  }

  function move(event: PointerEvent): void {
    if (
      event.pointerType === "touch" ||
      reduced.matches ||
      !finePointer.matches
    )
      return;
    point = { x: event.clientX, y: event.clientY };
    if (frame === 0) frame = window.requestAnimationFrame(paint);
  }

  function clear(): void {
    window.cancelAnimationFrame(frame);
    frame = 0;
    target.classList.remove("edge-surface--active");
  }

  target.classList.add("edge-surface");
  target.addEventListener("pointermove", move, { passive: true });
  target.addEventListener("pointerleave", clear);
  target.addEventListener("pointercancel", clear);
  return () => {
    clear();
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerleave", clear);
    target.removeEventListener("pointercancel", clear);
  };
}

export const vEdgeLight: ObjectDirective<HTMLElement> = {
  mounted(target) {
    disposers.set(target, attach(target));
  },
  beforeUnmount(target) {
    disposers.get(target)?.();
    disposers.delete(target);
  },
};
