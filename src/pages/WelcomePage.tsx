import type { ComplaintId } from '../types/intake'

interface WelcomePageProps {
  age: string
  initialText: string
  onAgeChange: (value: string) => void
  onTextChange: (value: string) => void
  onStart: (quickComplaint?: ComplaintId) => void
  mockNluEnabled: boolean
  questionMode: 'canonical' | 'mockRewrite'
  onMockNluChange: (enabled: boolean) => void
  onQuestionModeChange: (mode: 'canonical' | 'mockRewrite') => void
}

export function WelcomePage({
  age,
  initialText,
  onAgeChange,
  onTextChange,
  onStart,
  mockNluEnabled,
  questionMode,
  onMockNluChange,
  onQuestionModeChange,
}: WelcomePageProps) {
  const canStart = Number(age) > 0

  return (
    <main className="welcome-page">
      <div className="eyebrow">RULE-BASED INTAKE · DEMO</div>
      <h1>先把症状说清楚，<br />再把信息带给专业人员。</h1>
      <p className="lead">
        MedAsk 当前仅为 18—65 岁成人整理发热与咳嗽信息。规则无法理解所有自然语言。
      </p>

      <section className="start-card" aria-label="开始预问诊">
        <label htmlFor="patient-age">年龄</label>
        <input
          id="patient-age"
          type="number"
          min="1"
          max="120"
          value={age}
          onChange={(event) => onAgeChange(event.target.value)}
        />

        <label htmlFor="initial-text">用一句话描述当前不适（可选）</label>
        <textarea
          id="initial-text"
          value={initialText}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="例如：我昨天开始发烧，也有点咳嗽"
          rows={3}
        />

        <div className="quick-start">
          <button disabled={!canStart} onClick={() => onStart('fever')}>
            发热快速入口
          </button>
          <button disabled={!canStart} onClick={() => onStart('cough')}>
            咳嗽快速入口
          </button>
        </div>
        <button
          className="text-start"
          disabled={!canStart || !initialText.trim()}
          onClick={() => onStart()}
        >
          按描述开始整理
        </button>

        {import.meta.env.DEV && (
          <fieldset className="dev-controls">
            <legend>开发模式适配器</legend>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={mockNluEnabled}
                onChange={(event) => onMockNluChange(event.target.checked)}
              />
              启用Mock自然语言理解
            </label>
            <div className="question-mode" role="radiogroup" aria-label="问题表达方式">
              <label>
                <input
                  type="radio"
                  name="question-mode"
                  checked={questionMode === 'canonical'}
                  onChange={() => onQuestionModeChange('canonical')}
                />
                使用标准问题
              </label>
              <label>
                <input
                  type="radio"
                  name="question-mode"
                  checked={questionMode === 'mockRewrite'}
                  onChange={() => onQuestionModeChange('mockRewrite')}
                />
                使用模型改写问题
              </label>
            </div>
            <small>当前只使用固定映射Mock，不连接真实模型API。</small>
          </fieldset>
        )}
      </section>
    </main>
  )
}
