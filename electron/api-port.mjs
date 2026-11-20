import net from 'node:net'

/**
 * Probe `preferredPort` on 127.0.0.1. If already bound (EADDRINUSE), log once
 * via `onFallback` and resolve an ephemeral available port instead of spawning
 * crashing backend workers one port at a time.
 */
export function probeLocalPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', (error) => {
      reject(error)
    })
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      const boundPort = address && typeof address === 'object' ? address.port : port
      server.close((closeError) => {
        if (closeError) {
          reject(closeError)
          return
        }
        resolve(boundPort)
      })
    })
  })
}

export async function resolvePackagedApiPort({
  preferredPort = 43182,
  probe = probeLocalPort,
  onFallback = () => {},
} = {}) {
  try {
    const port = await probe(preferredPort)
    return { port, fallback: false }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
      onFallback(preferredPort, error)
      const fallbackPort = await probe(0)
      return { port: fallbackPort, fallback: true }
    }
    throw error
  }
}
