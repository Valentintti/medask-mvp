import { complaintRules } from '../data/complaintRules'
import type { AnswerValue, IntakeSession, SlotDefinition, SlotSelection } from '../types/intake'

function sameAnswer(left: AnswerValue | undefined, right: AnswerValue): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }
  return left === right
}

export function getSessionSlots(session: IntakeSession): SlotDefinition[] {
  const merged = new Map<string, SlotDefinition>()

  for (const complaint of session.chiefComplaints) {
    for (const slot of complaintRules[complaint].slots) {
      const existing = merged.get(slot.id)
      if (!existing) {
        merged.set(slot.id, { ...slot, complaints: [...slot.complaints] })
        continue
      }

      merged.set(slot.id, {
        ...existing,
        complaints: [...new Set([...existing.complaints, ...slot.complaints])],
        required: existing.required || slot.required,
        priority: Math.min(existing.priority, slot.priority),
        showWhen: existing.showWhen && slot.showWhen ? existing.showWhen : undefined,
      })
    }
  }

  return [...merged.values()].sort((left, right) => {
    if (left.required !== right.required) return left.required ? -1 : 1
    return left.priority - right.priority
  })
}

export function selectNextSlot(session: IntakeSession): SlotSelection {
  if (session.turnCount >= session.maxTurns) return { slot: null, notApplicableSlotIds: [] }

  const notApplicableSlotIds: string[] = []
  const unavailable = new Set([
    ...session.askedSlotIds,
    ...session.skippedSlotIds,
    ...session.notApplicableSlotIds,
    ...Object.keys(session.answers),
  ])

  // “已采取措施”是交接摘要必问字段；多主诉时也为最后一轮预留位置。
  if (session.turnCount === session.maxTurns - 1 && !unavailable.has('medicationHistory')) {
    const measures = getSessionSlots(session).find((slot) => slot.id === 'medicationHistory')
    if (measures) return { slot: measures, notApplicableSlotIds: [] }
  }

  for (const slot of getSessionSlots(session)) {
    if (unavailable.has(slot.id)) continue

    if (slot.showWhen) {
      const dependency = session.answers[slot.showWhen.slotId]
      if (dependency === undefined) continue
      if (!sameAnswer(dependency, slot.showWhen.equals)) {
        notApplicableSlotIds.push(slot.id)
        unavailable.add(slot.id)
        continue
      }
    }

    return { slot, notApplicableSlotIds }
  }

  return { slot: null, notApplicableSlotIds }
}

export interface SlotValidationResult {
  valid: boolean
  message: string | null
}

export function validateSlotAnswer(slot: SlotDefinition, value: AnswerValue): SlotValidationResult {
  const defaultMessage = slot.validationMessage ?? '请输入有效信息。'

  if (slot.inputType === 'number') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (slot.min !== undefined && value < slot.min) ||
      (slot.max !== undefined && value > slot.max)
    ) {
      return { valid: false, message: defaultMessage }
    }
  }

  if (slot.inputType === 'boolean' && typeof value !== 'boolean') {
    return { valid: false, message: defaultMessage }
  }

  if (
    slot.inputType === 'singleSelect' &&
    (typeof value !== 'string' || !slot.options?.some((option) => option.value === value))
  ) {
    return { valid: false, message: defaultMessage }
  }

  if (slot.inputType === 'text' && (typeof value !== 'string' || !value.trim())) {
    return { valid: false, message: defaultMessage }
  }

  return { valid: true, message: null }
}

export function reconcileConditionalSlots(session: IntakeSession): IntakeSession {
  const answers = { ...session.answers }
  const notApplicable = new Set<string>()
  const clearedSlotIds = new Set<string>()

  for (const slot of getSessionSlots(session)) {
    if (!slot.showWhen) continue
    const dependency = answers[slot.showWhen.slotId]
    if (dependency !== undefined && !sameAnswer(dependency, slot.showWhen.equals)) {
      notApplicable.add(slot.id)
      if (answers[slot.id] !== undefined) {
        delete answers[slot.id]
        clearedSlotIds.add(slot.id)
      }
    }
  }

  return {
    ...session,
    answers,
    notApplicableSlotIds: [...notApplicable],
    skippedSlotIds: session.skippedSlotIds.filter((id) => !notApplicable.has(id)),
    askedSlotIds: session.askedSlotIds.filter((id) => !clearedSlotIds.has(id)),
    currentSlotId: session.currentSlotId && notApplicable.has(session.currentSlotId)
      ? null
      : session.currentSlotId,
  }
}
