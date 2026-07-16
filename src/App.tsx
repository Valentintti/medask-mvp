import { useEffect, useMemo, useState } from 'react'
import { SafetyBanner } from './components/SafetyBanner'
import { TracePanel } from './components/TracePanel'
import {
  answerCurrentSlot,
  answerFreeText,
  createSafeErrorResult,
  skipCurrentSlot,
  startSession,
} from './harness/intakeController'
import { createIntakeSession } from './harness/sessionState'
import { appendLlmTrace } from './llm/llmTrace'
import { MockLlmProvider } from './llm/mockProvider'
import { QuestionRewriteAdapter } from './llm/questionRewriteAdapter'
import { SlotExtractionAdapter } from './llm/slotExtractionAdapter'
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
  const [mockNluEnabled, setMockNluEnabled] = useState(false)
  const [questionMode, setQuestionMode] = useState<'canonical' | 'mockRewrite'>('canonical')
  const [displayQuestion, setDisplayQuestion] = useState<string | null>(null)
  const [mockBusy, setMockBusy] = useState(false)
  const mockProvider = useMemo(() => new MockLlmProvider(), [])
  const extractionAdapter = useMemo(() => new SlotExtractionAdapter(mockProvider), [mockProvider])
  const rewriteAdapter = useMemo(() => new QuestionRewriteAdapter(mockProvider), [mockProvider])

  useEffect(() => {
    const question = result?.question
    if (!question || questionMode !== 'mockRewrite' || !import.meta.env.DEV) {
      setDisplayQuestion(null)
      return
    }
    let cancelled = false
    setDisplayQuestion(question.question)
    void rewriteAdapter.rewrite({
      slotId: question.id,
      canonicalQuestion: question.question,
      complaintContext: result.session.chiefComplaints,
      locale: 'zh-CN',
    }).then((rewrite) => {
      if (cancelled) return
      setDisplayQuestion(rewrite.question)
      setResult((current) => {
        if (!current || current.session.currentSlotId !== rewrite.slotId) return current
        return { ...current, session: appendLlmTrace(current.session, rewrite.trace) }
      })
    })
    return () => {
      cancelled = true
    }
  }, [result?.session.currentSlotId, questionMode, rewriteAdapter])

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

  const answerWithMock = async (text: string) => {
    if (!result || mockBusy || !mockNluEnabled) return
    setMockBusy(true)
    try {
      setResult(await answerFreeText(result.session, text, extractionAdapter))
    } catch {
      setResult(createSafeErrorResult(result.session, 'controller.adapter_error'))
    } finally {
      setMockBusy(false)
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
          mockNluEnabled={mockNluEnabled}
          questionMode={questionMode}
          onMockNluChange={setMockNluEnabled}
          onQuestionModeChange={setQuestionMode}
        />
      )}

      {result?.session.status === 'collecting' && result.question && (
        <IntakePage
          session={result.session}
          question={result.question}
          onAnswer={answer}
          onSkip={skip}
          validationError={result.validationError}
          displayQuestion={displayQuestion ?? undefined}
          mockNluEnabled={mockNluEnabled && import.meta.env.DEV}
          mockBusy={mockBusy}
          extractionNotice={result.extractionNotice}
          clarificationQuestion={result.clarificationQuestion}
          onFreeText={answerWithMock}
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

      {result && (
        <TracePanel events={result.session.traceEvents} llmEvents={result.session.llmTraceEvents} />
      )}
      <footer>MedAsk · Rule-based intake demo</footer>
    </div>
  )
}
