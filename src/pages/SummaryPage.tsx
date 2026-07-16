import type { AnswerValue, IntakeSummary } from '../types/intake'

function displayValue(value: AnswerValue): string {
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (Array.isArray(value)) return value.join('、')
  return String(value)
}

function SummarySection({
  title,
  items,
}: {
  title: string
  items: Array<{ label: string; value: AnswerValue }>
}) {
  return (
    <section className="summary-section">
      <h2>{title}</h2>
      {items.length === 0 ? (
        <p className="empty-value">未获取</p>
      ) : (
        <dl>
          {items.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{displayValue(item.value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

export function SummaryPage({ summary, onRestart }: { summary: IntakeSummary; onRestart: () => void }) {
  return (
    <main className="summary-page">
      <span className="eyebrow">STRUCTURED HANDOFF</span>
      <h1>信息整理摘要</h1>
      <div className="summary-overview">
        <div><span>患者类型</span><strong>{summary.patientType}</strong></div>
        <div><span>核心主诉</span><strong>{summary.chiefComplaints.join('、') || '未识别'}</strong></div>
      </div>
      <SummarySection title="起病时间" items={summary.onset} />
      <SummarySection title="当前症状" items={summary.currentSymptoms} />
      <SummarySection title="伴随症状" items={summary.associatedSymptoms} />
      <SummarySection title="已采取措施" items={summary.measuresTaken} />

      <section className="missing-section">
        <h2>未能获取的信息</h2>
        <p>{summary.missingInformation.join('、') || '无'}</p>
      </section>

      <p className="summary-disclaimer">{summary.disclaimer}</p>
      <button onClick={onRestart}>开始新的信息整理</button>
    </main>
  )
}
