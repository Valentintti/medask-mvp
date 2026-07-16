import { useEffect, useMemo, useRef, useState } from 'react'
import { SafetyBanner } from './components/SafetyBanner'
import { AnswerEditor } from './components/AnswerEditor'
import { TracePanel } from './components/TracePanel'
import {
  answerCurrentSlot,
  answerFreeText,
  createSafeErrorResult,
  editSessionAnswer,
  returnToPreviousQuestion,
  skipCurrentSlot,
  startSession,
} from './harness/intakeController'
import { createIntakeSession } from './harness/sessionState'
import { recordProductEvent } from './harness/productEventLogger'
import type { DemoCase } from './data/demoCases'
import { INITIAL_DESCRIPTION_MAX_LENGTH } from './data/intakeLimits'
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

const LLM_FALLBACK_NOTICE = '自然语言辅助暂时不可用，你仍可继续按标准问题完成信息整理。'
const STATIC_DEMO_BUILD = import.meta.env.VITE_STATIC_DEMO === 'true'
const HOME_CONFIRM_MESSAGE = '返回首页将清空本次已填写内容，是否继续？'

export default function App({ staticDemo = STATIC_DEMO_BUILD }: { staticDemo?: boolean }) {
  const [age, setAge] = useState('30')
  const [initialText, setInitialText] = useState('')
  const [result, setResult] = useState<ControllerResult | null>(null)
  const [adapterMode, setAdapterMode] = useState<'rules' | 'mock' | 'real'>('rules')
  const [realLlmAvailable, setRealLlmAvailable] = useState(false)
  const [questionMode, setQuestionMode] = useState<'canonical' | 'rewrite'>('canonical')
  const [displayQuestion, setDisplayQuestion] = useState<string | null>(null)
  const [llmBusy, setLlmBusy] = useState(false)
  const [llmServiceNotice, setLlmServiceNotice] = useState<string | null>(null)
  const [editingAnswers, setEditingAnswers] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const pendingExtractionRef = useRef<AbortController | null>(null)
  const sessionGenerationRef = useRef(0)
  const extractionOperationKeysRef = useRef(new Set<string>())
  const rewriteQuestionCacheRef = useRef(new Map<string, string>())
  const llmAvailableEventRecordedRef = useRef(false)
  const mockProvider = useMemo(() => new MockLlmProvider(), [])
  const httpProvider = useMemo(() => new HttpLlmProvider(), [])
  const activeProvider = staticDemo ? null : adapterMode === 'mock' ? mockProvider : adapterMode === 'real' ? httpProvider : null
  const extractionAdapter = useMemo(() => activeProvider ? new SlotExtractionAdapter(activeProvider, { timeoutMs: 8500 }) : null, [activeProvider])
  const rewriteAdapter = useMemo(() => activeProvider ? new QuestionRewriteAdapter(activeProvider, 8500) : null, [activeProvider])

  useEffect(() => {
    if (staticDemo) {
      setAdapterMode('rules')
      setRealLlmAvailable(false)
      setQuestionMode('canonical')
      return
    }
    const controller = new AbortController(); let mounted = true
    void httpProvider.status(controller.signal).then((status) => {
      if (!mounted) return
      const available = status.realLlmEnabled && status.serviceAvailable && status.schemaVersion === LLM_SCHEMA_VERSION
      setRealLlmAvailable(available)
      if (available && !llmAvailableEventRecordedRef.current) {
        llmAvailableEventRecordedRef.current = true
        recordProductEvent('llm_available')
      }
      if (available && !import.meta.env.DEV) setAdapterMode('real')
    }).catch(() => { if (mounted) setRealLlmAvailable(false) })
    return () => { mounted = false; controller.abort() }
  }, [httpProvider, staticDemo])

  useEffect(() => {
    if (staticDemo || (adapterMode === 'real' && !realLlmAvailable)) setAdapterMode('rules')
    if (adapterMode === 'mock' && (!import.meta.env.DEV || staticDemo)) setAdapterMode('rules')
  }, [adapterMode, realLlmAvailable, staticDemo])

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
        setLlmServiceNotice(LLM_FALLBACK_NOTICE)
        recordProductEvent('llm_fallback')
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
      const next = startSession({
        age: Number(age),
        initialText,
        quickComplaint,
      })
      recordProductEvent('session_started')
      if (next.session.chiefComplaints.length > 0) recordProductEvent('complaint_selected')
      if (next.session.status === 'escalated') recordProductEvent('risk_escalated')
      if (next.session.status === 'completed') recordProductEvent('summary_completed')
      setResult(next)
      setEditingAnswers(false)
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
    setEditingAnswers(false)
    setEditError(null)
    recordProductEvent('session_restarted')
  }

  const answer = (value: AnswerValue) => {
    if (!result?.question) return
    try {
      const next = answerCurrentSlot(result.session, result.question, value)
      recordProductEvent('question_answered')
      if (next.session.status === 'escalated') recordProductEvent('risk_escalated')
      if (next.session.status === 'completed') recordProductEvent('summary_completed')
      setResult(next)
    } catch {
      setResult(createSafeErrorResult(result.session, 'controller.answer_error'))
    }
  }

  const skip = () => {
    if (!result?.question) return
    try {
      const next = skipCurrentSlot(result.session, result.question)
      recordProductEvent('question_skipped')
      if (next.session.status === 'completed') recordProductEvent('summary_completed')
      setResult(next)
    } catch {
      setResult(createSafeErrorResult(result.session, 'controller.skip_error'))
    }
  }

  const back = () => {
    if (!result || result.session.status !== 'collecting') return
    try {
      setResult(returnToPreviousQuestion(result.session))
    } catch {
      setResult(createSafeErrorResult(result.session, 'controller.back_error'))
    }
  }

  const confirmAndRestart = () => {
    if (window.confirm(HOME_CONFIRM_MESSAGE)) restart()
  }

  const editAnswer = (slotId: string, value: AnswerValue) => {
    if (!result) return
    try {
      const next = editSessionAnswer(result.session, slotId, value)
      if (next.validationError) {
        setEditError(next.validationError)
        return
      }
      setEditError(null)
      setResult(next)
      if (next.session.status === 'escalated') {
        setEditingAnswers(false)
        recordProductEvent('risk_escalated')
      }
    } catch {
      setEditingAnswers(false)
      setResult(createSafeErrorResult(result.session, 'controller.edit_error'))
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
      if (adapterMode === 'real' && next.extractionNotice === LLM_FALLBACK_NOTICE) {
        setLlmServiceNotice(next.extractionNotice)
        setAdapterMode('rules')
        setQuestionMode('canonical')
        recordProductEvent('llm_fallback')
      }
      if (next.session.turnCount > result.session.turnCount) recordProductEvent('question_answered')
      if (next.session.status === 'escalated') recordProductEvent('risk_escalated')
      if (next.session.status === 'completed') recordProductEvent('summary_completed')
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
          onTextChange={(value) => setInitialText(value.slice(0, INITIAL_DESCRIPTION_MAX_LENGTH))}
          onStart={begin}
          adapterMode={adapterMode}
          realLlmAvailable={realLlmAvailable}
          questionMode={questionMode}
          onAdapterModeChange={(mode) => { setLlmServiceNotice(null); setAdapterMode(mode === 'mock' && !import.meta.env.DEV ? 'rules' : mode) }}
          onQuestionModeChange={setQuestionMode}
          onDemoSelect={(demo: DemoCase) => { setAge(String(demo.age)); setInitialText(demo.text.slice(0, INITIAL_DESCRIPTION_MAX_LENGTH)) }}
          staticDemo={staticDemo}
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
          onEditAnswers={() => { setEditError(null); setEditingAnswers(true) }}
          onBack={back}
          onHome={confirmAndRestart}
        />
      )}

      {result?.session.status === 'escalated' && (
        <EscalationPage session={result.session} message={result.message} onRestart={restart} />
      )}

      {result?.session.status === 'completed' && result.summary && (
        <SummaryPage summary={result.summary} onHome={confirmAndRestart} onEdit={() => { setEditError(null); setEditingAnswers(true) }} />
      )}

      {result?.session.status === 'unsupported' && (
        <main className="result-page unsupported-page">
          <span className="eyebrow">当前不在支持范围</span>
          <h1>当前规则无法继续</h1>
          <p className="result-message">{result.message}</p>
          <button onClick={restart}>返回首页</button>
        </main>
      )}

      {result?.session.status === 'error' && <SafeErrorPage onRestart={restart} />}

      {editingAnswers && result && (result.session.status === 'collecting' || result.session.status === 'completed') && (
        <AnswerEditor
          session={result.session}
          error={editError}
          onSave={editAnswer}
          onClose={() => { setEditingAnswers(false); setEditError(null) }}
        />
      )}

      {import.meta.env.DEV && !staticDemo && result && (
        <TracePanel events={result.session.traceEvents} llmEvents={result.session.llmTraceEvents} />
      )}
      <footer>MedAsk · 就医前信息整理演示版</footer>
    </div>
  )
}
