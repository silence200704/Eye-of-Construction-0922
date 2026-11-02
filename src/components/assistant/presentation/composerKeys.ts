/** IME confirmation and Shift+Enter must never accidentally submit a question. */
export function submitsQuestion(event: {
  key: string
  shiftKey: boolean
  isComposing: boolean
  keyCode?: number
}): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229
}
