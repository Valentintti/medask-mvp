import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ServerConfig } from './types'

const LOCAL_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173']
function readDotEnv(cwd: string): Record<string, string> {
  const path = resolve(cwd, '.env')
  if (!existsSync(path)) return {}
  const values: Record<string, string> = {}
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    values[key] = value
  }
  return values
}
function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}
function validBaseUrl(value: string): string {
  if (!value) return ''
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? value.replace(/\/+$/u, '') : '' } catch { return '' }
}
export function loadServerConfig(environment: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): ServerConfig {
  const file = readDotEnv(cwd)
  const value = (key: string): string => environment[key] ?? file[key] ?? ''
  const baseUrl = validBaseUrl(value('LLM_BASE_URL').trim())
  const apiKey = value('LLM_API_KEY').trim()
  const model = value('LLM_MODEL').trim()
  const configuredOrigins = (value('ALLOWED_ORIGINS') || LOCAL_ORIGINS.join(',')).split(',').map((item) => item.trim()).filter(Boolean)
  return {
    enabled: value('ENABLE_REAL_LLM').trim().toLowerCase() === 'true', configured: Boolean(apiKey && baseUrl && model),
    apiKey, baseUrl, model,
    requestTimeoutMs: integer(value('LLM_REQUEST_TIMEOUT_MS'), 8000, 500, 30000),
    maxRequestsPerMinute: integer(value('LLM_MAX_REQUESTS_PER_MINUTE'), 10, 1, 120),
    dailyTokenBudget: integer(value('LLM_DAILY_TOKEN_BUDGET'), 50000, 1000, 10_000_000),
    allowedOrigins: new Set(configuredOrigins),
    host: value('HOST').trim() || value('LLM_SERVER_HOST').trim() || '127.0.0.1',
    port: integer(value('PORT') || value('LLM_SERVER_PORT'), 8787, 1, 65535),
    deepSeekStrictToolEnabled: value('DEEPSEEK_STRICT_TOOL_ENABLED').trim().toLowerCase() === 'true',
  }
}
export function publicLlmStatus(config: ServerConfig, providerAvailable: boolean): {
  realLlmEnabled: boolean; serviceAvailable: boolean; schemaVersion: '1.1'
} {
  return {
    realLlmEnabled: config.enabled,
    serviceAvailable: config.enabled && config.configured && providerAvailable,
    schemaVersion: '1.1',
  }
}
