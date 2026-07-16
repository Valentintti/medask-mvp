import type { IntakeSession } from '../types/intake'

export function EscalationPage({ session, message, onRestart }: {
  session: IntakeSession
  message: string
  onRestart: () => void
}) {
  return (
    <main className="result-page escalation-page">
      <div className="status-icon" aria-hidden="true">!</div>
      <span className="eyebrow">MANUAL REVIEW NEEDED</span>
      <h1>请停止普通预问诊</h1>
      <p className="result-message">{message}</p>
      <div className="reason-card">
        <span>升级原因</span>
        <strong>{session.escalationReason}</strong>
      </div>
      <p className="fine-print">本提示不代表任何疾病判断。</p>
      <button onClick={onRestart}>返回首页</button>
    </main>
  )
}
