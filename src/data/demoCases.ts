// 以下内容全部为产品演示用合成案例，不来自真实患者或医疗数据集。
export interface DemoCase {
  id: string
  title: string
  age: number
  text: string
}

export const demoCases: DemoCase[] = [
  {
    id: 'fever-standard',
    title: '普通发热',
    age: 30,
    text: '昨天开始发烧，现在38.5度，没有胸痛，也没有呼吸困难',
  },
  {
    id: 'cough-multi-slot',
    title: '咳嗽多槽位',
    age: 35,
    text: '咳了三天，主要是有痰，痰是黄色的，晚上更明显',
  },
  {
    id: 'risk-escalation',
    title: '风险中断',
    age: 45,
    text: '我现在咳嗽，而且喘不上气',
  },
]
