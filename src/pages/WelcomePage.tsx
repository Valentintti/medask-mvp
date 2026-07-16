import type { ComplaintId } from '../types/intake'
import { demoCases, type DemoCase } from '../data/demoCases'

interface WelcomePageProps {
  age: string
  initialText: string
  onAgeChange: (value: string) => void
  onTextChange: (value: string) => void
  onStart: (quickComplaint?: ComplaintId) => void
  adapterMode: 'rules' | 'mock' | 'real'
  realLlmAvailable: boolean
  questionMode: 'canonical' | 'rewrite'
  onAdapterModeChange: (mode: 'rules' | 'mock' | 'real') => void
  onQuestionModeChange: (mode: 'canonical' | 'rewrite') => void
  onDemoSelect: (demo: DemoCase) => void
}

export function WelcomePage({
  age,
  initialText,
  onAgeChange,
  onTextChange,
  onStart,
  adapterMode,
  realLlmAvailable,
  questionMode,
  onAdapterModeChange,
  onQuestionModeChange,
  onDemoSelect,
}: WelcomePageProps) {
  const canStart = Number(age) > 0

  return (
    <main className="welcome-page">
      <div className="brand-lockup"><span className="brand-mark">M</span><strong>MedAsk</strong></div>
      <div className="eyebrow">就医前信息整理 · 产品演示</div>
      <h1>帮助患者在就医前，<br />整理症状信息。</h1>
      <p className="lead">
        当前支持 18—65 岁成人的发热和咳嗽信息整理。它不会提供疾病诊断、药物或治疗建议。
      </p>
      <div className="service-status" role="status">
        <span className={realLlmAvailable ? 'status-dot available' : 'status-dot'} />
        {realLlmAvailable ? '自然语言辅助可用' : '当前使用标准规则模式'}
      </div>

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
          placeholder="例如：我昨天开始发烧，现在38.5度"
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
          开始整理
        </button>

        {import.meta.env.DEV && <section className="demo-cases" aria-label="演示案例">
          <div><strong>演示案例</strong><small>仅填充合成内容，不会自动提交</small></div>
          <div className="demo-case-buttons">
            {demoCases.map((demo) => (
              <button type="button" className="demo-case-button" key={demo.id} onClick={() => onDemoSelect(demo)}>
                {demo.title}
              </button>
            ))}
          </div>
        </section>}

        {import.meta.env.DEV && <fieldset className="dev-controls">
            <legend>自然语言辅助模式</legend>
            <label>
              <input
                type="radio" name="adapter-mode" checked={adapterMode === 'rules'}
                onChange={() => onAdapterModeChange('rules')}
              />
              纯规则
            </label>
            {import.meta.env.DEV && <label>
              <input type="radio" name="adapter-mode" checked={adapterMode === 'mock'} onChange={() => onAdapterModeChange('mock')} />
              Mock LLM
            </label>}
            <label>
              <input type="radio" name="adapter-mode" checked={adapterMode === 'real'} disabled={!realLlmAvailable} onChange={() => onAdapterModeChange('real')} />
              Real LLM
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
                  checked={questionMode === 'rewrite'}
                  disabled={adapterMode === 'rules'}
                  onChange={() => onQuestionModeChange('rewrite')}
                />
                使用模型改写问题
              </label>
            </div>
            <small>{realLlmAvailable ? '服务端安全代理可用，模型不控制风险和流程。' : '服务端辅助不可用；继续使用规则或开发Mock。'}</small>
          </fieldset>}
      </section>
      <p className="welcome-example"><strong>示例输入：</strong>“昨天开始发烧，现在38.5度，没有胸痛。”</p>
    </main>
  )
}
