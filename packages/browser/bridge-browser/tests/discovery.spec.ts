import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DISCOVERY_PORT, startDiscoveryServer } from '../src/discovery.ts'

const CONFIG_PATH = '/ext/bridge-config'
const started: Array<{ close: () => void }> = []

afterEach(() => {
  for (const server of started.splice(0)) server.close()
})

/** Start a listener on an ephemeral port and wait until it accepts requests. */
async function listen(options: { payload: () => Record<string, unknown>; port?: number }): Promise<{ port: number }> {
  const server = startDiscoveryServer({ configPath: CONFIG_PATH, port: 0, ...options })
  started.push(server)
  await new Promise((resolve) => { server.once('listening', resolve) })
  return { port: (server.address() as AddressInfo).port }
}

describe('fixed-port discovery listener', () => {
  it('uses the port the extension probes for the desktop app', () => {
    expect(DISCOVERY_PORT).toBe(43189)
  })

  it('answers the discovery path with the bridge websocket URL', async () => {
    const { port } = await listen({ payload: () => ({ wsUrl: 'ws://127.0.0.1:51015/ext/bridge' }) })

    const response = await fetch(`http://127.0.0.1:${port}${CONFIG_PATH}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ wsUrl: 'ws://127.0.0.1:51015/ext/bridge' })
  })

  it('reads the URL per request, so a port that settles later is still reported', async () => {
    let wsUrl = 'ws://127.0.0.1:0/ext/bridge'
    const { port } = await listen({ payload: () => ({ wsUrl }) })
    wsUrl = 'ws://127.0.0.1:51015/ext/bridge'

    const body = await (await fetch(`http://127.0.0.1:${port}${CONFIG_PATH}?probe=1`)).json()

    expect(body.wsUrl).toBe('ws://127.0.0.1:51015/ext/bridge')
  })

  it('rejects any other path', async () => {
    const { port } = await listen({ payload: () => ({ wsUrl: 'ws://127.0.0.1:51015/ext/bridge' }) })

    const response = await fetch(`http://127.0.0.1:${port}/ext/other`)

    expect(response.status).toBe(404)
  })

  it('reports a taken port once and releases itself', async () => {
    const { port } = await listen({ payload: () => ({ wsUrl: 'ws://127.0.0.1:51015/ext/bridge' }) })
    const onError = vi.fn()

    const conflicting = startDiscoveryServer({
      configPath: CONFIG_PATH,
      payload: () => ({ wsUrl: 'ws://127.0.0.1:51015/ext/bridge' }),
      port,
      onError,
    })
    started.push(conflicting)
    await new Promise((resolve) => { setTimeout(resolve, 100) })

    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0]?.[0] as NodeJS.ErrnoException).code).toBe('EADDRINUSE')
  })
})
