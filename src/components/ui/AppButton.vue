<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'default' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    disabled?: boolean
    loading?: boolean
    block?: boolean
    type?: 'button' | 'submit'
  }>(),
  { variant: 'default', size: 'md', disabled: false, loading: false, block: false, type: 'button' },
)
</script>

<template>
  <button
    class="btn"
    :class="[`btn--${variant}`, `btn--${size}`, { 'btn--block': block }]"
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <svg v-if="loading" class="btn-spinner" width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2" opacity=".25" />
      <path d="M10 3a7 7 0 0 1 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
    <slot />
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: var(--h-control);
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast), transform var(--motion-fast), box-shadow var(--motion-fast);
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
  border-color: #0b57621f;
  box-shadow: inset 0 1px 0 #ffffff26, 0 3px 7px #0b57621a;
}

.btn--primary:hover:not(:disabled) {
  background: var(--brand-700);
  box-shadow: inset 0 1px 0 #ffffff26, 0 5px 12px #0b57622b;
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
.btn:active:not(:disabled) { transform: translateY(1px) scale(.98); }
.btn-spinner { flex: none; animation: button-spin .7s linear infinite; }
@keyframes button-spin { to { transform: rotate(360deg); } }
@media (max-width:600px) { .btn { min-height: 44px; } }
@media (prefers-reduced-motion:reduce) { .btn { transition: none; }.btn:active:not(:disabled) { transform: none; }.btn-spinner { animation: none; } }
</style>
