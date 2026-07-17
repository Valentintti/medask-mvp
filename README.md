# MedAsk 患者端预问诊 MVP

MedAsk 是一个面向演示和产品验证的成人预问诊信息整理工具：**帮助患者在就医前整理症状信息**。流程与风险始终由透明、确定性的规则驱动；可选模型仅提出槽位候选或改写非风险问题。系统只把用户提供的信息整理成结构化摘要，不进行疾病诊断、疾病概率估计、药物推荐、剂量建议或治疗方案生成。

在线网页：https://valentintti.github.io/medask-mvp/

GitHub Pages 版本是纯前端规则演示，不请求 Node API，也不调用真实 DeepSeek API。本地完整版仍支持受确定性 Harness 约束的服务端 Provider。两种版本都不提供诊断、用药或治疗建议。

## 产品定位与目标用户

- 目标用户：18—65 岁、希望在联系人工或线下医疗服务前整理发热、咳嗽、头痛、头晕或实验性腹痛信息的成人。
- 产品作用：通过最多 7 轮追问，整理主诉、起病时间、当前症状、伴随症状和已采取措施。
- 当前不是：临床分诊系统、诊断系统、处方工具或医生替代品。

## 当前演示范围

当前规则版支持四个稳定症状主诉和一个实验性主诉：

- 发热：起病时间、当前/最高体温、发热规律、畏寒或寒战、伴随咳嗽或头痛、呼吸困难、胸痛、已采取措施。
- 咳嗽：起病时间、持续时间、干咳/有痰、痰液颜色、伴随发热及最高体温、胸部不适、呼吸困难、夜间加重、已采取措施。
- 头痛：开始时间、出现速度、功能影响、位置、发作规律、疼痛体验、单次持续时间、已采取措施。
- 头晕：开始时间、主观体验、功能影响、发作规律、诱发方式、平衡影响、单次持续时间、已采取措施。
- 腹痛（实验性）：开始时间、位置、规律、功能影响、疼痛原始描述、一个优先伴随情况、已采取措施。人工数据门禁未完全通过，当前仅作为保守规则与 Mock 工程 Demo。

多主诉会共享起病时间和已采取措施；发热/咳嗽既有共享槽位保持不变。条件槽位只在前置回答成立时出现，例如有痰才询问痰液颜色。胸部不适仍未进入普通产品流程。GitHub Pages规则版和开发Mock支持实验性腹痛；真实Provider仍只放行既有的发热与咳嗽。

## 安全边界

Demo 使用保守风险规则识别明确胸痛、明显呼吸困难、意识异常或昏厥，头痛/头晕伴明确的突然语言、视力、单侧肢体异常，以及实验性腹痛中的当前突然剧烈腹痛、呕血、明显便血或黑便、明显腹胀且无法排便排气等明确表达。命中后立即停止普通流程，Provider 调用次数为 0，并显示固定的人工/线下就医提示。规则不是完整临床分诊标准，也不对风险原因作疾病判断。

风险和主诉识别采用候选词级局部上下文判断。明确的“没有、无、否认、未出现、不伴”等否定表达不会被当作阳性；转折或复发后的再次出现会被单独判断。该规则仍是有限的演示语言规则，不代表完整语义理解。

`policyGuard` 会拦截系统生成的确诊、疾病概率、处方、药物推荐、剂量、治疗方案和“替代医生”等越界内容。摘要只来自当前会话中用户主动提供或回答的信息。

用户原文与系统模板分开处理：用户自述的既往诊断或开药信息可以被忠实记录，并显示“用户自述”前缀；`policyGuard` 只审核系统生成内容。摘要把尚未获取、用户主动跳过和条件不适用分别记录，体温同时在页面和控制器执行 30—45℃ 校验。

首句规则提取也使用局部语境：历史且已退热的读数不会写成当前体温，“最高体温”与“当前体温”分别提取，“不是干咳、而是有痰”等转折以后半段当前肯定表达为准。条件槽位只有在前置答案明确且条件不成立时才标记为“不适用”；前置答案未知时仍属于“尚未获取”。

## 状态机

会话状态依次为：

1. `idle`：会话尚未开始。
2. `collecting`：年龄和主诉受支持，按优先级收集槽位。
3. `completed`：达到 7 轮上限或没有剩余槽位，生成结构化摘要。
4. `escalated`：命中保守风险规则，停止普通问诊。
5. `unsupported`：年龄或人群不在演示范围，或规则无法识别当前支持的主诉。

每次规则决策只写入当前内存会话的 Trace，不写入浏览器控制台，也不持久化。

