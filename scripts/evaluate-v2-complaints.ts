import { evaluateV2ComplaintCases } from '../src/evals/evaluateV2Complaints'

const report = await evaluateV2ComplaintCases()
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
