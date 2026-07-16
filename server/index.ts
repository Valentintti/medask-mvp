import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { loadServerConfig } from './config'
import { OpenAiCompatibleProvider } from './providers/openAiCompatibleProvider'
import { createLlmRouter } from './routes/llmRoutes'
import { MAX_REQUEST_BODY_BYTES } from './security/requestSanitizer'
import type { RouteResponse, ServerConfig, ServerLlmProvider } from './types'

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []; let size = 0; let tooLarge = false
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_REQUEST_BODY_BYTES) { tooLarge = true; return }
      chunks.push(chunk)
    })
    request.on('end', () => tooLarge ? reject(new Error('request_too_large')) : resolveBody(Buffer.concat(chunks).toString('utf8')))
    request.on('error', () => reject(new Error('request_read_error')))
  })
}

function send(response: ServerResponse, routeResponse: RouteResponse): void {
  response.writeHead(routeResponse.status, routeResponse.headers)
  response.end(routeResponse.body === null ? undefined : JSON.stringify(routeResponse.body))
}

export function createMedAskServer(config: ServerConfig = loadServerConfig(), providerOverride?: ServerLlmProvider | null) {
  const provider = providerOverride === undefined && config.configured
    ? new OpenAiCompatibleProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        requestTimeoutMs: config.requestTimeoutMs,
        deepSeekStrictToolEnabled: config.deepSeekStrictToolEnabled,
      })
    : providerOverride ?? null
  const route = createLlmRouter({ config, provider })
  const hashSalt = randomBytes(32)
  const clientKey = (request: IncomingMessage): string => {
    const address = request.socket.remoteAddress ?? 'unknown'
    return createHash('sha256').update(hashSalt).update(address).digest('hex')
  }

  return createServer(async (request, response) => {
    const controller = new AbortController()
    request.on('aborted', () => controller.abort(new Error('client_aborted')))
    try {
      const path = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`).pathname
      if (request.method === 'GET' && path === '/health') {
        send(response, {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
          body: { status: 'ok' },
        })
        return
      }
      const bodyText = ['POST', 'PUT', 'PATCH'].includes(request.method ?? '') ? await readBody(request) : ''
      send(response, await route({
        method: request.method ?? 'GET', path, origin: request.headers.origin ?? null,
        contentType: request.headers['content-type'] ?? null,
        clientKey: clientKey(request), bodyText, signal: controller.signal,
      }))
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'request_too_large'
      send(response, {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
        body: { error: { code: tooLarge ? 'request_too_large' : 'request_invalid', message: '请求无法处理，请使用标准问题继续。' } },
      })
    }
  })
}

const isMain = process.argv[1] ? fileURLToPath(import.meta.url) === resolve(process.argv[1]) : false
if (isMain) {
  const config = loadServerConfig()
  const server = createMedAskServer(config)
  server.listen(config.port, config.host, () => {
    console.info(JSON.stringify({ event: 'server_started', host: config.host, port: config.port, realLlmEnabled: config.enabled && config.configured }))
  })
  const shutdown = () => server.close(() => { process.exitCode = 0 })
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
