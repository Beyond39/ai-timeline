// Entirely synthetic. Five conversations, 200 mixed language/code questions.
export const fixtureQuestions = [
  ['IndexedDB 数据库事务冲突如何重试？','如何重试 IndexedDB 数据库事务冲突？','数据库事务并发冲突的重试策略','IndexedDB transaction conflict retry backoff'],
  ['Canvas 拖动节点如何保存世界坐标？','Canvas 节点拖动世界坐标持久化','Canvas 世界坐标与拖动位置如何保存','Canvas drag node world coordinate persistence'],
  ['React useEffect 清理定时器如何实现？','React useEffect 定时器清理方法','React useEffect 清理 timer 防止内存泄漏','React useEffect timer cleanup memory leak'],
  ['Python asyncio 任务取消怎样传播？','Python asyncio 取消任务的传播规则','Python asyncio task cancellation propagation','Python asyncio cancellation handling task propagation'],
  ['Context Pack 如何保留稳定卡片引用？','如何验证 Context Pack 稳定卡片引用？','Context Pack stable card references validation','Context Pack stable references card source validation']
];
export function projectConversations(count=200){
  return Array.from({length:5},(_,c)=>({platform:'chatgpt',sourceConversationId:`workspace-fixture-${c}`,title:`独立测试 Conversation ${c+1}`,sourceUrl:`https://chatgpt.com/c/workspace-fixture-${c}`,method:'chatgpt-data-v1',scope:{kind:'full_conversation',branches:'not_collected'},messages:Array.from({length:Math.ceil(count/5)},(_,j)=>{
    const index=j*5+c,theme=Math.floor(index/40),question=fixtureQuestions[theme%5][index%4]+` 样本 ${index} \n\n\`code_${index}()\``;
    return [{sourceMessageId:`u-${index}`,role:'user',text:question,time:{value:new Date(Date.UTC(2026,9,1,0,index)).toISOString(),precision:'message'},completionEvidence:{state:'complete'}},{sourceMessageId:`a-${index}`,role:'assistant',text:`独立测试回答 ${index}：原文保留。\n\n\`\`\`js\nconst answer_${index} = 42;\n\`\`\`\n\n$$x^2 + y^2 = z^2$$`,time:{value:new Date(Date.UTC(2026,9,1,0,index,20)).toISOString(),precision:'message'},completionEvidence:{state:'complete'}}];
  }).flat()}));
}
