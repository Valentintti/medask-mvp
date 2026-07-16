import { useEffect, useState } from 'react'
import type { AnswerValue, SlotDefinition } from '../types/intake'

interface QuestionCardProps {
  slot: SlotDefinition
  onAnswer: (value: AnswerValue) => void
  onSkip: () => void
}

export function QuestionCard({ slot, onAnswer, onSkip }: QuestionCardProps) {
  const [value, setValue] = useState('')

  useEffect(() => setValue(''), [slot.id])

  const submitText = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    onAnswer(slot.inputType === 'number' ? Number(trimmed) : trimmed)
  }

  return (
    <section className="question-card" aria-labelledby="current-question">
      <div className="question-meta">
        <span>{slot.required ? '优先问题' : '补充问题'}</span>
        <span>{slot.label}</span>
      </div>
      <h2 id="current-question">{slot.question}</h2>

      {slot.inputType === 'boolean' && (
        <div className="answer-grid">
          <button className="answer-button secondary" onClick={() => onAnswer(false)}>
            否
          </button>
          <button className="answer-button" onClick={() => onAnswer(true)}>
            是
          </button>
        </div>
      )}

      {slot.inputType === 'singleSelect' && (
        <div className="choice-list">
          {slot.options?.map((option) => (
            <button key={option.value} onClick={() => onAnswer(option.value)}>
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
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitText()
            }}
            placeholder={slot.inputType === 'number' ? '例如：38.5' : '请输入已知信息'}
          />
          <button onClick={submitText}>保存回答</button>
        </div>
      )}

      <button className="skip-button" onClick={onSkip}>
        暂不清楚，跳过
      </button>
    </section>
  )
}
