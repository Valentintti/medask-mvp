// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadServerConfig } from '../../server/config'
import { createMedAskServer } from '../../server/index'
import type { ServerConfig } from '../../server/types'

const disabledConfig: ServerConfig = {
  enabled: false,
  configured: false,
  apiKey: '',
  baseUrl: '',
  model: '',
  requestTimeoutMs: 50,
  maxRequestsPerMinute: 10,
  dailyTokenBudget: 50_000,
  allowedOrigins: new Set(['http://127.0.0.1:8787']),
  host: '127.0.0.1',
  port: 8787,
  deepSeekStrictToolEnabled: false,
}

function rawGet(port: number, path: string): Promise<{ status: number; body: string; contentType: string }> {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => resolveRequest({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
        contentType: String(response.headers['content-type'] ?? ''),
      }))
    })
    request.on('error', rejectRequest)
    request.end()
  })
}

describe('Render 单服务静态页面与 API 路由', () => {
  const staticRoot = mkdtempSync(join(tmpdir(), 'medask-static-'))
  const assetsRoot = join(staticRoot, 'assets')
  const server = createMedAskServer(disabledConfig, null, staticRoot)
  let port = 0

  beforeAll(async () => {
    mkdirSync(assetsRoot)
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><main>railpack-spa</main>')
    writeFileSync(join(assetsRoot, 'app.js'), 'console.log("asset")')
    writeFileSync(join(assetsRoot, 'app.css'), 'main{display:block}')
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    rmSync(staticRoot, { recursive: true, force: true })
  })

  it('/health 返回 200', async () => {
    const response = await rawGet(port, '/health')
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ status: 'ok' })
  })

  it('首页由 Node 服务返回 index.html', async () => {
    const response = await rawGet(port, '/')
    expect(response.status).toBe(200)
    expect(response.contentType).toContain('text/html')
    expect(response.body).toContain('railpack-spa')
  })

  it('静态 JS 和 CSS 可访问并使用正确 MIME', async () => {
    const script = await rawGet(port, '/assets/app.js')
    const style = await rawGet(port, '/assets/app.css')
    expect(script).toMatchObject({ status: 200, body: 'console.log("asset")' })
    expect(script.contentType).toContain('text/javascript')
    expect(style).toMatchObject({ status: 200, body: 'main{display:block}' })
    expect(style.contentType).toContain('text/css')
  })

  it('SPA 未知前端路由回退 index.html', async () => {
    const response = await rawGet(port, '/intake/session/demo')
    expect(response.status).toBe(200)
    expect(response.body).toContain('railpack-spa')
  })

  it('未知 /api 路由不回退 index.html', async () => {
    const response = await rawGet(port, '/api/not-found')
    expect(response.status).toBe(404)
    expect(response.contentType).toContain('application/json')
    expect(response.body).not.toContain('railpack-spa')
  })

  it('拒绝原始路径穿越', async () => {
    const response = await rawGet(port, '/../secret.txt')
    expect(response.status).toBe(400)
    expect(response.body).not.toContain(staticRoot)
  })

  it('拒绝 URL 编码路径穿越', async () => {
    const response = await rawGet(port, '/%2e%2e%2fsecret.txt')
    expect(response.status).toBe(400)
    expect(response.body).not.toContain(staticRoot)
  })

  it('服务端读取 PORT 且 HOST 默认为 0.0.0.0', () => {
    const config = loadServerConfig({ PORT: '4567' }, 'Z:\\missing-medask-config')
    expect(config.port).toBe(4567)
    expect(config.host).toBe('0.0.0.0')
  })
})
