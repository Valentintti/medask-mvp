import { useEffect, useState } from 'react'
import { validateSlotAnswer } from '../engines/slotEngine'
import type { AnswerValue, SlotDefinition } from '../types/intake'

interface QuestionCardProps {
  slot: SlotDefinition
  onAnswer: (value: AnswerValue) => void
  onSkip: () => void
  validationError?: string | null
  displayQuestion?: string
  initialValue?: AnswerValue
}

export function QuestionCard({ slot, onAnswer, onSkip, validationError, displayQuestion, initialValue }: QuestionCardProps) {
  const [value, setValue] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    setValue(initialValue === undefined || Array.isArray(initialValue) ? '' : String(initialValue))
    setLocalError(null)
  }, [slot.id, initialValue])

  const submitText = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    const answer = slot.inputType === 'number' ? Number(trimmed) : trimmed
    const validation = validateSlotAnswer(slot, answer)
    if (!validation.valid) {
      setLocalError(validation.message)
      return
    }
    setLocalError(null)
    onAnswer(answer)
  }

  return (
    <section className="question-card" aria-labelledby="current-question">
      <div className="question-meta">
        <span>{slot.required ? '优先问题' : '补充问题'}</span>
        <span>{slot.label}</span>
      </div>
      <h2 id="current-question">{displayQuestion ?? slot.question}</h2>

      {slot.inputType === 'boolean' && (
        <div className="answer-grid">
          <button className="answer-button secondary" aria-pressed={initialValue === false} onClick={() => onAnswer(false)}>
            否
          </button>
          <button className="answer-button" aria-pressed={initialValue === true} onClick={() => onAnswer(true)}>
            是
          </button>
        </div>
      )}

      {slot.inputType === 'singleSelect' && (
        <div className="choice-list">
          {slot.options?.map((option) => (
            <button key={option.value} aria-pressed={initialValue === option.value} onClick={() => onAnswer(option.value)}>
              {option.label}
            </button>
          ))}
        </div>
      )}

      {(slot.inputType === 'text' || slot.inputType === 'number') && (
        <div className="text-answer">
          <label htmlFor={`slot-${slot.id}`}>{slot.label}</label>
          <input
            id={`slot-${slot.id}`}
            type={slot.inputType === 'number' ? 'number' : 'text'}
            step={slot.inputType === 'number' ? '0.1' : undefined}
            min={slot.min}
            max={slot.max}
            value={value}
            aria-invalid={Boolean(localError || validationError)}
            aria-describedby={`slot-${slot.id}-error`}
            onChange={(event) => {
              setValue(event.target.value)
              setLocalError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitText()
            }}
            placeholder={slot.inputType === 'number' ? '例如：38.5' : '请输入已知信息'}
          />
          <button onClick={submitText}>保存回答</button>
          {slot.id === 'medicationHistory' && (
            <button className="secondary-action no-measures-button" onClick={() => onAnswer('未采取任何措施')}>
              未采取任何措施
            </button>
          )}
          {(localError || validationError) && (
            <p id={`slot-${slot.id}-error`} className="validation-error" role="alert">
              {localError || validationError}
            </p>
          )}
        </div>
      )}

      <button className="skip-button" onClick={onSkip}>
        暂不清楚，跳过
      </button>
    </section>
  )
}
