/**
 * Fixed-port discovery for the browser extension.
 *
 * The desktop app binds its web server to a random loopback port, so the
 * extension's zero-config probe cannot guess where the bridge lives. This
 * listener answers `/ext/bridge-config` on a well-known port and points at the
 * real one, which is what makes discovery work without the user pasting an
 * address after every restart.
 *
 * When the web server itself already owns that port, `listen` fails with
 * `EADDRINUSE` and the app's own `/ext/bridge-config` route answers the same
 * request — either way discovery succeeds.
 *
 * @module @yuxianglin/dsh-bridge-browser/src/discovery
 */

import { createServer, type Server } from 'node:http'

/**
 * Discovery port the extension probes.
 *
 * Matches the address the desktop documentation recommends pinning the app to,
 * so a deployment that does pin it serves discovery from its own web server and
 * this listener steps aside.
 */
export const DISCOVERY_PORT = 43189

/** Everything the listener needs from its owning plugin. */
export interface DiscoveryServerOptions {
  /** Path whose answer the extension expects. */
  configPath: string
  /** The bridge WebSocket URL to advertise; read per request, not at start. */
  bridgeWsUrl: () => string
  /** Port to claim; defaults to {@link DISCOVERY_PORT}. */
  port?: number
  /** Loopback interface to bind; defaults to `127.0.0.1`. */
  host?: string
  /** Called once when the port cannot be claimed; the listener closes itself. */
  onError?: (error: Error) => void
}

/**
 * Start the fixed-port discovery listener.
 *
 * @param options - bridge URL source, path, and port
 * @returns the listening server (closing it releases the port)
 */
export function startDiscoveryServer(options: DiscoveryServerOptions): Server {
  const server = createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0]
    if (path !== options.configPath) {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
      return
    }
    // No secret here: the URL is the same one the web server publishes, and the
    // bridge still authenticates non-loopback clients by token.
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ wsUrl: options.bridgeWsUrl() }))
  })
  server.once('error', (error: Error) => {
    options.onError?.(error)
    server.close()
  })
  server.listen(options.port ?? DISCOVERY_PORT, options.host ?? '127.0.0.1')
  return server
}
