/**
 * MedAsk V2 complaint design evaluation set.
 *
 * Every sentence in this file is manually authored synthetic text. No real patient
 * text and no doctor answer is used. Results measure language/engineering behavior,
 * not diagnosis, clinical accuracy, treatment effectiveness, or medical safety.
 */

export type V2ComplaintId =
  | 'headache'
  | 'dizziness'
  | 'abdominal_pain'
  | 'chest_discomfort'

export type RecognizableComplaintId = V2ComplaintId | 'fever' | 'cough'

export type ComplaintContextStatus =
  | 'asserted'
  | 'negated'
  | 'historical'
  | 'resolved'
  | 'hypothetical'
  | 'uncertain'

export type V2ComplaintCaseCategory =
  | 'current_affirmed'
  | 'negated'
  | 'historical'
  | 'resolved'
  | 'hypothetical'
  | 'ambiguous'
  | 'multi_complaint'
  | 'risk_expression'
  | 'unsupported_population'
  | 'invalid_template'
  | 'slot_conflict'

export type ExpectedRoute = 'collect' | 'clarify' | 'interrupt' | 'unsupported' | 'reject'

export type SyntheticPopulation =
  | 'adult_18_65'
  | 'under_18'
  | 'over_65'
  | 'pregnancy'
  | 'postpartum'

export type EvalAnswerValue = string | number | boolean | string[]

export interface ExpectedSlotCandidate {
  slotId: string
  value: EvalAnswerValue
  evidence: string
  status: ComplaintContextStatus
}

export interface V2ComplaintExpectation {
  complaintStatus: ComplaintContextStatus
  route: ExpectedRoute
  matchedComplaints: RecognizableComplaintId[]
  slotCandidates: ExpectedSlotCandidate[]
  acceptedSlotIds: string[]
  riskRuleId?: string
  conflictSlotIds?: string[]
}

export interface V2ComplaintEvalCase {
  id: string
  complaint: V2ComplaintId
  category: V2ComplaintCaseCategory
  userText: string
  age?: number
  population?: SyntheticPopulation
  existingAnswers?: Record<string, EvalAnswerValue>
  expected: V2ComplaintExpectation
}

type ExpectationExtra = Partial<
  Omit<V2ComplaintExpectation, 'complaintStatus' | 'route' | 'slotCandidates' | 'acceptedSlotIds'>
> & { acceptedSlotIds?: string[] }

type CaseExtra = Pick<V2ComplaintEvalCase, 'age' | 'population' | 'existingAnswers'>

const slot = (
  slotId: string,
  value: EvalAnswerValue,
  evidence: string,
  status: ComplaintContextStatus = 'asserted',
): ExpectedSlotCandidate => ({ slotId, value, evidence, status })

const defineCase = (
  id: string,
  complaint: V2ComplaintId,
  category: V2ComplaintCaseCategory,
  userText: string,
  complaintStatus: ComplaintContextStatus,
  route: ExpectedRoute,
  slotCandidates: ExpectedSlotCandidate[] = [],
  expectationExtra: ExpectationExtra = {},
  caseExtra: Partial<CaseExtra> = {},
): V2ComplaintEvalCase => ({
  id,
  complaint,
  category,
  userText,
  ...caseExtra,
  expected: {
    complaintStatus,
    route,
    matchedComplaints:
      complaintStatus === 'asserted' && (route === 'collect' || route === 'clarify')
        ? [complaint]
        : [],
    slotCandidates,
    acceptedSlotIds: slotCandidates.map((item) => item.slotId),
    ...expectationExtra,
  },
})

