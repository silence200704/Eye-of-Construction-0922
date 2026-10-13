<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'default' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    disabled?: boolean
    block?: boolean
    type?: 'button' | 'submit'
  }>(),
  { variant: 'default', size: 'md', disabled: false, block: false, type: 'button' },
)
</script>

<template>
  <button
    class="btn"
    :class="[`btn--${variant}`, `btn--${size}`, { 'btn--block': block }]"
    :type="type"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: var(--h-control);
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.14s ease, border-color 0.14s ease, color 0.14s ease, transform 0.1s ease;
}

.btn--sm {
  height: var(--h-control-sm);
  padding: 0 10px;
  font-size: 12.5px;
}

.btn--block {
  width: 100%;
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.btn--primary {
  background: var(--brand-600);
  color: #fff;
}

.btn--primary:hover:not(:disabled) {
  background: var(--brand-700);
}

.btn--default {
  background: var(--paper);
  border-color: var(--line-strong);
  color: var(--text);
}

.btn--default:hover:not(:disabled) {
  border-color: var(--brand-500);
  color: var(--brand-700);
}

.btn--ghost {
  background: transparent;
  color: var(--brand-600);
}

.btn--ghost:hover:not(:disabled) {
  background: var(--brand-050);
}

.btn--danger {
  background: var(--paper);
  border-color: #e6b6b1;
  color: var(--st-red);
}

.btn--danger:hover:not(:disabled) {
  background: var(--st-red-bg);
}
.btn:active:not(:disabled) { transform: translateY(1px); }
@media (max-width:600px) { .btn { min-height: 44px; } }
@media (prefers-reduced-motion:reduce) { .btn { transition: none; }.btn:active:not(:disabled) { transform: none; } }
</style>
