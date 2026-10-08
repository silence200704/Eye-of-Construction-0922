export type RunStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'failed' | 'completed'
export interface RunnerState { next: number; status: RunStatus; error: string }
export interface RunStep { id: string; run: () => Promise<void> }
interface RunnerOptions {
  steps: RunStep[]
  saved?: { next: number; status: RunStatus }
  changed?: (state: RunnerState) => void
}

/** 只管理事务边界；步骤必须通过原业务接口实现幂等，不在这里修改领域状态。 */
export function createRunner(options: RunnerOptions) {
  const next = Math.max(0, Math.min(options.steps.length, options.saved?.next ?? 0))
  const state: RunnerState = {
    next, error: '',
    status: options.saved === undefined ? 'idle' : options.saved.status === 'completed' ? 'completed' : 'paused',
  }
  let active: Promise<void> | null = null
  let requested: 'paused' | 'stopped' | null = null
  const publish = () => options.changed?.({ ...state })

  async function execute(): Promise<void> {
    state.status = 'running'
    state.error = ''
    publish()
    try {
      while (state.next < options.steps.length && requested === null) {
        await options.steps[state.next]!.run()
        state.next += 1
        publish()
      }
      state.status = requested ?? 'completed'
    } catch (cause) {
      state.status = 'failed'
      state.error = cause instanceof Error ? cause.message : String(cause)
    }
    publish()
  }

  function start(): Promise<void> {
    if (active !== null) return active
    if (state.status === 'completed') return Promise.resolve()
    requested = null
    active = execute().finally(() => { active = null })
    return active
  }

  async function suspend(status: 'paused' | 'stopped'): Promise<void> {
    requested = status
    if (active !== null) await active
    else { state.status = status; publish() }
  }

  return { state, start, pause: () => suspend('paused'), stop: () => suspend('stopped') }
}