const headacheCases: V2ComplaintEvalCase[] = [
  defineCase('headache-current-01', 'headache', 'current_affirmed', '今天早上开始头痛。', 'asserted', 'collect', [slot('onset', '今天早上', '今天早上开始')]),
  defineCase('headache-current-02', 'headache', 'current_affirmed', '左边太阳穴一阵一阵疼。', 'asserted', 'collect', [slot('headacheLocation', 'temple', '太阳穴'), slot('headachePattern', 'intermittent', '一阵一阵')]),
  defineCase('headache-current-03', 'headache', 'current_affirmed', '后脑勺一直有胀痛。', 'asserted', 'collect', [slot('headacheLocation', 'occipital', '后脑勺'), slot('headacheSensation', '胀痛', '胀痛'), slot('headachePattern', 'continuous', '一直')]),
  defineCase('headache-current-04', 'headache', 'current_affirmed', '头疼是慢慢出现的，已经两小时。', 'asserted', 'collect', [slot('headacheOnsetSpeed', 'gradual', '慢慢出现'), slot('headacheEpisodeDuration', '两小时', '两小时')]),
  defineCase('headache-current-05', 'headache', 'current_affirmed', '头痛反复出现，工作时很难集中。', 'asserted', 'collect', [slot('headachePattern', 'recurrent', '反复出现'), slot('headacheFunctionalImpact', 'moderate', '很难集中')]),
  defineCase('headache-current-06', 'headache', 'current_affirmed', '现在头疼，还伴有恶心和怕光。', 'asserted', 'collect', [slot('headacheNonRiskAssociated', ['恶心', '怕光'], '恶心和怕光')]),
  defineCase('headache-negated-01', 'headache', 'negated', '我没有头痛，只是有点头晕。', 'negated', 'reject'),
  defineCase('headache-negated-02', 'headache', 'negated', '不头疼，也没有太阳穴疼。', 'negated', 'reject'),
  defineCase('headache-negated-03', 'headache', 'negated', '否认头痛，目前只是脖子酸。', 'negated', 'reject'),
  defineCase('headache-historical-01', 'headache', 'historical', '去年有过几次头痛，现在没有。', 'historical', 'reject'),
  defineCase('headache-historical-02', 'headache', 'historical', '小时候经常头疼，这次不是。', 'historical', 'reject'),
  defineCase('headache-historical-03', 'headache', 'historical', '以前太阳穴疼过，今天只是来整理旧记录。', 'historical', 'reject'),
  defineCase('headache-resolved-01', 'headache', 'resolved', '刚才头痛，现在已经完全好了。', 'resolved', 'collect', [], { matchedComplaints: ['headache'] }),
  defineCase('headache-resolved-02', 'headache', 'resolved', '早上头疼，休息后已经消失。', 'resolved', 'collect', [], { matchedComplaints: ['headache'] }),
  defineCase('headache-resolved-03', 'headache', 'resolved', '之前后脑勺疼，现在不疼了。', 'resolved', 'collect', [], { matchedComplaints: ['headache'] }),
  defineCase('headache-hypothetical-01', 'headache', 'hypothetical', '如果以后突然头痛，我想先了解会收集哪些信息。', 'hypothetical', 'reject'),
  defineCase('headache-ambiguous-01', 'headache', 'ambiguous', '脑袋有点不对劲，说不上是不是疼。', 'uncertain', 'clarify'),
  defineCase('headache-ambiguous-02', 'headache', 'ambiguous', '前段时间头疼，没说现在还有没有。', 'uncertain', 'clarify'),
  defineCase('headache-ambiguous-03', 'headache', 'ambiguous', '额头磕到后表面疼，不确定算不算头痛。', 'uncertain', 'clarify'),
  defineCase('headache-multi-01', 'headache', 'multi_complaint', '今天头痛，也一直头晕。', 'asserted', 'collect', [slot('onset', '今天', '今天')], { matchedComplaints: ['headache', 'dizziness'] }),
  defineCase('headache-multi-02', 'headache', 'multi_complaint', '发热以后开始头疼，现在两种不适都在。', 'asserted', 'collect', [], { matchedComplaints: ['fever', 'headache'] }),
  defineCase('headache-multi-03', 'headache', 'multi_complaint', '头疼同时胸口发闷，但没有胸痛也不气短。', 'asserted', 'collect', [], { matchedComplaints: ['headache', 'chest_discomfort'] }),
  defineCase('headache-risk-01', 'headache', 'risk_expression', '头痛突然爆发，几秒内就痛到最严重。', 'asserted', 'interrupt', [], { riskRuleId: 'risk.headache.sudden_severe' }),
  defineCase('headache-risk-02', 'headache', 'risk_expression', '现在头痛，说话突然含糊，右手也抬不起来。', 'asserted', 'interrupt', [], { riskRuleId: 'risk.neurologic.sudden_deficit' }),
  defineCase('headache-risk-03', 'headache', 'risk_expression', '刚从高处摔到头，现在头痛越来越重。', 'asserted', 'interrupt', [], { riskRuleId: 'risk.headache.after_head_injury' }),
  defineCase('headache-risk-04', 'headache', 'risk_expression', '剧烈头痛，同时意识很混乱，还抽搐了一次。', 'asserted', 'interrupt', [], { riskRuleId: 'risk.consciousness.altered_or_seizure' }),
  defineCase('headache-unsupported-01', 'headache', 'unsupported_population', '我17岁，今天开始头痛。', 'asserted', 'unsupported', [], {}, { age: 17, population: 'under_18' }),
  defineCase('headache-unsupported-02', 'headache', 'unsupported_population', '我怀孕二十周，这两天一直头痛。', 'asserted', 'unsupported', [], {}, { age: 30, population: 'pregnancy' }),
  defineCase('headache-invalid-01', 'headache', 'invalid_template', '患者年龄： 主诉： 头痛：', 'uncertain', 'reject'),
  defineCase('headache-invalid-02', 'headache', 'invalid_template', '问题描述问题描述，请填写头痛模板。', 'uncertain', 'reject'),
  defineCase('headache-conflict-01', 'headache', 'slot_conflict', '其实是今天早上开始头痛。', 'asserted', 'clarify', [slot('onset', '今天早上', '今天早上开始')], { conflictSlotIds: ['onset'], acceptedSlotIds: [] }, { existingAnswers: { onset: '昨天晚上' } }),
  defineCase('headache-conflict-02', 'headache', 'slot_conflict', '现在主要是后脑勺疼。', 'asserted', 'clarify', [slot('headacheLocation', 'occipital', '后脑勺')], { conflictSlotIds: ['headacheLocation'], acceptedSlotIds: [] }, { existingAnswers: { headacheLocation: 'forehead' } }),
  defineCase('headache-conflict-03', 'headache', 'slot_conflict', '不是间歇，是一直疼。', 'asserted', 'clarify', [slot('headachePattern', 'continuous', '一直疼')], { conflictSlotIds: ['headachePattern'], acceptedSlotIds: [] }, { existingAnswers: { headachePattern: 'intermittent' } }),
]

