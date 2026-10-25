import { el, button, badge, labelRole, labelStatus, timeLabel, savedTime, plainBody, openSource } from './dom.js';

export function messageCard(message, options = {}) {
  const card = el('article', { class: `message-card ${message.role} ${options.targetId === message.id ? 'highlight' : ''}` }); card.dataset.messageId = message.id;
  card.append(el('div', { class: 'message-head' }, [el('strong', { text: labelRole(message.role) }), badge(`${message.text.length.toLocaleString()} 字符`),
    message.streaming === 'generating' ? badge('生成中快照', 'warning') : null]));
  const body = plainBody(message.text || (message.contentStatus === 'empty' ? '（来源提供了空正文）' : '（正文未取得，保留消息身份与非文本信息）'), options.query);
  const auxiliary = !['user', 'assistant'].includes(message.role);
  if ((message.text.length > 1800 && message.role === 'assistant') || auxiliary) {
    const detail = el('details', { class: 'answer-detail' }, [el('summary', { class: 'long-summary', text: `${auxiliary ? '展开工具 / 辅助消息' : '展开完整长回答'} · ${message.text.length.toLocaleString()} 字符` }), body]);
    if (options.targetId === message.id) detail.open = true;
    card.append(detail);
  } else card.append(body);
  if (message.contentStatus === 'body_unavailable') card.append(badge('内容缺失 / 非文本正文未取得', 'warning'));
  if (message.attachments?.length) card.append(el('details', {}, [el('summary', { text: `附件与非文本内容（${message.attachments.length}）` }), ...message.attachments.map(a =>
    el('div', { class: 'attachment' }, [el('strong', { text: a.name ?? '未取得名称' }), el('div', { text: `类型：${a.type}；状态：${a.status === 'reference_only' ? '仅有引用，未保存文件正文' : '正文不可取得'}` }), el('div', { text: `引用：${a.reference ?? '未知'}` })]))]));
  const info = el('details', {}, [el('summary', { text: '来源、身份与版本' }), el('div', { class: 'message-info', text:
    `本地消息 ID：${message.id}\n源消息 ID：${message.sourceMessageId ?? '未知'}\n导出源节点 ID：${message.sourceNodeId ?? '未知'}\n可靠取得的父消息：${message.parentMessageId ?? '未知'}\n${timeLabel(message.time)}\n最近采集：${savedTime(message.lastCapturedAt)}（不是讨论时间）\n匹配依据：${message.latestObservation?.basis ?? message.identity?.basis ?? '未知'}\n匹配确定性：${message.latestObservation?.confidence ?? message.identity?.confidence ?? '未知'}\n内容类型：${message.contentTypes?.join('、') || '未知'}` })]);
  const current = message.versions?.find(v => v.id === message.currentVersionId);
  if (current?.raw != null) info.append(el('details', {}, [el('summary', { text: '原始导入消息 / DOM 采集元信息 JSON' }), el('pre', { class: 'raw-json', text: JSON.stringify(current.raw, null, 2) })]));
  if (options.targetVersionId) { info.open = true; card.append(badge(`整理引用版本：${options.targetVersionId}`, 'warning')); }
  if (message.versions?.length > 1 || options.targetVersionId) info.append(el('details', { open: Boolean(options.targetVersionId) }, [el('summary', { text: `查看全部正文版本（${message.versions.length}）` }), ...message.versions.map(v =>
    el('div', { class: `version-body ${v.id === options.targetVersionId ? 'highlight' : ''}`, 'data-version-id': v.id }, [el('p', { class: 'muted', text: `${v.id === options.targetVersionId ? '本次整理引用的版本 · ' : ''}${v.id === message.currentVersionId ? '当前版本 · ' : '历史版本 · '}采集于 ${savedTime(v.capturedAt)}；版本 ID：${v.id}` }), plainBody(v.text || '（该版本没有可读正文）'),
      v.attachments?.length ? el('pre', { class: 'raw-json', text: JSON.stringify(v.attachments, null, 2) }) : null]))]));
  card.append(info);
  if (options.onLocate) card.append(button('定位到本地完整对话原文', () => options.onLocate(message.id), 'btn link'));
  return card;
}
export class Reader {
  constructor(host, { api, onSelect, onEdit, onMove, onError }) {
    this.host = host; this.api = api; this.onSelect = onSelect; this.onEdit = onEdit; this.onMove = onMove; this.onError = onError; this.epoch = 0;
  }
  setView(view) { this.view = view; }
  safe(fn) { return async () => { try { await fn(); } catch (e) { this.onError(e.message); } }; }
  async showSegment(segmentId, qaId = null, query = '', targetId = null) {
    const seg = this.view.segments.find(s => s.id === segmentId && s.active); if (!seg) return;
    this.scope = { type: 'segment', segmentId, conversationId: seg.conversationId, pathId: seg.pathId };
    this.members = seg.qaIds.map(k => this.view.qas.find(q => q.id === k)).filter(Boolean);
    this.buildShell(seg); await this.displayQA(this.members.some(q => q.id === qaId) ? qaId : this.members[0]?.id, query, targetId);
  }
  async showPath(conversationId, pathId, qaId = null, query = '', targetId = null) {
    this.scope = { type: 'path', conversationId, pathId };
    this.members = this.view.qas.filter(q => q.pathId === pathId).sort((a, b) => a.ordinal - b.ordinal);
    this.buildShell();
    if (this.members.length) await this.displayQA(qaId && this.members.some(q => q.id === qaId) ? qaId : this.members[0].id, query, targetId);
    else this.content.append(el('p', { class: 'muted', text: '这条已存路径没有用户问题；工具、系统或未分类消息仍可在完整对话中查看。' }));
  }
  buildShell(segment = null) {
    this.epoch++; this.host.replaceChildren(); this.host.scrollTop = 0;
    const conversation = this.view.conversations.find(c => c.id === this.scope.conversationId), path = this.view.paths.find(p => p.id === this.scope.pathId);
    const head = el('div', { class: 'reader-head' }, [el('div', { class: 'eyebrow', text: segment ? 'SEGMENT → 全部成员问答' : 'CONVERSATION → 完整路径问答' }), el('h2', { text: segment?.title ?? conversation?.title ?? '完整阅读' })]);
    head.append(el('div', { class: 'reader-meta' }, [badge(`${this.members.length} 轮 Q/A`), badge(path?.label ?? '阅读路径未知'), segment?.manual ? badge('人工整理', 'good') : null]));
    if (segment?.needsReview) head.append(el('p', { class: 'preview-warnings', text: segment.reviewReason }));
    const native = conversation?.nativeProject;
    head.append(el('div', { class: 'reader-source' }, [el('strong', { text: conversation?.title ?? '未知对话' }),
      el('div', { text: `本地项目：${this.view.project.name}` }), el('div', { text: `ChatGPT / 来源原生项目：${native?.name ?? native?.id ?? '未知'}${native?.status === 'manual' ? '（用户手动记录）' : ''}` }),
      el('div', { text: conversation?.lastScope?.description ?? '范围未知' }),
      conversation?.currentPathStatus === 'unknown' ? el('div', { text: '来源当前路径未知；此处为你选择浏览的已存路径。' }) : null]));
    const tools = el('div', { class: 'reader-tools' }, [
      button('所在完整对话 / 本地原文', this.safe(() => this.showConversation(conversation.id, this.scope.pathId, this.selected?.userMessageId))),
      button('打开保存的来源 ↗', () => openSource(conversation?.sourceUrl), 'btn', { disabled: !conversation?.sourceUrl, title: conversation?.sourceUrl ?? '文件未提供实际来源地址，未拼造链接' }),
      button('调整本地项目归属', this.safe(() => this.onMove(conversation)))]);
    if (segment) {
      tools.append(button('完整路径的全部 Q/A', this.safe(() => this.showPath(conversation.id, segment.pathId, this.selected?.id))),
        button('重命名', this.safe(() => this.onEdit('rename', segment))), button('主题标签', this.safe(() => this.onEdit('topics', segment))),
        button('合并下一相邻段', this.safe(() => this.onEdit('merge', segment))),
        button('按 Q/A 边界拆分', this.safe(() => this.onEdit('split', segment)), 'btn', { disabled: segment.qaIds.length < 2 }));
    }
    head.append(tools); this.host.append(head);
    this.index = el('div', { class: 'qa-strip' }); this.host.append(this.index);
    this.content = el('div', { class: 'qa-content' }); this.host.append(this.content);
    this.indexPage = 0;
  }
  renderIndex() {
    const size = 25, total = this.members.length; this.index.replaceChildren();
    if (!total) return;
    const list = el('div', { class: 'qa-strip-list' });
    this.members.slice(this.indexPage * size, (this.indexPage + 1) * size).forEach(qa => {
      list.append(button('', this.safe(() => this.displayQA(qa.id)), `qa-index ${this.selected?.id === qa.id ? 'selected' : ''}`));
      list.lastChild.append(el('strong', { text: String(qa.ordinal) }), el('span', { class: 'qa-preview', text: qa.preview }), badge(labelStatus(qa.status), qa.status === 'answered' ? '' : 'warning'));
    });
    const jump = el('input', { type: 'number', min: 1, max: total, value: this.members.findIndex(q => q.id === this.selected?.id) + 1, 'aria-label': '跳转到成员中的第几轮' });
    this.index.append(list, el('div', { class: 'page-tools' }, [button('索引上一批', () => { this.indexPage--; this.renderIndex(); }, 'btn', { disabled: this.indexPage === 0 }),
      el('span', { text: `${this.indexPage * size + 1}-${Math.min((this.indexPage + 1) * size, total)} / ${total}` }),
      button('索引下一批', () => { this.indexPage++; this.renderIndex(); }, 'btn', { disabled: (this.indexPage + 1) * size >= total }), jump,
      button('跳转', this.safe(() => { const index = Number(jump.value) - 1; if (!Number.isInteger(index) || !this.members[index]) throw new Error('请输入范围内的轮次编号。'); return this.displayQA(this.members[index].id); }), 'btn')]));
  }
  async displayQA(qaId, query = '', targetId = null) {
    if (!qaId) return;
    const token = ++this.epoch, content = this.content;
    const data = await this.api('qa', { qaId }); if (token !== this.epoch) return;
    this.selected = data.qa;
    const position = this.members.findIndex(q => q.id === qaId); this.indexPage = Math.max(0, Math.floor(position / 25)); this.renderIndex();
    content.replaceChildren(el('div', { class: 'qa-nav' }, [button('← 上一轮', this.safe(() => this.displayQA(this.members[position - 1].id)), 'btn', { disabled: position <= 0 }),
      button('下一轮 →', this.safe(() => this.displayQA(this.members[position + 1].id)), 'btn', { disabled: position >= this.members.length - 1 }),
      badge(`源序第 ${data.qa.ordinal} 轮`)]), el('div', { class: 'reader-meta' }, [badge(labelStatus(data.qa.status), data.qa.status === 'answered' ? 'good' : 'warning'), badge(timeLabel(data.qa.time))]));
    if (!data.qa.time?.value && data.conversation.sourceTime?.value) content.append(el('p', { class: 'muted', text: `本轮来源时间未知。${timeLabel(data.conversation.sourceTime)}，仅表示对话时间。` }));
    if (data.qa.status === 'unanswered') content.append(el('p', { class: 'preview-warnings', text: '已保存路径中没有关联助手回答。部分采集时，不能据此确定来源是否已经回答。' }));
    if (data.qa.notSeenInLatest) content.append(el('p', { class: 'muted', text: '本轮在本次采集范围之外，仍保留之前保存的原文。' }));
    content.append(button('展开本轮全部回答 / 工具信息', () => content.querySelectorAll('.answer-detail').forEach(detail => { detail.open = true; }), 'btn link'));
    data.messages.forEach(message => content.append(messageCard(message, { query, targetId, onLocate: key => this.safe(() => this.showConversation(data.conversation.id, data.path.id, key))() })));
    await this.onSelect(data.qa, data.segment);
    if (targetId) content.querySelector(`[data-message-id="${CSS.escape(targetId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  async showConversation(conversationId, pathId = null, targetMessageId = null, offset = 0, query = '', targetVersionId = null) {
    const token = ++this.epoch;
    const data = await this.api('conversation', { conversationId, pathId, targetMessageId, offset }); if (token !== this.epoch) return;
    if (targetVersionId && !data.messages.some(m => m.id === targetMessageId && m.versions.some(v => v.id === targetVersionId))) throw new Error('整理引用的原文版本不存在或不属于指定消息。');
    this.host.replaceChildren(); this.host.scrollTop = 0; this.archive = { conversationId, pathId, targetMessageId, targetVersionId, offset: data.offset, query };
    const select = el('select', { 'aria-label': '完整对话阅读范围' }, [el('option', { value: '', text: '全部已存消息（各分支独立记录，列表不代表单一发生顺序）' }), ...data.paths.map(p => el('option', { value: p.id, text: `${p.label} · ${p.messageIds.length} 条消息` }))]);
    select.value = pathId ?? ''; select.addEventListener('change', this.safe(() => this.showConversation(conversationId, select.value || null)));
    this.host.append(el('div', { class: 'reader-head' }, [el('div', { class: 'eyebrow', text: '本地原文 · CONVERSATION READER' }), el('h2', { text: data.conversation.title }),
      el('p', { class: 'muted', text: data.conversation.lastScope?.description ?? '范围未知' }), select,
      el('div', { class: 'reader-tools' }, [button('返回路径全部 Q/A', this.safe(() => this.showPath(conversationId, pathId ?? data.conversation.currentPathId ?? data.paths[0]?.id, this.selected?.id))),
        button('打开保存的来源 ↗', () => openSource(data.conversation.sourceUrl), 'btn', { disabled: !data.conversation.sourceUrl })]) ]));
    const captures = el('details', {}, [el('summary', { text: `采集范围与快照记录（${data.snapshots.length}）` }), ...data.snapshots.slice().reverse().map(s =>
      el('div', { class: 'snapshot-row' }, [el('strong', { text: `采集于 ${savedTime(s.capturedAt)} · ${s.method}` }), el('div', { text: `${s.messageIds.length} 条消息 · ${s.graphNodeCount} 个来源节点 · ${s.scope.description}` }),
        el('div', { text: `来源对话标识：${s.sourceConversationId ?? '未知'}；来源地址：${s.sourceUrl ?? '未知'}` }),
        s.fileSource ? el('div', { text: `导入文件：${s.fileSource.name}；UTF8 解码文本 SHA256：${s.fileSource.sha256}` }) : null,
        el('div', { text: `新增 ${s.stats.createdMessages} 条；复用 ${s.stats.reusedMessages} 条；正文变化 ${s.stats.changedMessages} 条；不确定匹配 ${s.stats.uncertainMatches} 条` }),
        el('div', { text: s.warnings.join('\n') })]))]);
    this.host.append(captures);
    const paging = () => el('div', { class: 'page-tools' }, [button('上一批原文', this.safe(() => this.showConversation(conversationId, pathId, null, Math.max(0, data.offset - 35), query)), 'btn', { disabled: data.offset === 0 }),
      el('span', { text: `${data.total ? data.offset + 1 : 0}-${Math.min(data.offset + data.messages.length, data.total)} / ${data.total} 条消息` }),
      button('下一批原文', this.safe(() => this.showConversation(conversationId, pathId, null, data.nextOffset, query)), 'btn', { disabled: data.nextOffset === null })]);
    this.host.append(paging());
    data.messages.forEach(message => this.host.append(messageCard(message, { query, targetId: targetMessageId, targetVersionId: message.id === targetMessageId ? targetVersionId : null })));
    this.host.append(paging());
    if (targetVersionId) this.host.querySelector(`[data-version-id="${CSS.escape(targetVersionId)}"]`)?.scrollIntoView({ block: 'nearest' });
    else if (targetMessageId) this.host.querySelector(`[data-message-id="${CSS.escape(targetMessageId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }
}
