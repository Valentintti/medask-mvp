import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, isAbsolute, relative, resolve } from 'node:path'

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
}

function safeHeaders(contentType: string, contentLength: number): Record<string, string | number> {
  return {
    'Content-Type': contentType,
    'Content-Length': contentLength,
    'Cache-Control': contentType.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  }
}

function sendText(response: ServerResponse, status: number, message: string): void {
  const body = Buffer.from(message, 'utf8')
  response.writeHead(status, safeHeaders('text/plain; charset=utf-8', body.length))
  response.end(body)
}

/**
 * 解码并校验请求路径。任何原始或多层编码的上级目录片段都会被拒绝，
 * 避免 URL 规范化在安全检查前吞掉 `..`。
 */
export function safeRequestPath(rawUrl: string | undefined): string | null {
  const rawPath = (rawUrl ?? '/').split(/[?#]/u, 1)[0] || '/'
  if (!rawPath.startsWith('/') || rawPath.includes('\0')) return null
  let decoded = rawPath
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    }
  } catch {
    return null
  }
  const slashNormalized = decoded.replace(/\\/gu, '/')
  if (slashNormalized.split('/').some((segment) => segment === '..')) return null
  return slashNormalized
}

function fileWithinRoot(root: string, requestPath: string): string | null {
  const target = resolve(root, requestPath.replace(/^\/+/, ''))
  const relativePath = relative(root, target)
  return relativePath.startsWith('..') || isAbsolute(relativePath) ? null : target
}

async function readStaticFile(root: string, requestPath: string): Promise<Buffer | null> {
  const target = fileWithinRoot(root, requestPath)
  if (!target) return null
  try {
    return await readFile(target)
  } catch {
    return null
  }
}

export async function serveStaticRequest(
  request: IncomingMessage,
  response: ServerResponse,
  staticRoot: string,
  requestPath: string,
): Promise<void> {
  const requestedFile = requestPath === '/' ? '/index.html' : requestPath
  let body = await readStaticFile(staticRoot, requestedFile)
  let servedPath = requestedFile

  if (!body && extname(requestedFile) === '') {
    servedPath = '/index.html'
    body = await readStaticFile(staticRoot, servedPath)
  }
  if (!body) {
    sendText(response, 404, 'Not Found')
    return
  }

  const contentType = MIME_TYPES[extname(servedPath).toLowerCase()] ?? 'application/octet-stream'
  response.writeHead(200, safeHeaders(contentType, body.length))
  response.end(request.method === 'HEAD' ? undefined : body)
}
