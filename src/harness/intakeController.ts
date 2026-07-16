import { detectComplaints, extractInitialAnswers } from '../engines/complaintEngine'
import { checkStructuredRisk, checkTextRisk } from '../engines/riskEngine'
import { getSessionSlots, selectNextSlot, validateSlotAnswer } from '../engines/slotEngine'
import { createSummary } from '../engines/summaryEngine'
import { formatAnswerValue } from '../engines/answerFormatter'
import { appendLlmTrace } from '../llm/llmTrace'
import { SlotExtractionAdapter } from '../llm/slotExtractionAdapter'
import type {
  ExtractionAdapterResult,
  FreeTextControllerResult,
  SlotConflict,
} from '../llm/types'
import type {
  AnswerValue,
  ControllerResult,
  IntakeSession,
  RiskResult,
  SlotDefinition,
  StartSessionInput,
} from '../types/intake'
import { createIntakeSession } from './sessionState'
import { appendTrace } from './traceLogger'

const UNSUPPORTED_AGE_MESSAGE = '当前演示仅支持18—65岁成人的发热和咳嗽信息整理。'
const UNSUPPORTED_COMPLAINT_MESSAGE = '暂时无法用规则识别该主诉。当前演示仅支持发热和咳嗽。'

function escalate(session: IntakeSession, risk: RiskResult): ControllerResult {
  const previousStatus = session.status
  let next: IntakeSession = {
    ...session,
    status: 'escalated' as const,
    currentSlotId: null,
    escalationReason: risk.reason,
  }
  next = appendTrace(next, {
    eventType: 'escalated',
    decision: risk.reason ?? '风险升级',
    ruleId: risk.ruleId,
    previousStatus,
    nextStatus: 'escalated',
  })
  return {
    session: next,
    question: null,
    summary: createSummary(next),
    message: risk.safetyMessage ?? '请转人工或线下就医。',
  }
}

function complete(session: IntakeSession, ruleId: string): ControllerResult {
  const previousStatus = session.status
  let next: IntakeSession = { ...session, status: 'completed', currentSlotId: null }
  next = appendTrace(next, {
    eventType: 'summary_generated',
    decision: '根据已收集信息生成结构化摘要',
    ruleId,
    previousStatus,
    nextStatus: 'completed',
  })
  return {
    session: next,
    question: null,
    summary: createSummary(next),
    message: '信息整理已完成。',
  }
}

function selectQuestion(session: IntakeSession): ControllerResult {
  const selection = selectNextSlot(session)
  let next = session

  for (const skippedId of selection.notApplicableSlotIds) {
    next = {
      ...next,
      notApplicableSlotIds: next.notApplicableSlotIds.includes(skippedId)
        ? next.notApplicableSlotIds
        : [...next.notApplicableSlotIds, skippedId],
    }
    next = appendTrace(next, {
      eventType: 'slot_skipped',
      input: { slotId: skippedId },
      decision: 'showWhen 条件不成立，跳过二级槽位',
      ruleId: `slot.${skippedId}.show_when`,
    })
  }

  if (!selection.slot) {
    return complete(next, next.turnCount >= next.maxTurns ? 'session.max_turns' : 'session.no_slots')
  }

  const slot = selection.slot
  next = {
    ...next,
    currentSlotId: slot.id,
    askedSlotIds: next.askedSlotIds.includes(slot.id)
      ? next.askedSlotIds
      : [...next.askedSlotIds, slot.id],
  }
  next = appendTrace(next, {
    eventType: 'question_selected',
    input: { slotId: slot.id },
    decision: slot.required ? '选择尚未询问的必填槽位' : '选择尚未询问的可选槽位',
    ruleId: `slot.${slot.id}.priority`,
  })

  return { session: next, question: slot, summary: null, message: slot.question }
}

function traceRiskCheck(session: IntakeSession, risk: RiskResult, source: string): IntakeSession {
  return appendTrace(session, {
    eventType: 'risk_checked',
    input: { source },
    decision: risk.matched ? risk.reason ?? '命中风险规则' : '未命中风险规则',
    ruleId: risk.ruleId,
  })
}

function currentQuestion(session: IntakeSession): SlotDefinition | null {
  if (!session.currentSlotId) return null
  return getSessionSlot(session, session.currentSlotId)
}

function getSessionSlot(session: IntakeSession, slotId: string): SlotDefinition | null {
  return getSessionSlots(session).find((slot) => slot.id === slotId) ?? null
}

