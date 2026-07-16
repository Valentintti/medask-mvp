import { useRef, useState } from 'react'

interface FreeTextAnswerProps {
  busy: boolean
  notice?: string | null
  clarification?: string | null
  onSubmit: (text: string) => Promise<void>
  mode: 'mock' | 'real'
}

export function FreeTextAnswer({ busy, notice, clarification, onSubmit, mode }: FreeTextAnswerProps) {
  const [text, setText] = useState('')
  const submittingRef = useRef(false)

  const submit = async () => {
    const trimmed = text.trim()
    if (!trimmed || busy || submittingRef.current) return
    submittingRef.current = true
    try {
      await onSubmit(trimmed)
      setText('')
    } finally {
      submittingRef.current = false
    }
  }

  return (
    <section className="mock-answer" aria-label="自然语言辅助回答">
      <div className="mock-badge">{mode === 'mock' ? '开发模式 · Mock' : '自然语言辅助'}</div>
      <label htmlFor="mock-free-text">也可以用一句话回答当前问题</label>
      <div className="mock-answer-row">
        <input
          id="mock-free-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
          placeholder="例如：现在38.5度"
          disabled={busy}
        />
        <button onClick={() => void submit()} disabled={busy || !text.trim()}>
          {busy ? '整理中…' : mode === 'mock' ? '用Mock整理描述' : '整理这段描述'}
        </button>
      </div>
      {notice && <p className="extraction-notice" role="status">{notice}</p>}
      {clarification && <p className="clarification-notice">{clarification}</p>}
      <small>模型仅协助整理信息，风险和流程由固定规则控制。</small>
    </section>
  )
}