## 为什么模型只做受控辅助

状态机、槽位依赖、安全边界、风险中断和可测试性必须保持确定性。真实模型默认关闭，未配置时项目仍完整运行纯规则和 Mock 流程；当前规则不会假装理解全部自然语言。

未来可以让模型辅助：

- 把用户自由文本映射到已有槽位；
- 识别同义表达和口语化时间；
- 在不改变风险与政策护栏的前提下生成更自然的追问措辞。

风险升级、年龄范围、最大轮数、结构化输出边界和政策拦截仍应由确定性 Harness 控制。

## 受控模型适配层与服务端代理

项目具备纯规则、开发 Mock 和 Real LLM 三种模式。真实模式通过 Node/TypeScript 服务端代理访问 OpenAI-compatible Chat Completions API，默认关闭；Key、模型、端点和固定系统提示词都不会进入浏览器。生产环境不显示 Mock，服务端未启用时 Real LLM 不可选。

模型与Harness的边界如下：

- Provider只接收当前任务需要的主诉、允许槽位、当前槽位、当前文本、已有槽位ID、语言和Schema版本。
- 原始文本先经过确定性风险检查；风险命中时立即升级，Provider不会被调用。
- 模型输出使用破坏性升级后的 Schema 1.1：`unresolvedSlotIds` 只能引用本轮允许槽位，顶层和候选对象出现 diagnosis、treatment、medication、状态控制等额外字段会整次拒绝。
- 模型 evidence 会先在完整 `userText` 中定位全部出现位置，再按局部子句分析否定、历史、已缓解、假设和当前肯定语境；缩短 evidence 不能绕过“没有发热”等上下文。
- 只有置信度不低于0.90、状态为asserted且至少存在一个当前肯定语境的非风险候选，才可能由Harness二次校验后写入answers。historical、resolved、hypothetical、negated和uncertain均不写当前槽位。
- 胸痛、呼吸困难和意识相关风险槽位永远不能由模型自动确认。
- 与已有答案相同的候选是no-op；不同值不覆盖，由Harness生成固定澄清问题。
- Provider接口支持`AbortSignal`。异常、超时、会话重启、页面卸载、非法JSON或非法改写都会取消或回退到标准问题，不自动重试，迟到响应不能写入新会话。

问题改写只影响页面显示措辞，不修改slotId、required、showWhen、maxTurns或问诊状态。风险槽位不会调用改写Provider；普通改写必须保持否定极性、时间范围、问句类型、单位和必答含义，否则回退标准问题。完整设计见 [`docs/llm-adapter-design.md`](docs/llm-adapter-design.md)。

合成离线评测集位于 `src/llm/evals/slotExtractionCases.ts`，包含30条人工编写案例。有效提取、风险前置、非法输出、低置信、uncertain和冲突分别使用独立分母；空分母不会被记为100%。这些是可重复的工程指标，不是临床准确率，AI高置信或一致也不等于正确。

服务端不信任浏览器槽位范围，而是从服务端编译的主诉规则重新计算白名单；客户端只能缩小范围。服务端还对请求字段、Content-Type、长度、Origin、速率、每日预算和严格 JSON 响应做独立校验，并保留固定字段的最小化审计元数据。完整说明见 [`docs/real-provider-security.md`](docs/real-provider-security.md)。

## 与数据工程项目的关系

`medical-intake-data` 是独立、只读的数据治理与评测项目；本仓库是患者端产品代码。这里只迁移了抽象后的标签定义、规则思想和演示配置，没有复制原始医疗数据、行级患者文本或人工金标 CSV。

## 目录

```text
src/
├─ types/intake.ts
├─ data/
│  ├─ complaintRules.ts
│  └─ riskRules.ts
├─ engines/
│  ├─ riskEngine.ts
│  ├─ complaintEngine.ts
│  ├─ slotEngine.ts
│  └─ summaryEngine.ts
├─ harness/
│  ├─ intakeController.ts
│  ├─ sessionState.ts
│  ├─ policyGuard.ts
│  └─ traceLogger.ts
├─ components/
├─ pages/
└─ tests/
server/
├─ routes/llmRoutes.ts
├─ providers/openAiCompatibleProvider.ts
├─ prompts/
└─ security/
shared/llm/
```

## 本地运行

需要 Node.js 20.19+ 或 22.12+，以及 pnpm。

```bash
pnpm install
pnpm dev
```

默认访问地址为 `http://127.0.0.1:5173/`。

