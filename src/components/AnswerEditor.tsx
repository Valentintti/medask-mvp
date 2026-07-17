import { useEffect, useMemo, useState } from 'react'
import { formatAnswerValue } from '../engines/answerFormatter'
import { getSessionSlots } from '../engines/slotEngine'
import type { AnswerValue, IntakeSession, SlotDefinition } from '../types/intake'

interface AnswerEditorProps {
  session: IntakeSession
  error?: string | null
  onSave: (slotId: string, value: AnswerValue) => void
  onClose: () => void
}

function toDraft(value: AnswerValue): string {
  if (Array.isArray(value)) return value.join('|')
  return String(value)
}

function parseDraft(slot: SlotDefinition, draft: string): AnswerValue {
  if (slot.inputType === 'number') return Number(draft)
  if (slot.inputType === 'boolean') return draft === 'true'
  return draft
}

export function AnswerEditor({ session, error, onSave, onClose }: AnswerEditorProps) {
  const answeredSlots = useMemo(
    () => getSessionSlots(session).filter((slot) => slot.id !== 'abdominalPainPresent' && session.answers[slot.id] !== undefined),
    [session],
  )
  const [selectedId, setSelectedId] = useState(answeredSlots[0]?.id ?? '')
  const selectedSlot = answeredSlots.find((slot) => slot.id === selectedId) ?? answeredSlots[0]
  const [draft, setDraft] = useState(
    selectedSlot ? toDraft(session.answers[selectedSlot.id]) : '',
  )

  useEffect(() => {
    if (!selectedSlot) return
    setDraft(toDraft(session.answers[selectedSlot.id]))
  }, [selectedSlot?.id, session.answers])

  const chooseSlot = (slotId: string) => {
    setSelectedId(slotId)
    const slot = answeredSlots.find((item) => item.id === slotId)
    if (slot) setDraft(toDraft(session.answers[slot.id]))
  }

  return (
    <div className="editor-backdrop" role="presentation">
      <section className="answer-editor" role="dialog" aria-modal="true" aria-labelledby="answer-editor-title">
        <div className="editor-header">
          <div>
            <span className="eyebrow">已填信息</span>
            <h2 id="answer-editor-title">查看或修改</h2>
          </div>
          <button type="button" className="secondary-action" onClick={onClose}>关闭</button>
        </div>

        {answeredSlots.length === 0 ? (
          <p>当前还没有已填写的信息。</p>
        ) : (
          <>
            <label htmlFor="answer-editor-field">选择要修改的项目</label>
            <select
              id="answer-editor-field"
              value={selectedSlot?.id ?? ''}
              onChange={(event) => chooseSlot(event.target.value)}
            >
              {answeredSlots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.label}：{formatAnswerValue(slot, session.answers[slot.id])}
                </option>
              ))}
            </select>

            {selectedSlot?.inputType === 'boolean' && (
              <select aria-label={`修改${selectedSlot.label}`} value={draft} onChange={(event) => setDraft(event.target.value)}>
                <option value="false">否</option>
                <option value="true">是</option>
              </select>
            )}
            {selectedSlot?.inputType === 'singleSelect' && (
              <select aria-label={`修改${selectedSlot.label}`} value={draft} onChange={(event) => setDraft(event.target.value)}>
                {selectedSlot.options?.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            )}
            {(selectedSlot?.inputType === 'text' || selectedSlot?.inputType === 'number') && (
              <input
                aria-label={`修改${selectedSlot.label}`}
                type={selectedSlot.inputType === 'number' ? 'number' : 'text'}
                min={selectedSlot.min}
                max={selectedSlot.max}
                step={selectedSlot.inputType === 'number' ? '0.1' : undefined}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            )}
            {error && <p className="validation-error" role="alert">{error}</p>}
            <button
              type="button"
              disabled={!selectedSlot || !draft.trim()}
              onClick={() => selectedSlot && onSave(selectedSlot.id, parseDraft(selectedSlot, draft))}
            >
              保存修改
            </button>
            <p className="editor-help">修改不会增加问诊轮次；相关条件问题会按新答案重新计算。</p>
          </>
        )}
      </section>
    </div>
  )
}
