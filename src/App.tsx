import { useEffect, useMemo, useRef, useState } from 'react'
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
import { LLM_SCHEMA_VERSION } from './llm/types'
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
  const pendingExtractionRef = useRef<AbortController | null>(null)
  const sessionGenerationRef = useRef(0)
  const mockProvider = useMemo(() => new MockLlmProvider(), [])
  const extractionAdapter = useMemo(() => new SlotExtractionAdapter(mockProvider), [mockProvider])
  const rewriteAdapter = useMemo(() => new QuestionRewriteAdapter(mockProvider), [mockProvider])

  useEffect(() => {
    const question = result?.question
    if (!question || questionMode !== 'mockRewrite' || !import.meta.env.DEV) {
      setDisplayQuestion(null)
      return
    }
    const controller = new AbortController()
    setDisplayQuestion(question.question)
    void rewriteAdapter.rewrite({
      schemaVersion: LLM_SCHEMA_VERSION,
      slotId: question.id,
      canonicalQuestion: question.question,
      complaintContext: result.session.chiefComplaints,
      required: question.required,
      inputType: question.inputType,
      unit: question.unit,
      locale: 'zh-CN',
    }, controller.signal).then((rewrite) => {
      if (controller.signal.aborted) return
      setDisplayQuestion(rewrite.question)
      setResult((current) => {
        if (!current || current.session.currentSlotId !== rewrite.slotId) return current
        return { ...current, session: appendLlmTrace(current.session, rewrite.trace) }
      })
    })
    return () => {
      controller.abort(new Error('provider_aborted'))
    }
  }, [result?.session.currentSlotId, questionMode, rewriteAdapter])

  const begin = (quickComplaint?: ComplaintId) => {
    try {
      pendingExtractionRef.current?.abort(new Error('provider_aborted'))
      pendingExtractionRef.current = null
      sessionGenerationRef.current += 1
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
    pendingExtractionRef.current?.abort(new Error('provider_aborted'))
    pendingExtractionRef.current = null
    sessionGenerationRef.current += 1
    setMockBusy(false)
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
    pendingExtractionRef.current?.abort(new Error('provider_aborted'))
    const controller = new AbortController()
    pendingExtractionRef.current = controller
    const sessionId = result.session.sessionId
    const generation = sessionGenerationRef.current
    try {
      const next = await answerFreeText(result.session, text, extractionAdapter, controller.signal)
      if (controller.signal.aborted || generation !== sessionGenerationRef.current) return
      setResult((current) => current?.session.sessionId === sessionId ? next : current)
    } catch {
      if (!controller.signal.aborted && generation === sessionGenerationRef.current) {
        setResult((current) => current?.session.sessionId === sessionId
          ? createSafeErrorResult(result.session, 'controller.adapter_error')
          : current)
      }
    } finally {
      if (pendingExtractionRef.current === controller) {
        pendingExtractionRef.current = null
        setMockBusy(false)
      }
    }
  }

  useEffect(() => () => {
    pendingExtractionRef.current?.abort(new Error('provider_aborted'))
  }, [])

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