export function startSession(input: StartSessionInput): ControllerResult {
  let session = createIntakeSession(input.age)
  const nextStatus = session.patientGroup === 'adult_18_65' ? 'collecting' : 'unsupported'
  session = { ...session, status: nextStatus }
  session = appendTrace(session, {
    eventType: 'session_started',
    input: { patientGroup: session.patientGroup },
    decision: nextStatus === 'collecting' ? '进入成人预问诊' : '年龄不在演示范围',
    ruleId: 'session.age_scope',
    previousStatus: 'idle',
    nextStatus,
  })

  if (session.status === 'unsupported') {
    return { session, question: null, summary: null, message: UNSUPPORTED_AGE_MESSAGE }
  }

  const initialText = input.initialText?.trim() ?? ''
  const risk = checkTextRisk(initialText)
  session = traceRiskCheck(session, risk, 'initial_text')
  if (risk.matched) return escalate(session, risk)

  const detected = detectComplaints(initialText)
  const complaints = [...new Set([...(input.quickComplaint ? [input.quickComplaint] : []), ...detected])]
  if (complaints.length === 0) {
    const previousStatus = session.status
    session = { ...session, status: 'unsupported' }
    session = appendTrace(session, {
      eventType: 'complaint_matched',
      decision: '规则未识别出发热或咳嗽',
      ruleId: 'complaint.none',
      previousStatus,
      nextStatus: 'unsupported',
    })
    return { session, question: null, summary: null, message: UNSUPPORTED_COMPLAINT_MESSAGE }
  }

  session = {
    ...session,
    chiefComplaints: complaints,
    initialNarrative: initialText || undefined,
    answers: initialText ? extractInitialAnswers(initialText, complaints) : {},
  }
  session = appendTrace(session, {
    eventType: 'complaint_matched',
    input: { complaintCount: complaints.length },
    decision: `识别到${complaints.length}个受支持主诉`,
    ruleId: 'complaint.keyword_v1',
  })

  return selectQuestion(session)
}

function riskFromAnswer(slot: SlotDefinition, value: AnswerValue): RiskResult {
  const structured = checkStructuredRisk(slot.id, value)
  if (structured.matched) return structured
  return typeof value === 'string' ? checkTextRisk(value) : checkTextRisk('')
}

export function answerCurrentSlot(
  session: IntakeSession,
  slot: SlotDefinition,
  value: AnswerValue,
): ControllerResult {
  if (session.status !== 'collecting' || session.currentSlotId !== slot.id) {
    return { session, question: null, summary: null, message: '当前没有可保存的普通问诊问题。' }
  }

  const validation = validateSlotAnswer(slot, value)
  if (!validation.valid) {
    const traced = appendTrace(session, {
      eventType: 'error',
      input: { slotId: slot.id, errorType: 'validation' },
      decision: '拒绝保存不符合槽位约束的回答',
      ruleId: `slot.${slot.id}.validation`,
    })
    return {
      session: traced,
      question: slot,
      summary: null,
      message: validation.message ?? '请输入有效信息。',
      validationError: validation.message,
    }
  }

  let next: IntakeSession = {
    ...session,
    answers: { ...session.answers, [slot.id]: value },
    currentSlotId: null,
    turnCount: session.turnCount + 1,
  }
  next = appendTrace(next, {
    eventType: 'slot_answered',
    input: { slotId: slot.id, valueType: typeof value },
    decision: '保存用户提供的槽位信息',
    ruleId: `slot.${slot.id}.answer`,
  })

  const risk = riskFromAnswer(slot, value)
  next = traceRiskCheck(next, risk, `slot:${slot.id}`)
  if (risk.matched) return escalate(next, risk)
  if (next.turnCount >= next.maxTurns) return complete(next, 'session.max_turns')
  return selectQuestion(next)
}

export function createSafeErrorResult(
  session: IntakeSession,
  ruleId = 'controller.unexpected_error',
): ControllerResult {
  const previousStatus = session.status
  let next: IntakeSession = { ...session, status: 'error', currentSlotId: null }
  next = appendTrace(next, {
    eventType: 'error',
    input: { errorType: 'rule_execution' },
    decision: '规则执行异常，已切换到安全错误状态',
    ruleId,
    previousStatus,
    nextStatus: 'error',
  })
  return {
    session: next,
    question: null,
    summary: null,
    message: '本次信息整理暂时无法继续，请返回首页后重试。',
  }
}

export function skipCurrentSlot(session: IntakeSession, slot: SlotDefinition): ControllerResult {
  if (session.status !== 'collecting' || session.currentSlotId !== slot.id) {
    return { session, question: null, summary: null, message: '当前没有可跳过的问题。' }
  }

  let next: IntakeSession = {
    ...session,
    skippedSlotIds: session.skippedSlotIds.includes(slot.id)
      ? session.skippedSlotIds
      : [...session.skippedSlotIds, slot.id],
    currentSlotId: null,
    turnCount: session.turnCount + 1,
  }
  next = appendTrace(next, {
    eventType: 'slot_skipped',
    input: { slotId: slot.id },
    decision: '用户主动跳过该槽位',
    ruleId: `slot.${slot.id}.user_skip`,
  })

  if (next.turnCount >= next.maxTurns) return complete(next, 'session.max_turns')
  return selectQuestion(next)
}

function adapterAllowedSlots(session: IntakeSession): SlotDefinition[] {
  return getSessionSlots(session).filter((slot) => {
    if (session.answers[slot.id] !== undefined) return true
    if (session.skippedSlotIds.includes(slot.id) || session.notApplicableSlotIds.includes(slot.id)) {
      return false
    }
    if (slot.showWhen) {
      const dependency = session.answers[slot.showWhen.slotId]
      if (dependency !== undefined && dependency !== slot.showWhen.equals) return false
    }
    return true
  })
}

