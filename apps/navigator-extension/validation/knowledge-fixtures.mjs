export const topics=[
 {term:'IndexedDB',q:'IndexedDB 缓存事务如何保持原子性与版本一致性',a:'IndexedDB 的读取、版本比较和写入必须放在同一个事务中，避免并发覆盖其他窗口的修改。\n\n缓存键需要包含模型提交、输入哈希与预处理版本；单纯依赖 Card ID 会错误复用旧向量。'},
 {term:'Canvas',q:'Canvas 图形节点拖动与坐标缩放如何同步',a:'Canvas 节点拖动需要先把屏幕坐标转换为世界坐标，再保存节点的世界坐标，避免缩放后出现偏移。\n\n指针捕获需要在结束或取消时释放，并保留节点身份，确保点击和拖动不会互相干扰。'},
 {term:'Python',q:'Python C++ 数组内存管理与对象生命周期如何配合',a:'Python 对象使用引用计数配合循环垃圾回收；C++ 容器的资源生命周期应通过 RAII 管理。\n\n跨语言传递数组时需要明确内存所有权，避免释放后继续读取导致失效引用。'}
];
export function knowledgeFixtures(count=100) {
 return Array.from({length:count},(_,i)=>{const t=topics[i%3];return {cardId:'synthetic-'+String(i).padStart(4,'0'),conversationId:'conv-'+i%5,sourceProjectId:'synthetic-project',question:`${t.q}？案例 ${i}`,customTitle:'',manualTags:[],sourceHash:'synthetic-source-'+i,sourceMetadata:{title:'合成来源 '+i%5},answer:t.a,answerSources:[{messageId:'a'+i,versionId:'v'+i,text:t.a+'\n\n```js\nconst state = new Map();\n```\n\n公式 $x_i$ 必须保持完整。\n\n## 错误示例\n删除所有记录能够解决任何问题，这句话仅用于反面举例。'}]};});
}
