import { useState } from 'react'

interface FreeTextAnswerProps {
  busy: boolean
  notice?: string | null
  clarification?: string | null
  onSubmit: (text: string) => Promise<void>
}

export function FreeTextAnswer({ busy, notice, clarification, onSubmit }: FreeTextAnswerProps) {
  const [text, setText] = useState('')

  const submit = async () => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    await onSubmit(trimmed)
    setText('')
  }

  return (
    <section className="mock-answer" aria-label="Mock自然语言回答">
      <div className="mock-badge">开发模式 · Mock</div>
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
          {busy ? '整理中…' : '用Mock整理描述'}
        </button>
      </div>
      {notice && <p className="extraction-notice" role="status">{notice}</p>}
      {clarification && <p className="clarification-notice">{clarification}</p>}
      <small>Mock只提出槽位候选；是否写入、风险升级和流程状态仍由确定性Harness决定。</small>
    </section>
  )
}
