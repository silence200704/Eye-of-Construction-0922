import { native } from './nativeLoader.mjs'

export const { WorkspaceController } = native('core/identity/WorkspaceController.ets')
export const { ApiError } = native('core/network/ApiError.ets')

export function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

export const roles = ['safety', 'property', 'device', 'inspector', 'repair']

export function identity(role = 'safety') {
  return { id: `demo-${role}`, name: role, role, roleLabel: role, buildingIds: role === 'device' ? ['B2'] : null }
}

export function archive(role = 'safety') {
  const buildingId = role === 'device' ? 'B2' : 'B1'
  return { epoch: 1, buildings: [{ id: buildingId }], floors: [], devices: [],
    points: [{ id: `point-${role}`, buildingId, status: 'active' }] }
}

export class FakeServer {
  calls = []
  intercept = null
  directory = roles.map(identity)
  principal = null

  async send(settings, path, options) {
    const role = settings.token.replace('token-', '') || 'safety'
    const call = { settings, path, options, role }
    this.calls.push(call)
    if (this.intercept) {
      const response = this.intercept(call)
      if (response !== undefined) return response
    }
    let data
    if (path === '/demo/identities') data = this.directory
    else if (path === '/demo/identity') {
      const selected = JSON.parse(options.body).identityId.replace('demo-', '')
      data = { accessToken: `token-${selected}`, user: identity(selected), expiresAt: 9999999999 }
    } else if (path === '/auth/me') data = this.principal ?? identity(role)
    else if (path.endsWith('/archive')) data = archive(role)
    else data = []
    return { ok: true, data, meta: { datasetEpoch: 1 } }
  }
}

export function fixture(options = {}) {
  const server = new FakeServer()
  const frames = []
  const saved = []
  const clients = []
  const controller = new WorkspaceController({
    storage: options.storage ?? {
      load: async () => ({ baseUrl: '', identityId: '' }),
      save: async value => saved.push(value),
    },
    createClient: settings => {
      const client = { settings, cancelled: false,
        send: (path, input) => server.send(settings, path, input),
        cancel: () => { client.cancelled = true },
      }
      clients.push(client)
      return client
    },
    onChange: state => frames.push(state),
    onReset: () => {},
  })
  return { controller, server, frames, saved, clients, current: () => frames.at(-1) }
}
