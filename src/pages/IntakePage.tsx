import { QuestionCard } from '../components/QuestionCard'
import type { AnswerValue, IntakeSession, SlotDefinition } from '../types/intake'

interface IntakePageProps {
  session: IntakeSession
  question: SlotDefinition
  onAnswer: (value: AnswerValue) => void
  onSkip: () => void
}

export function IntakePage({ session, question, onAnswer, onSkip }: IntakePageProps) {
  return (
    <main className="intake-page">
      <header className="session-header">
        <div>
          <span className="eyebrow">INFORMATION COLLECTION</span>
          <h1>预问诊信息整理</h1>
        </div>
        <div className="turn-counter" aria-label="问诊轮次">
          <strong>{session.turnCount + 1}</strong>
          <span>/ {session.maxTurns} 轮</span>
        </div>
      </header>

      <div className="complaint-pills">
        {session.chiefComplaints.map((complaint) => (
          <span key={complaint}>{complaint === 'fever' ? '发热' : '咳嗽'}</span>
        ))}
      </div>

      <div className="chat-context">
        <div className="assistant-avatar">M</div>
        <p>我只会按固定规则追问必要信息。遇到风险表达会停止普通流程。</p>
      </div>

      <QuestionCard slot={question} onAnswer={onAnswer} onSkip={onSkip} />
    </main>
  )
}
