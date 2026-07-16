import { spawn } from 'node:child_process'

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const children = [
  spawn(command, ['dev:server'], { stdio: 'inherit' }),
  spawn(command, ['dev:client'], { stdio: 'inherit' }),
]

let stopping = false
function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill()
  process.exitCode = exitCode
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!stopping && code !== 0) stop(code ?? 1)
  })
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
