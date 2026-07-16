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
import { HttpLlmProvider } from './llm/httpProvider'
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
  const [adapterMode, setAdapterMode] = useState<'rules' | 'mock' | 'real'>('rules')
  const [realLlmAvailable, setRealLlmAvailable] = useState(false)
  const [questionMode, setQuestionMode] = useState<'canonical' | 'rewrite'>('canonical')
  const [displayQuestion, setDisplayQuestion] = useState<string | null>(null)
  const [llmBusy, setLlmBusy] = useState(false)
  const [llmServiceNotice, setLlmServiceNotice] = useState<string | null>(null)
  const pendingExtractionRef = useRef<AbortController | null>(null)
  const sessionGenerationRef = useRef(0)
  const extractionOperationKeysRef = useRef(new Set<string>())
  const rewriteQuestionCacheRef = useRef(new Map<string, string>())
  const mockProvider = useMemo(() => new MockLlmProvider(), [])
  const httpProvider = useMemo(() => new HttpLlmProvider(), [])
  const activeProvider = adapterMode === 'mock' ? mockProvider : adapterMode === 'real' ? httpProvider : null
  const extractionAdapter = useMemo(() => activeProvider ? new SlotExtractionAdapter(activeProvider, { timeoutMs: 8500 }) : null, [activeProvider])
  const rewriteAdapter = useMemo(() => activeProvider ? new QuestionRewriteAdapter(activeProvider, 8500) : null, [activeProvider])

  useEffect(() => {
    const controller = new AbortController(); let mounted = true
    void httpProvider.status(controller.signal).then((status) => {
      if (mounted) setRealLlmAvailable(status.realLlmEnabled && status.serviceAvailable && status.schemaVersion === LLM_SCHEMA_VERSION)
    }).catch(() => { if (mounted) setRealLlmAvailable(false) })
    return () => { mounted = false; controller.abort() }
  }, [httpProvider])

  useEffect(() => {
    if (adapterMode === 'real' && !realLlmAvailable) setAdapterMode('rules')
    if (adapterMode === 'mock' && !import.meta.env.DEV) setAdapterMode('rules')
  }, [adapterMode, realLlmAvailable])

  useEffect(() => {
    const question = result?.question
    if (!question || questionMode !== 'rewrite' || !rewriteAdapter) {
      setDisplayQuestion(null)
      return
    }
    const operationKey = `${result.session.sessionId}:${question.id}`
    const cachedQuestion = rewriteQuestionCacheRef.current.get(operationKey)
    if (cachedQuestion) { setDisplayQuestion(cachedQuestion); return }
    rewriteQuestionCacheRef.current.set(operationKey, question.question)
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
      if (adapterMode === 'real' && rewrite.trace.outcome === 'fallback') {
        setLlmServiceNotice('自然语言辅助暂时不可用，已切换为标准问题模式。')
        setAdapterMode('rules')
        setQuestionMode('canonical')
        return
      }
      rewriteQuestionCacheRef.current.set(operationKey, rewrite.question)
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
      extractionOperationKeysRef.current.clear()
      rewriteQuestionCacheRef.current.clear()
      setLlmServiceNotice(null)
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
    extractionOperationKeysRef.current.clear()
    rewriteQuestionCacheRef.current.clear()
    setLlmBusy(false)
    setInitialText('')
    setLlmServiceNotice(null)
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

  const answerWithLlm = async (text: string) => {
    if (!result || llmBusy || !extractionAdapter) return
    const operationKey = `${result.session.sessionId}:${result.session.turnCount}:${result.session.currentSlotId ?? 'none'}`
    if (extractionOperationKeysRef.current.has(operationKey)) return
    extractionOperationKeysRef.current.add(operationKey)
    setLlmBusy(true)
    pendingExtractionRef.current?.abort(new Error('provider_aborted'))
    const controller = new AbortController()
    pendingExtractionRef.current = controller
    const sessionId = result.session.sessionId
    const generation = sessionGenerationRef.current
    try {
      const next = await answerFreeText(result.session, text, extractionAdapter, controller.signal)
      if (controller.signal.aborted || generation !== sessionGenerationRef.current) return
      if (adapterMode === 'real' && next.extractionNotice) {
        setLlmServiceNotice(next.extractionNotice)
        setAdapterMode('rules')
        setQuestionMode('canonical')
      }
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
        setLlmBusy(false)
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
          adapterMode={adapterMode}
          realLlmAvailable={realLlmAvailable}
          questionMode={questionMode}
          onAdapterModeChange={(mode) => { setLlmServiceNotice(null); setAdapterMode(mode === 'mock' && !import.meta.env.DEV ? 'rules' : mode) }}
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
          llmMode={adapterMode === 'rules' ? null : adapterMode}
          llmBusy={llmBusy}
          extractionNotice={result.extractionNotice ?? llmServiceNotice}
          clarificationQuestion={result.clarificationQuestion}
          onFreeText={answerWithLlm}
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
