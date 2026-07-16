export function SafeErrorPage({ onRestart }: { onRestart?: () => void }) {
  return (
    <main className="result-page error-page" role="alert">
      <span className="eyebrow">SAFE STOP</span>
      <h1>本次信息整理暂时无法继续</h1>
      <p className="result-message">请返回首页后重试；如仍有不适，请联系人工或线下医疗服务。</p>
      <p className="fine-print">为保护隐私，此页面不会展示原始输入或内部错误详情。</p>
      {onRestart && <button onClick={onRestart}>返回首页</button>}
    </main>
  )
}