`pnpm dev` 同时启动 Vite 前端和 `http://127.0.0.1:8787` 服务端。也可分别运行 `pnpm dev:client`、`pnpm dev:server`。若要在本机试用真实模式，请复制 `.env.example` 为 `.env`，自行填写 Key、Base URL、Model，并明确设置 `ENABLE_REAL_LLM=true`；不要提交 `.env`。

DeepSeek Strict Function Calling 默认关闭：`DEEPSEEK_STRICT_TOOL_ENABLED=false`。当前 Provider 会直接使用 `json_object`，结果仍经过服务端 Schema、evidence 和 Harness 校验。只有确认账户与模型支持时才显式改为 `true`；若首次返回明确不支持，当前服务进程会缓存该能力状态，后续请求直接使用 JSON 模式。

开发环境显示纯规则、Mock、Real 和三个合成演示案例；生产构建不显示 Mock、Demo 开关或 Trace。生产页面会根据 `/api/llm/status` 在“自然语言辅助可用”和“当前使用标准规则模式”之间切换，不展示模型品牌、置信度、Schema 或内部规则。

## 测试与构建

```bash
pnpm test
pnpm build
pnpm eval:real
```

测试覆盖主诉识别、局部否定与转折、动态槽位、共享槽位、7 轮上限、风险升级、用户原文与系统输出隔离、缺失信息分类、数值双层校验、安全错误边界、Trace 状态变化和页面完整流程。

`pnpm build` 会分别构建浏览器和服务端产物，并扫描浏览器 bundle，防止服务端 Key 或内部配置标记被打包。`pnpm eval:real` 在没有完整本机配置时安全跳过，不调用 API；配置后也只对合成文本运行三轮工程评测，不使用真实患者数据。

## 生产构建与 Render Node

本地生产构建：

```bash
pnpm build
pnpm start
```

生产 Node 服务默认监听 `0.0.0.0:8787`，优先使用环境变量 `HOST`、`PORT`。它在同一端口提供 `dist/` 前端、SPA 路由、`/api/llm/*` 和 `/health`；浏览器生产请求始终使用同源 `/api`。Render 会注入 `PORT`，本地未提供时回退到 `8787`。

Render Web Service 使用原生 Node 环境，`.node-version` 锁定 Node `22.22.0`：

- Build Command：`pnpm install --frozen-lockfile && pnpm build`
- Start Command：`pnpm start`
- Health Check Path：`/health`

Render Environment 需配置：`ENABLE_REAL_LLM`、`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`DEEPSEEK_STRICT_TOOL_ENABLED`、`LLM_REQUEST_TIMEOUT_MS`、`LLM_MAX_REQUESTS_PER_MINUTE`、`LLM_DAILY_TOKEN_BUDGET`、`HOST`、`ALLOWED_ORIGINS`。`HOST` 设为 `0.0.0.0`；`PORT` 由 Render 注入，不需要手动配置。获得 Render HTTPS 域名后，将该域名加入 `ALLOWED_ORIGINS`。Key 只在 Render 后台填写，不写入仓库。

## 可选本地 Docker 方案

Render 线上部署不使用 Docker。可选的本地 Compose 方案仍明确使用 `deploy/Dockerfile.local`，构建独立的 Nginx 前端和 Node 服务端：

```bash
copy .env.example .env
# 仅在本机 .env 填写服务端配置，不要提交
docker compose up --build
```

- 前端：`http://127.0.0.1:5173/`
- 服务端：`http://127.0.0.1:8787/`
- 健康检查：`http://127.0.0.1:8787/health`

生产变量示例分别位于 `deploy/frontend.env.example` 与 `deploy/server.env.example`。`.dockerignore` 排除了 `.env`、日志、覆盖率、构建产物和评测临时结果；真实 Key 只存在于部署环境，不写入镜像层或 Git。

## 产品展示材料

- [`docs/product-case-study.md`](docs/product-case-study.md)：数据治理、Human-in-the-loop、规则/模型架构与产品取舍。
- [`docs/demo-script.md`](docs/demo-script.md)：3—5 分钟面试演示脚本。
- [`docs/evaluation-summary.md`](docs/evaluation-summary.md)：规则、Mock 和真实 DeepSeek 的工程评测口径与限制。

## 下一阶段建议

1. 用经人工审核的非敏感测试用例扩充规则回归集。
2. 对可用性和无障碍进行小规模用户测试。
3. 在隔离测试环境用合成文本评估已配置 Provider，不直接对普通用户开放。
4. 公开部署前完成隐私、供应商数据留存、密钥轮换、集中限流与合规审查。

> 本项目只验证语言信息整理流程，不代表临床准确率或医疗有效性。
