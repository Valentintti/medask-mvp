import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve('dist')
const files = []
function collect(directory) {
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name)
    if (statSync(path).isDirectory()) collect(path)
    else files.push(path)
  }
}
collect(root)

const configuredKey = process.env.LLM_API_KEY?.trim()
const configuredBaseUrl = process.env.LLM_BASE_URL?.trim()
const forbidden = [
  'VITE_LLM_API_KEY',
  'TOP_SECRET_SERVER_KEY',
  'Authorization: Bearer',
  '你是MedAsk服务端的槽位提取器',
  'http://127.0.0.1',
  'https://127.0.0.1',
  'http://localhost',
  'https://localhost',
  ...(configuredKey ? [configuredKey] : []),
  ...(configuredBaseUrl ? [configuredBaseUrl] : []),
]
for (const path of files) {
  const content = readFileSync(path, 'utf8')
  if (forbidden.some((marker) => content.includes(marker))) {
    throw new Error('客户端构建包含禁止的服务端密钥或内部配置标记。')
  }
}
console.log(`Client bundle secret scan passed (${files.length} files).`)