const dizzinessCases: V2ComplaintEvalCase[] = [
  defineCase('dizziness-current-01', 'dizziness', 'current_affirmed', '今天起床后开始头晕。', 'asserted', 'collect', [slot('onset', '今天起床后', '今天起床后开始')]),
  defineCase('dizziness-current-02', 'dizziness', 'current_affirmed', '感觉房间在转。', 'asserted', 'collect', [slot('dizzinessExperience', 'spinning', '房间在转')]),
  defineCase('dizziness-current-03', 'dizziness', 'current_affirmed', '整个人晕乎乎的，像发飘。', 'asserted', 'collect', [slot('dizzinessExperience', 'floating', '晕乎乎')]),
  defineCase('dizziness-current-04', 'dizziness', 'current_affirmed', '每次站起来会发晕，大约半分钟。', 'asserted', 'collect', [slot('dizzinessTrigger', 'standing_up', '站起来'), slot('dizzinessEpisodeDuration', '半分钟', '半分钟')]),
  defineCase('dizziness-current-05', 'dizziness', 'current_affirmed', '头晕反复出现，但还能自己走路。', 'asserted', 'collect', [slot('dizzinessPattern', 'recurrent', '反复出现'), slot('balanceImpact', 'independent', '还能自己走路')]),
  defineCase('dizziness-current-06', 'dizziness', 'current_affirmed', '现在头昏，工作时很难集中。', 'asserted', 'collect', [slot('dizzinessFunctionalImpact', 'moderate', '很难集中')]),
  defineCase('dizziness-negated-01', 'dizziness', 'negated', '没有头晕，只是头疼。', 'negated', 'reject'),
  defineCase('dizziness-negated-02', 'dizziness', 'negated', '我不晕，走路也不发飘。', 'negated', 'reject'),
  defineCase('dizziness-negated-03', 'dizziness', 'negated', '否认眩晕，也没有站不稳。', 'negated', 'reject'),
  defineCase('dizziness-historical-01', 'dizziness', 'historical', '去年有过眩晕，现在没有。', 'historical', 'reject'),
  defineCase('dizziness-historical-02', 'dizziness', 'historical', '以前起身会头晕，最近没再发生。', 'historical', 'reject'),
  defineCase('dizziness-historical-03', 'dizziness', 'historical', '小时候晕车很厉害，这次不是头晕。', 'historical', 'reject'),
  defineCase('dizziness-resolved-01', 'dizziness', 'resolved', '刚才站起来头晕了一下，现在好了。', 'resolved', 'collect', [], { matchedComplaints: ['dizziness'] }),
  defineCase('dizziness-resolved-02', 'dizziness', 'resolved', '早上天旋地转，现在已经完全消失。', 'resolved', 'collect', [], { matchedComplaints: ['dizziness'] }),
  defineCase('dizziness-resolved-03', 'dizziness', 'resolved', '之前走路发飘，目前恢复正常。', 'resolved', 'collect', [], { matchedComplaints: ['dizziness'] }),
  defineCase('dizziness-hypothetical-01', 'dizziness', 'hypothetical', '如果以后出现头晕，我想先了解会问哪些内容。', 'hypothetical', 'reject'),
  defineCase('dizziness-ambiguous-01', 'dizziness', 'ambiguous', '脑子有点发蒙，不确定是不是头晕。', 'uncertain', 'clarify'),
  defineCase('dizziness-ambiguous-02', 'dizziness', 'ambiguous', '前几天有点晕，没说明现在还有没有。', 'uncertain', 'clarify'),
  defineCase('dizziness-ambiguous-03', 'dizziness', 'ambiguous', '看屏幕看得有点晕，关掉以后情况不清楚。', 'uncertain', 'clarify'),
  defineCase('dizziness-multi-01', 'dizziness', 'multi_complaint', '头晕同时头痛，两种现在都有。', 'asserted', 'collect', [], { matchedComplaints: ['dizziness', 'headache'] }),
  defineCase('dizziness-multi-02', 'dizziness', 'multi_complaint', '肚子疼以后开始头晕，现在都没缓解。', 'asserted', 'collect', [], { matchedComplaints: ['abdominal_pain', 'dizziness'] }),
  defineCase('dizziness-multi-03', 'dizziness', 'multi_complaint', '头晕，还有一点胸闷，但不胸痛也不气短。', 'asserted', 'collect', [], { matchedComplaints: ['dizziness', 'chest_discomfort'] }),
  defineCase('dizziness-risk-01', 'dizziness', 'risk_expression', '突然头晕，左边脸和手臂都没力气。', 'asserted', 'interrupt', [], { riskRuleId: 'risk.neurologic.sudden_deficit' }),
  defineCase('dizziness-risk-02', 'dizziness', 'risk_expression', '头晕后晕倒了，现在很难叫醒。', 'asserted', 'interrupt', [], { riskRuleId: 'risk.consciousness.altered' }),
  defineCase('dizziness-risk-03', 'dizziness', 'risk_expression', '现在头晕并且胸口很痛。', 'asserted', 'interrupt', [], { riskRuleId: 'risk.chest_pain.explicit' }),
  defineCase('dizziness-risk-04', 'dizziness', 'risk_expression', '头晕又喘不上气，连完整一句话都说不了。', 'asserted', 'interrupt', [], { riskRuleId: 'risk.breathing.severe' }),
  defineCase('dizziness-unsupported-01', 'dizziness', 'unsupported_population', '我70岁，最近起身头晕。', 'asserted', 'unsupported', [], {}, { age: 70, population: 'over_65' }),
  defineCase('dizziness-unsupported-02', 'dizziness', 'unsupported_population', '刚生产两周，现在经常头晕。', 'asserted', 'unsupported', [], {}, { age: 28, population: 'postpartum' }),
  defineCase('dizziness-invalid-01', 'dizziness', 'invalid_template', '患者姓名： 年龄： 头晕情况：', 'uncertain', 'reject'),
  defineCase('dizziness-invalid-02', 'dizziness', 'invalid_template', '请复制模板并填写，眩晕眩晕。', 'uncertain', 'reject'),
  defineCase('dizziness-conflict-01', 'dizziness', 'slot_conflict', '其实每次大约两分钟。', 'asserted', 'clarify', [slot('dizzinessEpisodeDuration', '两分钟', '两分钟')], { conflictSlotIds: ['dizzinessEpisodeDuration'], acceptedSlotIds: [] }, { existingAnswers: { dizzinessEpisodeDuration: '半分钟' } }),
  defineCase('dizziness-conflict-02', 'dizziness', 'slot_conflict', '不是天旋地转，是发飘。', 'asserted', 'clarify', [slot('dizzinessExperience', 'floating', '发飘')], { conflictSlotIds: ['dizzinessExperience'], acceptedSlotIds: [] }, { existingAnswers: { dizzinessExperience: 'spinning' } }),
  defineCase('dizziness-conflict-03', 'dizziness', 'slot_conflict', '现在改成一直头晕，不是间歇。', 'asserted', 'clarify', [slot('dizzinessPattern', 'continuous', '一直头晕')], { conflictSlotIds: ['dizzinessPattern'], acceptedSlotIds: [] }, { existingAnswers: { dizzinessPattern: 'intermittent' } }),
]

