import { describe, expect, it } from 'vitest'
import { answerFailure, isModuleLoadFailure } from '@/core/app/loadFailure'
import viteConfig from '../../vite.config'

describe('旧页面模块资源失效', () => {
  it.each([
    'Failed to fetch dynamically imported module: http://127.0.0.1:4173/assets/task-old.js',
    'error loading dynamically imported module: http://localhost/assets/task-old.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/preview-old.css',
    'Loading chunk 2 failed.',
    'Loading CSS chunk 2 failed.',
  ])('模块错误给出刷新操作，不误导用户重复发送：%s', message => {
    expect(isModuleLoadFailure(new Error(message))).toBe(true)
    const failure = answerFailure(message)
    expect(failure.reload).toBe(true)
    expect(failure.message).toContain('刷新加载新版')
    expect(failure.message).not.toContain('发送重试')
    expect(failure.message).not.toContain('/assets/')
  })

  it('业务失败仍允许重试，不当作页面更新', () => {
    expect(answerFailure('裂缝测点未在册')).toEqual({ message: '读取失败：裂缝测点未在册（可点发送重试）', reload: false })
    expect(isModuleLoadFailure(undefined)).toBe(false)
  })

  it('构建保留旧hash资源，未刷新的演示页仍能加载懒模块', () => {
    expect(viteConfig.build?.emptyOutDir).toBe(false)
  })
})
