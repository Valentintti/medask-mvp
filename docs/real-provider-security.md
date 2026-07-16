# MedAsk 真实 Provider 服务端代理安全说明

## 架构与边界

真实模型链路为：React 浏览器 → 同源 `/api/llm/extract` 或 `/api/llm/rewrite` → Node/TypeScript 安全代理 → OpenAI-compatible Chat Completions API。浏览器传来的所有字段都不可信，无法指定 API 地址、模型、temperature、系统提示词、超时或重试次数；这些值只从服务端环境读取。

模型只提出槽位候选或改写非风险问题。会话状态、轮数、风险升级、槽位依赖、数值校验和最终写入仍由确定性 Harness 控制。模型不能诊断疾病，也不能输出药物、剂量、检查或治疗建议。

## 环境变量与密钥保护

复制 `.env.example` 为本机 `.env` 后自行填写。只有 `ENABLE_REAL_LLM=true` 且 Key、Base URL、Model 均有效时，服务端才开放真实调用；否则 `/api/llm/extract` 和 `/api/llm/rewrite` 返回受控 503。

`.env`、日志和构建目录受 `.gitignore` 保护。密钥没有 `VITE_` 前缀，不会注入前端构建；构建命令还会扫描客户端产物中的密钥值和服务端配置标记。服务端仅在上游请求的 `Authorization` Header 中使用密钥，审计日志不会记录密钥或完整 Header。配置缺失时真实调用保持关闭并返回受控 503。

## 数据最小化

提取请求只允许七个字段：`supportedComplaints`、`allowedSlotIds`、`currentQuestionSlotId`、`userText`、`existingSlotIds`、`locale`、`schemaVersion`。不发送 Trace、内部风险规则、数据集、人工标注或其他会话。

服务端删除控制/不可见字符，拒绝空文本和超过 500 字符的文本，限制槽位数量，并对字段、主诉、槽位和 Schema 版本做白名单校验。服务端从自身编译的 `complaintRules` 重新计算合法槽位：客户端 `allowedSlotIds` 只能缩小这个集合，不能扩大；`currentQuestionSlotId` 必须属于相应主诉；问题改写的标准问题、必答属性、输入类型和单位由服务端重建。模型响应必须是单个严格 JSON 对象；Markdown、前言、超限响应、额外字段和越界槽位都会被拒绝。

## 风险顺序与 Prompt 注入防护

浏览器先对原始文本运行确定性 `riskEngine`。胸痛、明显呼吸困难或意识异常命中后立即升级，模型请求次数为零。服务端对直接请求再次做风险预检；风险槽位从模型允许槽位中移除，风险问题也禁止模型改写。

系统提示词固定声明用户文本是不可信数据。模型仍可能尝试输出诊断、药名、伪造 evidence、Markdown 或额外字段，但服务端严格 Schema、前端 Schema、完整原文 evidence 定位、Acceptance Policy 和 Harness 二次校验会阻止违规结果进入 Harness 或用户界面。Prompt 防护是分层工程控制，不等于模型永远不会尝试违规输出。

## 限流、预算、超时和降级

- 每个内存客户端键每分钟默认最多 10 次；IP 只用于加盐不可逆哈希，不写日志。
- 相同操作短时间内只允许一次，前端每轮最多一次提取、每题最多一次改写。
- 中文字符按约 2 字符/Token 做保守估算；这是 Demo 预算门禁，不是精确计费器。
- 每日估算预算默认 50,000 Token，耗尽后返回 503 并继续规则流程。
- 上游使用 `AbortSignal`；默认 8 秒是包含等待和重试在内的总超时。400、401、403 和 Schema 错误不重试；429 仅在 `Retry-After` 仍落在总预算内时重试；5xx 或网络错误最多重试一次；取消后不重试。
- 429、503、超时、非法响应或会话重启都会回退标准问题，迟到结果不能修改新会话。

## 日志与隐私

审计只记录 `requestId`、`operation`、`providerAlias`、`modelAlias`、`timestamp`、`latencyMs`、`httpStatus`、`outcome`、`inputCharacterCount`、`outputCharacterCount` 和 `errorCategory`。禁止记录完整 userText、evidence、原始模型输出、完整 IP、年龄症状组合、Key 或 Authorization。

限流、操作去重和每日预算是本地 Demo 的单进程内存实现：进程重启后计数会重置，多实例之间不共享。生产环境必须使用 Redis、API Gateway 或等效共享存储，配合统一限流、预算和幂等键。

即使请求字段已经最小化，`userText` 仍可能包含敏感健康信息。启用真实模式前必须提供清晰的隐私告知并取得用户同意，同时核验模型供应商的数据使用、留存和跨境政策。

公开部署前还需要完成隐私告知、用户同意、数据处理协议、供应商留存策略审查、传输/静态加密、密钥轮换、集中式限流、告警、访问控制、删除流程和适用地区医疗/隐私合规评估。第三方兼容服务的数据使用与留存政策必须单独核验。

## 合成评测

`pnpm eval:real` 只有在本机配置完整并显式启用后才运行。脚本仅使用人工编写的合成案例，重复三轮并报告 Schema 有效率、提取 precision/recall/exact、evidence grounding、非法输出拒绝、风险前置、泄漏计数、稳定性、延迟和估算 Token。未配置模型单价时不虚构成本。每次真实合成评测都必须记录模型别名、固定 Prompt 版本、Schema 版本和 Git 提交，以便复现与审计。

这些结果只是语言工程质量，不是临床准确率；高置信或多轮一致也不能自动视为正确。
