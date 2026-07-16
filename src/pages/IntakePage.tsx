import { QuestionCard } from '../components/QuestionCard'
import { FreeTextAnswer } from '../components/FreeTextAnswer'
import type { AnswerValue, IntakeSession, SlotDefinition } from '../types/intake'

interface IntakePageProps {
  session: IntakeSession
  question: SlotDefinition
  onAnswer: (value: AnswerValue) => void
  onSkip: () => void
  validationError?: string | null
  displayQuestion?: string
  llmMode?: 'mock' | 'real' | null
  llmBusy?: boolean
  extractionNotice?: string | null
  clarificationQuestion?: string | null
  onFreeText?: (text: string) => Promise<void>
  onEditAnswers: () => void
  onBack: () => void
  onHome: () => void
}

export function IntakePage({
  session,
  question,
  onAnswer,
  onSkip,
  validationError,
  displayQuestion,
  llmMode,
  llmBusy = false,
  extractionNotice,
  clarificationQuestion,
  onFreeText,
  onEditAnswers,
  onBack,
  onHome,
}: IntakePageProps) {
  return (
    <main className="intake-page">
      <header className="session-header">
        <div>
          <span className="eyebrow">信息收集中</span>
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
      <nav className="intake-navigation" aria-label="问诊导航">
        <button type="button" className="secondary-action" disabled={session.stepHistory.length === 0} onClick={onBack}>
          返回上一步
        </button>
        <button type="button" className="secondary-action" onClick={onEditAnswers}>
          查看/修改已填信息
        </button>
        <button type="button" className="secondary-action" onClick={onHome}>
          返回首页
        </button>
      </nav>

      <div className="chat-context">
        <div className="assistant-avatar">M</div>
        <p>请按实际情况回答。系统会在最多 {session.maxTurns} 轮内整理已提供的信息。</p>
      </div>

      <QuestionCard
        slot={question}
        onAnswer={onAnswer}
        onSkip={onSkip}
        validationError={validationError}
        displayQuestion={displayQuestion}
        initialValue={session.answers[question.id]}
      />
      {llmMode && onFreeText && (
        <FreeTextAnswer
          busy={llmBusy}
          notice={extractionNotice}
          clarification={clarificationQuestion}
          onSubmit={onFreeText}
          mode={llmMode}
        />
      )}
      {!llmMode && extractionNotice && <p className="extraction-notice" role="status">{extractionNotice}</p>}
    </main>
  )
}
