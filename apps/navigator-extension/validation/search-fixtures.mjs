export const relatedPairs = [
  ['时间线滚轮缩放锚点如何保持？','时间线滚轮缩放如何围绕鼠标锚点？','如何处理图像中的时间标签？'],
  ['IndexedDB 数据库事务冲突如何重试？','如何重试 IndexedDB 数据库事务冲突？','数据库课程有哪些教材？'],
  ['Alpha Beta 剪枝如何减少搜索节点？','Alpha Beta 剪枝的搜索节点顺序优化','Alpha 通道如何控制图片透明度？'],
  ['C++ 模板参数推导失败如何诊断？','C++ 模板参数推导失败的诊断方法','模板海报的配色方案'],
  ['Context Pack 如何保留稳定卡片引用？','如何验证 Context Pack 稳定卡片引用？','旅行 pack 应该带什么？'],
  ['Canvas 拖动节点如何保存世界坐标？','Canvas 节点拖动世界坐标持久化','世界地图有哪些投影？'],
  ['Markdown 长回答代码块如何横向滚动？','Markdown 代码块横向滚动与长回答阅读','长跑呼吸节奏怎么训练？'],
  ['React useEffect 清理定时器如何实现？','React useEffect 定时器清理方法','电器定时器如何维修？'],
  ['Python asyncio 任务取消怎样传播？','Python asyncio 取消任务的传播规则','旅行活动取消如何退款？'],
  ['Rust borrow checker 生命周期报错？','Rust borrow checker 生命周期诊断','铁锈如何清除？'],
  ['Docker compose 服务健康检查配置？','Docker compose 健康检查如何配置？','健康饮食如何安排？'],
  ['SQL 联合索引最左前缀如何优化？','SQL 联合索引最左前缀的查询优化','书籍索引如何排版？'],
  ['OAuth PKCE 授权码交换流程？','OAuth PKCE 授权码交换如何验证？','交换生申请流程是什么？'],
  ['WebSocket 断线重连如何指数退避？','WebSocket 指数退避与断线重连','退避三舍的历史故事？'],
  ['TF-IDF 余弦相似度如何过滤常见词？','TF-IDF 余弦相似度常见词过滤','余弦函数如何求导？'],
  ['贝叶斯网络条件独立如何判断？','贝叶斯网络条件独立的判断方法','网络购物怎样退货？'],
  ['矩阵奇异值分解如何计算低秩近似？','矩阵奇异值分解的低秩近似计算','近似色怎么搭配？'],
  ['小程序离线缓存如何保证增量同步？','小程序离线缓存增量同步方案','同步游泳有哪些规则？'],
  ['单元测试 mock 时钟如何验证防抖？','防抖单元测试如何 mock 时钟？','机械时钟如何保养？'],
  ['Chrome MV3 扩展 service worker 休眠恢复？','Chrome MV3 service worker 休眠后的恢复','扩展运动如何防止受伤？'],
];
export function searchDocuments(count=300) {
  return Array.from({length:count},(_,i)=>{
    const group=Math.floor(i/3),slot=i%3,pair=relatedPairs[group];
    const question=i===count-1?'吉普赛舞曲节奏切分与手指滑奏':pair?.[slot]??`分布式日志分片任务 shard${i} 校验记录`;
    return {id:'qa-'+i,projectId:i%2?'project-b':'project-a',conversationId:'conv-'+i%9,sourceTitle:'相同来源标题',time:{value:new Date(Date.UTC(2026,9,1)+i*60000).toISOString(),precision:'message'},state:'ACTIVE',locatable:true,groups:i%2?['科研']:['OPC'],favorite:i===0,fields:{title:'',question,answer:pair?'该回答保留原始问题：'+question:'测试 Markdown\n\n'+('正文常见段落。'.repeat(80))+`\n\n深层关键词-${i}\n\n\u0060\u0060\u0060cpp\nstd::vector<int> v;\n\u0060\u0060\u0060`,conversation:'相同来源标题',notes:'',tags:'',reflection:''}};
  });
}