function conflictQuestion(conflict: SlotConflict, session: IntakeSession): string {
  const slot = getSessionSlot(session, conflict.slotId)
  if (!slot) return '你提供的信息与之前不一致，请确认哪一次描述更准确？'
  const existing = formatAnswerValue(slot, conflict.existingValue)
  const proposed = formatAnswerValue(slot, conflict.proposedValue)
  if (slot.id === 'currentTemperature') {
    return `你之前提供的是${existing}，现在提到${proposed}。请确认当前体温是多少？`
  }
  return `你之前提供的“${slot.label}”是${existing}，现在提到${proposed}。请确认哪一个更准确？`
}

export function processExtractionCandidates(
  session: IntakeSession,
  extraction: ExtractionAdapterResult,
): FreeTextControllerResult {
  let next = appendLlmTrace(session, extraction.trace)
  const acceptedSlotIds = extraction.acceptedCandidates.map((candidate) => candidate.slotId)

  if (extraction.fallbackToRules) {
    const question = currentQuestion(next)
    return {
      session: next,
      question,
      summary: null,
      message: question?.question ?? '请使用标准选项继续。',
      extractionNotice: '自然语言整理暂不可用，已回退到标准问题。',
      clarificationQuestion: null,
      acceptedSlotIds: [],
      conflicts: [],
    }
  }

  if (extraction.conflicts.length > 0) {
    const clarificationQuestion = conflictQuestion(extraction.conflicts[0], next)
    return {
      session: next,
      question: currentQuestion(next),
      summary: null,
      message: clarificationQuestion,
      extractionNotice: null,
      clarificationQuestion,
      acceptedSlotIds: [],
      conflicts: extraction.conflicts,
    }
  }

  for (const candidate of extraction.acceptedCandidates) {
    const slot = getSessionSlot(next, candidate.slotId)
    if (!slot || next.answers[candidate.slotId] !== undefined) continue
    next = {
      ...next,
      answers: { ...next.answers, [candidate.slotId]: candidate.value },
    }
    next = appendTrace(next, {
      eventType: 'slot_answered',
      input: { slotId: candidate.slotId, source: 'validated_adapter' },
      decision: 'Harness接受已通过Schema、槽位和风险校验的候选',
      ruleId: `slot.${candidate.slotId}.adapter_acceptance`,
    })
  }

  const formatted = extraction.acceptedCandidates
    .map((candidate) => {
      const slot = getSessionSlot(next, candidate.slotId)
      return slot ? `${slot.label}：${formatAnswerValue(slot, candidate.value)}` : null
    })
    .filter((item): item is string => Boolean(item))
  const extractionNotice = formatted.length > 0 ? `已从你的描述中整理出：${formatted.join('；')}` : null
  const currentWasAccepted = Boolean(
    session.currentSlotId && acceptedSlotIds.includes(session.currentSlotId),
  )

  if (currentWasAccepted) {
    next = { ...next, currentSlotId: null, turnCount: next.turnCount + 1 }
    const result =
      next.turnCount >= next.maxTurns
        ? complete(next, 'session.max_turns')
        : selectQuestion(next)
    return {
      ...result,
      extractionNotice,
      clarificationQuestion: null,
      acceptedSlotIds,
      conflicts: [],
    }
  }

  const question = currentQuestion(next)
  const clarificationQuestion =
    extraction.needsClarification && acceptedSlotIds.length === 0
      ? question
        ? `请再明确描述“${question.label}”：${question.question}`
        : '请再明确描述一下当前情况。'
      : null
  return {
    session: next,
    question,
    summary: null,
    message: clarificationQuestion ?? extractionNotice ?? question?.question ?? '请继续。',
    extractionNotice,
    clarificationQuestion,
    acceptedSlotIds,
    conflicts: [],
  }
}

export async function answerFreeText(
  session: IntakeSession,
  userText: string,
  adapter: SlotExtractionAdapter,
): Promise<FreeTextControllerResult> {
  if (session.status !== 'collecting') {
    return {
      session,
      question: null,
      summary: null,
      message: '当前会话不接受普通问诊回答。',
      acceptedSlotIds: [],
      conflicts: [],
    }
  }

  const risk = checkTextRisk(userText)
  const checked = traceRiskCheck(session, risk, 'free_text_before_adapter')
  if (risk.matched) {
    return { ...escalate(checked, risk), acceptedSlotIds: [], conflicts: [] }
  }

  const extraction = await adapter.extract({
    supportedComplaints: checked.chiefComplaints,
    allowedSlots: adapterAllowedSlots(checked),
    currentQuestionSlotId: checked.currentSlotId,
    userText,
    existingAnswers: checked.answers,
  })
  return processExtractionCandidates(checked, extraction)
}

export async function startSessionWithAdapter(
  input: StartSessionInput,
  adapter: SlotExtractionAdapter | null,
): Promise<FreeTextControllerResult | ControllerResult> {
  const base = startSession(input)
  if (!adapter || !input.initialText || base.session.status !== 'collecting') return base
  return answerFreeText(base.session, input.initialText, adapter)
}
