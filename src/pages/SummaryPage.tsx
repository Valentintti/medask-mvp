import type { IntakeSummary, SummaryEntry } from '../types/intake'

function SummarySection({
  title,
  items,
}: {
  title: string
  items: SummaryEntry[]
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
              <dd>{item.displayValue}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

export function SummaryPage({ summary, onRestart }: { summary: IntakeSummary; onRestart: () => void }) {
  const copySummary = async () => {
    const lines = [
      `患者类型：${summary.patientType}`,
      `主诉：${summary.chiefComplaints.join('、') || '未识别'}`,
      ...summary.onset.map((item) => `${item.label}：${item.displayValue}`),
      ...summary.currentSymptoms.map((item) => `${item.label}：${item.displayValue}`),
      ...summary.associatedSymptoms.map((item) => `${item.label}：${item.displayValue}`),
      ...summary.measuresTaken.map((item) => `${item.label}：${item.displayValue}`),
      `尚未获取：${summary.unansweredInformation.join('、') || '无'}`,
      `用户暂不清楚：${summary.skippedInformation.join('、') || '无'}`,
      summary.disclaimer,
    ]
    await navigator.clipboard.writeText(lines.join('\n'))
  }

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
        <h2>尚未询问或未获取</h2>
        <p>{summary.unansweredInformation.join('、') || '无'}</p>
      </section>

      <section className="missing-section">
        <h2>用户暂不清楚</h2>
        <p>{summary.skippedInformation.join('、') || '无'}</p>
      </section>

      <p className="summary-disclaimer">{summary.disclaimer}</p>
      <div className="summary-actions">
        <button onClick={() => void copySummary()}>复制摘要</button>
        <button className="secondary-action" onClick={() => window.print()}>打印或保存为 PDF</button>
        <button className="secondary-action" onClick={onRestart}>重新开始</button>
      </div>
    </main>
  )
}