const abdominalPainCases: V2ComplaintEvalCase[] = [
  defineCase('abdominal-current-01', 'abdominal_pain', 'current_affirmed', '昨晚开始肚子疼。', 'asserted', 'collect', [slot('onset', '昨晚', '昨晚开始')]),
  defineCase('abdominal-current-02', 'abdominal_pain', 'current_affirmed', '右边下腹一直疼。', 'asserted', 'collect', [slot('abdominalLocation', 'lower_right', '右边下腹'), slot('episodePattern', 'continuous', '一直')]),
  defineCase('abdominal-current-03', 'abdominal_pain', 'current_affirmed', '肚脐周围一阵一阵绞痛。', 'asserted', 'collect', [slot('abdominalLocation', 'periumbilical', '肚脐周围'), slot('abdominalCharacter', '绞痛', '绞痛'), slot('episodePattern', 'intermittent', '一阵一阵')]),
  defineCase('abdominal-current-04', 'abdominal_pain', 'current_affirmed', '上腹隐隐疼，吃东西后更明显。', 'asserted', 'collect', [slot('abdominalLocation', 'upper', '上腹'), slot('abdominalCharacter', '隐痛', '隐隐疼'), slot('foodRelation', 'after_eating', '吃东西后更明显')]),
  defineCase('abdominal-current-05', 'abdominal_pain', 'current_affirmed', '腹痛反复出现，还伴有腹泻。', 'asserted', 'collect', [slot('episodePattern', 'recurrent', '反复出现'), slot('bowelChange', 'diarrhea', '腹泻')]),
  defineCase('abdominal-current-06', 'abdominal_pain', 'current_affirmed', '现在胃疼，影响睡觉，但没有呕吐。', 'asserted', 'collect', [slot('severityImpact', 'moderate', '影响睡觉'), slot('vomitingPresent', false, '没有呕吐', 'negated')], { acceptedSlotIds: ['severityImpact'] }),
  defineCase('abdominal-negated-01', 'abdominal_pain', 'negated', '没有腹痛，只是有点腹胀。', 'negated', 'reject'),
  defineCase('abdominal-negated-02', 'abdominal_pain', 'negated', '肚子不疼，也没有胃痛。', 'negated', 'reject'),
  defineCase('abdominal-negated-03', 'abdominal_pain', 'negated', '否认小腹疼，目前只是腰酸。', 'negated', 'reject'),
  defineCase('abdominal-historical-01', 'abdominal_pain', 'historical', '去年有过腹痛，现在没有。', 'historical', 'reject'),
  defineCase('abdominal-historical-02', 'abdominal_pain', 'historical', '以前经常胃疼，最近没再出现。', 'historical', 'reject'),
  defineCase('abdominal-historical-03', 'abdominal_pain', 'historical', '小时候肚子疼过，这次只是整理旧记录。', 'historical', 'reject'),
  defineCase('abdominal-resolved-01', 'abdominal_pain', 'resolved', '刚才肚子疼，现在完全好了。', 'resolved', 'reject'),
  defineCase('abdominal-resolved-02', 'abdominal_pain', 'resolved', '早上胃疼，后来已经消失。', 'resolved', 'reject'),
  defineCase('abdominal-resolved-03', 'abdominal_pain', 'resolved', '之前小腹疼，现在不疼了。', 'resolved', 'reject'),
  defineCase('abdominal-hypothetical-01', 'abdominal_pain', 'hypothetical', '如果以后肚子疼，我想先了解信息整理流程。', 'hypothetical', 'reject'),
  defineCase('abdominal-ambiguous-01', 'abdominal_pain', 'ambiguous', '胃里不太舒服，但说不上是不是疼。', 'uncertain', 'clarify'),
  defineCase('abdominal-ambiguous-02', 'abdominal_pain', 'ambiguous', '前几天肚子疼，没说明现在是否还在。', 'uncertain', 'clarify'),
  defineCase('abdominal-ambiguous-03', 'abdominal_pain', 'ambiguous', '做运动后腹肌酸，不确定是不是腹痛。', 'uncertain', 'clarify'),
  defineCase('abdominal-multi-01', 'abdominal_pain', 'multi_complaint', '肚子疼，同时有点头晕。', 'asserted', 'collect', [], { matchedComplaints: ['abdominal_pain', 'dizziness'] }),
  defineCase('abdominal-multi-02', 'abdominal_pain', 'multi_complaint', '腹痛并发热，两种现在都在。', 'asserted', 'collect', [], { matchedComplaints: ['abdominal_pain', 'fever'] }),
  defineCase('abdominal-multi-03', 'abdominal_pain', 'multi_complaint', '肚子疼又胸闷，但不胸痛也不气短。', 'asserted', 'collect', [], { matchedComplaints: ['abdominal_pain', 'chest_discomfort'] }),
  defineCase('abdominal-risk-01', 'abdominal_pain', 'risk_expression', '腹痛突然变得非常剧烈，痛得没法说话。', 'asserted', 'interrupt', [], { riskRuleId: 'risk.abdominal.sudden_severe' }),
  defineCase('abdominal-risk-02', 'abdominal_pain', 'risk_expression', '现在肚子很痛，还吐了血。', 'asserted', 'interrupt', [], { riskRuleId: 'risk.bleeding.vomit_or_stool' }),
  defineCase('abdominal-risk-03', 'abdominal_pain', 'risk_expression', '肚子明显胀起来，剧烈疼，完全不能排便也不能排气。', 'asserted', 'interrupt', [], { riskRuleId: 'risk.abdominal.distension_no_passage' }),
  defineCase('abdominal-risk-04', 'abdominal_pain', 'risk_expression', '腹痛时突然晕倒，现在意识很混乱。', 'asserted', 'interrupt', [], { riskRuleId: 'risk.consciousness.altered' }),
  defineCase('abdominal-unsupported-01', 'abdominal_pain', 'unsupported_population', '我16岁，今天开始小腹疼。', 'asserted', 'unsupported', [], {}, { age: 16, population: 'under_18' }),
  defineCase('abdominal-unsupported-02', 'abdominal_pain', 'unsupported_population', '怀孕十二周，现在下腹疼。', 'asserted', 'unsupported', [], {}, { age: 32, population: 'pregnancy' }),
  defineCase('abdominal-invalid-01', 'abdominal_pain', 'invalid_template', '患者性别： 年龄： 腹痛描述：', 'uncertain', 'reject'),
  defineCase('abdominal-invalid-02', 'abdominal_pain', 'invalid_template', '请输入胃疼内容请输入胃疼内容。', 'uncertain', 'reject'),
  defineCase('abdominal-conflict-01', 'abdominal_pain', 'slot_conflict', '其实是右下腹疼。', 'asserted', 'clarify', [slot('abdominalLocation', 'lower_right', '右下腹')], { conflictSlotIds: ['abdominalLocation'], acceptedSlotIds: [] }, { existingAnswers: { abdominalLocation: 'upper' } }),
  defineCase('abdominal-conflict-02', 'abdominal_pain', 'slot_conflict', '不是反复，是一直疼。', 'asserted', 'clarify', [slot('episodePattern', 'continuous', '一直疼')], { conflictSlotIds: ['episodePattern'], acceptedSlotIds: [] }, { existingAnswers: { episodePattern: 'recurrent' } }),
  defineCase('abdominal-conflict-03', 'abdominal_pain', 'slot_conflict', '现在确认是昨晚开始的。', 'asserted', 'clarify', [slot('onset', '昨晚', '昨晚开始')], { conflictSlotIds: ['onset'], acceptedSlotIds: [] }, { existingAnswers: { onset: '今天早上' } }),
]

