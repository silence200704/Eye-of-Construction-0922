import { describe, expect, it } from 'vitest'
import { submitsQuestion } from '../../src/components/assistant/presentation/composerKeys'

describe('assistant composer keyboard', () => {
  it('sends Enter, while allowing a line break with Shift', () => {
    expect(submitsQuestion({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true)
    expect(submitsQuestion({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false)
    expect(submitsQuestion({ key: 'a', shiftKey: false, isComposing: false })).toBe(false)
  })

  it('does not send while confirming a Chinese input composition', () => {
    expect(submitsQuestion({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false)
    expect(submitsQuestion({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 229 })).toBe(false)
  })
})
