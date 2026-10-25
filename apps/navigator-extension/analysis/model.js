// External JSON is the first model adapter. A future remote implementation can keep this contract.
export const MODEL_ADAPTER_VERSION = '0.2.0';
export const RESULT_FORMAT = 'acvn-organization-result';

export function parseModelResult(text) {
  let value;
  try { value = typeof text === 'string' ? JSON.parse(text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')) : structuredClone(text); }
  catch { throw new Error('整理建议 JSON 解析失败；原有地图和数据未改变。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== RESULT_FORMAT || value.schemaVersion !== 1) throw new Error('需要 format=acvn-organization-result、schemaVersion=1 的结构化模型结果。');
  if (value.method?.kind !== 'model' || typeof value.method.name !== 'string' || !value.method.name.trim() || typeof value.method.version !== 'string' || !value.method.version.trim()) throw new Error('模型结果必须说明 method.kind=model、字符串模型名称和分析版本；规则结果不能冒充模型语义结果。');
  return value;
}
export function analysisPrompt(pack, batch = null) {
  const header = `请为 AI Conversation Visual Navigator 整理同一对话同一路径中的连续讨论。你只提供导航建议，不能删改原文、推断因果关系、补造缺失内容。\nconversationId=${pack.conversationId}\npathId=${pack.pathId}\nanalysisPackId=${pack.id}\nsourceVersion=${pack.sourceVersion}\n`;
  const instructions = '把每个 coreQAIds 中的 QA 恰好覆盖一次，成员连续且保持输入顺序。相邻上下文只帮助理解，不能成为本批成员。每组给出简短中文 title、topics 字符串数组、qaIds、reason、evidence。evidence 至少为每个成员引用一条实际消息，使用输入的 qaId、messageId、versionId，不得改写或猜测 ID。人工分段默认保留标题、主题和边界，任何变化在理由中明确解释，供用户复核。模型名称和版本请如实填写。不要输出 Markdown 或 JSON 之外的文字。\n';
  const metadata = { format: RESULT_FORMAT, schemaVersion: 1, analysisPackId: pack.id, conversationId: pack.conversationId, pathId: pack.pathId, sourceVersion: pack.sourceVersion,
    method: { kind: 'model', name: '填写实际模型名称', version: '填写分析版本或日期' } };
  const group = { title: '建议片段标题', topics: ['主题'], qaIds: ['输入的 QA ID'], reason: '连续分组的原文依据', evidence: [{ qaId: '输入的 QA ID', messageId: '输入的消息 ID', versionId: '输入的版本 ID' }] };
  if (batch) return `${header}${instructions}本批 batchId=${batch.id}。返回一个批次对象 {"batchId":"${batch.id}","groups":${JSON.stringify([group])}}。最后将各批次对象合并为下面完整结果的 batches 数组后再导入插件：\n${JSON.stringify({ ...metadata, batches: pack.batches.map(b => ({ batchId: b.id, groups: [group] })) }, null, 2)}\n本批输入：\n${JSON.stringify(batch, null, 2)}`;
  return `${header}${instructions}可返回覆盖整个 rangeQAIds 的 groups 数组；长对话也可逐批分析，最后把所有批次 groups 汇总到 batches 数组。插件需要完整范围，不能直接导入缺少其他批次的结果。\n返回格式：\n${JSON.stringify({ ...metadata, batches: pack.batches.map(b => ({ batchId: b.id, groups: [group] })) }, null, 2)}\n输入整理包：\n${JSON.stringify(pack, null, 2)}`;
}