const chestDiscomfortCases: V2ComplaintEvalCase[] = [
  defineCase('chest-current-01', 'chest_discomfort', 'current_affirmed', '今天下午开始有点胸闷。', 'asserted', 'collect', [slot('onset', '今天下午', '今天下午开始'), slot('chestSensation', 'tightness', '胸闷')]),
  defineCase('chest-current-02', 'chest_discomfort', 'current_affirmed', '胸口偶尔发紧，但没有胸痛。', 'asserted', 'collect', [slot('chestSensation', 'tightness', '胸口偶尔发紧'), slot('episodePattern', 'intermittent', '偶尔')]),
  defineCase('chest-current-03', 'chest_discomfort', 'current_affirmed', '走快时会气短，停下来能恢复。', 'asserted', 'collect', [slot('chestSensation', 'shortness_of_breath', '气短'), slot('activityRelation', 'with_activity', '走快时'), slot('severityImpact', 'mild', '停下来能恢复')]),
  defineCase('chest-current-04', 'chest_discomfort', 'current_affirmed', '呼吸有点不畅，但可以完整说话。', 'asserted', 'collect', [slot('chestSensation', 'breathing_discomfort', '呼吸有点不畅'), slot('breathingImpact', 'can_speak_full_sentences', '可以完整说话')]),
  defineCase('chest-current-05', 'chest_discomfort', 'current_affirmed', '胸闷反复出现，每次大约一分钟。', 'asserted', 'collect', [slot('episodePattern', 'recurrent', '反复出现'), slot('chestEpisodeDuration', '一分钟', '一分钟')]),
  defineCase('chest-current-06', 'chest_discomfort', 'current_affirmed', '胸口中央有发闷的感觉，日常活动基本不受影响。', 'asserted', 'collect', [slot('chestLocation', 'central', '胸口中央'), slot('severityImpact', 'mild', '基本不受影响')]),
  defineCase('chest-negated-01', 'chest_discomfort', 'negated', '没有胸闷，也不气短。', 'negated', 'reject'),
  defineCase('chest-negated-02', 'chest_discomfort', 'negated', '否认胸痛，呼吸也不困难。', 'negated', 'reject'),
  defineCase('chest-negated-03', 'chest_discomfort', 'negated', '胸口不紧，只是单纯心跳快。', 'negated', 'reject'),
  defineCase('chest-historical-01', 'chest_discomfort', 'historical', '去年有过胸闷，现在没有。', 'historical', 'reject'),
  defineCase('chest-historical-02', 'chest_discomfort', 'historical', '以前活动时会气短，最近没发生。', 'historical', 'reject'),
  defineCase('chest-historical-03', 'chest_discomfort', 'historical', '小时候有过呼吸不畅，这次只是整理旧记录。', 'historical', 'reject'),
  defineCase('chest-resolved-01', 'chest_discomfort', 'resolved', '刚才胸口发紧，现在完全好了。', 'resolved', 'reject'),
  defineCase('chest-resolved-02', 'chest_discomfort', 'resolved', '早上有点气短，目前呼吸恢复正常。', 'resolved', 'reject'),
  defineCase('chest-resolved-03', 'chest_discomfort', 'resolved', '之前胸闷，现在已经消失。', 'resolved', 'reject'),
  defineCase('chest-hypothetical-01', 'chest_discomfort', 'hypothetical', '如果以后出现胸闷，我想先了解会收集哪些信息。', 'hypothetical', 'reject'),
  defineCase('chest-ambiguous-01', 'chest_discomfort', 'ambiguous', '胸口怪怪的，说不清是闷还是别的感觉。', 'uncertain', 'clarify'),
  defineCase('chest-ambiguous-02', 'chest_discomfort', 'ambiguous', '运动后有点喘，不确定是否超出平常。', 'uncertain', 'clarify'),
  defineCase('chest-ambiguous-03', 'chest_discomfort', 'ambiguous', '只是心慌，没有说明是否胸闷或气短。', 'uncertain', 'clarify'),
  defineCase('chest-multi-01', 'chest_discomfort', 'multi_complaint', '胸闷同时头晕，但没有胸痛也不气短。', 'asserted', 'collect', [], { matchedComplaints: ['chest_discomfort', 'dizziness'] }),
  defineCase('chest-multi-02', 'chest_discomfort', 'multi_complaint', '咳嗽时胸口发闷，呼吸不费力。', 'asserted', 'collect', [], { matchedComplaints: ['cough', 'chest_discomfort'] }),
  defineCase('chest-multi-03', 'chest_discomfort', 'multi_complaint', '腹痛以后有点胸闷，但能正常活动和说话。', 'asserted', 'collect', [], { matchedComplaints: ['abdominal_pain', 'chest_discomfort'] }),
  defineCase('chest-risk-01', 'chest_discomfort', 'risk_expression', '现在胸口很痛，而且一直不缓解。', 'asserted', 'interrupt', [], { riskRuleId: 'risk.chest_pain.explicit' }),
  defineCase('chest-risk-02', 'chest_discomfort', 'risk_expression', '胸口突然像被压住一样，疼痛还往左臂扩散。', 'asserted', 'interrupt', [], { riskRuleId: 'risk.chest.pressure_or_spread' }),
  defineCase('chest-risk-03', 'chest_discomfort', 'risk_expression', '胸痛同时出汗、恶心，还觉得快要晕倒。', 'asserted', 'interrupt', [], { riskRuleId: 'risk.chest_pain.with_associated_signs' }),
  defineCase('chest-risk-04', 'chest_discomfort', 'risk_expression', '现在喘不过气，连完整一句话都说不了。', 'asserted', 'interrupt', [], { riskRuleId: 'risk.breathing.severe' }),
  defineCase('chest-unsupported-01', 'chest_discomfort', 'unsupported_population', '我15岁，最近总觉得胸闷。', 'asserted', 'unsupported', [], {}, { age: 15, population: 'under_18' }),
  defineCase('chest-unsupported-02', 'chest_discomfort', 'unsupported_population', '怀孕三十周，活动时会气短。', 'asserted', 'unsupported', [], {}, { age: 29, population: 'pregnancy' }),
  defineCase('chest-invalid-01', 'chest_discomfort', 'invalid_template', '患者姓名： 胸闷： 气短： 请填写。', 'uncertain', 'reject'),
  defineCase('chest-invalid-02', 'chest_discomfort', 'invalid_template', '胸部不适模板模板模板，无具体描述。', 'uncertain', 'reject'),
  defineCase('chest-conflict-01', 'chest_discomfort', 'slot_conflict', '其实是活动时才胸闷。', 'asserted', 'clarify', [slot('activityRelation', 'with_activity', '活动时')], { conflictSlotIds: ['activityRelation'], acceptedSlotIds: [] }, { existingAnswers: { activityRelation: 'at_rest' } }),
  defineCase('chest-conflict-02', 'chest_discomfort', 'slot_conflict', '每次不是五分钟，是一分钟。', 'asserted', 'clarify', [slot('chestEpisodeDuration', '一分钟', '一分钟')], { conflictSlotIds: ['chestEpisodeDuration'], acceptedSlotIds: [] }, { existingAnswers: { chestEpisodeDuration: '五分钟' } }),
  defineCase('chest-conflict-03', 'chest_discomfort', 'slot_conflict', '不是一直闷，是偶尔出现。', 'asserted', 'clarify', [slot('episodePattern', 'intermittent', '偶尔出现')], { conflictSlotIds: ['episodePattern'], acceptedSlotIds: [] }, { existingAnswers: { episodePattern: 'continuous' } }),
]

export const v2ComplaintCases: V2ComplaintEvalCase[] = [
  ...headacheCases,
  ...dizzinessCases,
  ...abdominalPainCases,
  ...chestDiscomfortCases,
]

export const v2ComplaintCaseCounts = v2ComplaintCases.reduce<
  Record<V2ComplaintId, number>
>((counts, item) => {
  counts[item.complaint] += 1
  return counts
}, {
  headache: 0,
  dizziness: 0,
  abdominal_pain: 0,
  chest_discomfort: 0,
})

export const V2_COMPLAINT_CASES_ARE_SYNTHETIC = true as const
