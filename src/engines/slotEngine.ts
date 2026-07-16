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
  if (session.turnCount >= session.maxTurns) return { slot: null, skippedSlotIds: [] }

  const skippedSlotIds: string[] = []
  const unavailable = new Set([
    ...session.askedSlotIds,
    ...session.skippedSlotIds,
    ...Object.keys(session.answers),
  ])

  for (const slot of getSessionSlots(session)) {
    if (unavailable.has(slot.id)) continue

    if (slot.showWhen) {
      const dependency = session.answers[slot.showWhen.slotId]
      if (dependency === undefined) continue
      if (!sameAnswer(dependency, slot.showWhen.equals)) {
        skippedSlotIds.push(slot.id)
        unavailable.add(slot.id)
        continue
      }
    }

    return { slot, skippedSlotIds }
  }

  return { slot: null, skippedSlotIds }
}
