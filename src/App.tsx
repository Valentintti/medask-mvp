import { useState } from 'react'
import { SafetyBanner } from './components/SafetyBanner'
import { TracePanel } from './components/TracePanel'
import {
  answerCurrentSlot,
  createSafeErrorResult,
  skipCurrentSlot,
  startSession,
} from './harness/intakeController'
import { createIntakeSession } from './harness/sessionState'
import { EscalationPage } from './pages/EscalationPage'
import { IntakePage } from './pages/IntakePage'
import { SummaryPage } from './pages/SummaryPage'
import { SafeErrorPage } from './pages/SafeErrorPage'
import { WelcomePage } from './pages/WelcomePage'
import type { AnswerValue, ComplaintId, ControllerResult } from './types/intake'

export default function App() {
  const [age, setAge] = useState('30')
  const [initialText, setInitialText] = useState('')
  const [result, setResult] = useState<ControllerResult | null>(null)

  const begin = (quickComplaint?: ComplaintId) => {
    try {
      setResult(startSession({
        age: Number(age),
        initialText,
        quickComplaint,
      }))
    } catch {
      setResult(createSafeErrorResult(createIntakeSession(Number(age)), 'controller.start_error'))
    }
  }

  const restart = () => {
    setInitialText('')
    setResult(null)
  }

  const answer = (value: AnswerValue) => {
    if (!result?.question) return
    try {
      setResult(answerCurrentSlot(result.session, result.question, value))
    } catch {
      setResult(createSafeErrorResult(result.session, 'controller.answer_error'))
    }
  }

  const skip = () => {
    if (!result?.question) return
    try {
      setResult(skipCurrentSlot(result.session, result.question))
    } catch {
      setResult(createSafeErrorResult(result.session, 'controller.skip_error'))
    }
  }

  return (
    <div className="app-shell">
      <SafetyBanner />
      {!result && (
        <WelcomePage
          age={age}
          initialText={initialText}
          onAgeChange={setAge}
          onTextChange={setInitialText}
          onStart={begin}
        />
      )}

      {result?.session.status === 'collecting' && result.question && (
        <IntakePage
          session={result.session}
          question={result.question}
          onAnswer={answer}
          onSkip={skip}
          validationError={result.validationError}
        />
      )}

      {result?.session.status === 'escalated' && (
        <EscalationPage session={result.session} message={result.message} onRestart={restart} />
      )}

      {result?.session.status === 'completed' && result.summary && (
        <SummaryPage summary={result.summary} onRestart={restart} />
      )}

      {result?.session.status === 'unsupported' && (
        <main className="result-page unsupported-page">
          <span className="eyebrow">OUT OF DEMO SCOPE</span>
          <h1>当前规则无法继续</h1>
          <p className="result-message">{result.message}</p>
          <button onClick={restart}>返回首页</button>
        </main>
      )}

      {result?.session.status === 'error' && <SafeErrorPage onRestart={restart} />}

      {result && <TracePanel events={result.session.traceEvents} />}
      <footer>MedAsk · Rule-based intake demo</footer>
    </div>
  )
}
