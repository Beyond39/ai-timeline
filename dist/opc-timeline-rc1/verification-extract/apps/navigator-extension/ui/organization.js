import { el, button, badge, labelStatus, showDialog } from './dom.js';
import { prepareDialogLayout, routeDialogNotice } from './dialog-layout.js';

const STATUS = { pending: '待确认', confirmed: '已确认', applied: '已确认', rejected: '已拒绝', needs_review: '需要复核', stale: '需要复核' };
const clone = value => structuredClone(value);
const names = value => [...new Set(String(value).split(/[,，\n]/u).map(item => item.trim()).filter(Boolean))];
const methodLabel = method => method?.kind === 'model' ? '外部模型语义结果' : '本地规则结果';

/** Suggestions are saved independently; only an explicit confirmation changes Segments. */
export class OrganizationPanel {
  constructor({ api, onApplied, onNavigate, onError }) {
    Object.assign(this, { api, onApplied, onNavigate, onError });
    this.dialog = el('dialog', { id: 'organization-dialog', class: 'organization-dialog', 'aria-label': '整理连续讨论' });
    this.dialog.addEventListener('cancel', event => { if (this.busy) event.preventDefault(); });
    this.dialog.addEventListener('close', () => { for (const url of this.urls) URL.revokeObjectURL(url); this.urls = []; });
    document.body.append(this.dialog);
    this.busy = false; this.context = null; this.detail = null; this.dirty = false; this.urls = [];
  }

  get isOpen() { return this.dialog.open; }

  async open({ conversationId, pathId }) {
    if (!conversationId) throw new Error('请先选择一条已保存的对话。');
    this.context = await this.api('organizationContext', { conversationId, pathId });
    this.detail = null; this.dirty = false; this.groups = [];
    this.render();
    if (!this.dialog.open) showDialog(this.dialog);
  }

  async openSuggestion(suggestionId) {
    const detail = await this.api('organizationSuggestion', { suggestionId });
    this.context = await this.api('organizationContext', { conversationId: detail.conversationId, pathId: detail.pathId });
    this.setDetail(detail); this.render();
    if (!this.dialog.open) showDialog(this.dialog);
  }

  setDetail(detail) { this.detail = detail; this.groups = clone(detail.groups ?? []); this.dirty = false; }

  async run(operation) {
    if (this.busy) return;
    this.busy = true; this.setBusy(true); this.setNotice('正在处理…');
    try { await operation(); }
    catch (error) { this.setNotice(error.message, true); this.onError?.(error.message); }
    finally { this.busy = false; this.setBusy(false); }
  }

  setBusy(value) {
    for (const control of this.dialog.querySelectorAll('button,input,select,textarea')) {
      if (value) { if (control.dataset.organizationDisabled == null) control.dataset.organizationDisabled = control.disabled ? '1' : '0'; control.disabled = true; }
      else if (control.dataset.organizationDisabled != null) { control.disabled = control.dataset.organizationDisabled === '1'; delete control.dataset.organizationDisabled; }
    }
  }

  setNotice(text, error = false) {
    if (routeDialogNotice(this.dialog, text, error)) return;
    const node = this.dialog.querySelector('.organization-notice');
    if (!node) return;
    node.hidden = !text; node.textContent = text; node.classList.toggle('error', error);
  }

  async refreshContext() {
    this.context = await this.api('organizationContext', { conversationId: this.context.conversation.id, pathId: this.context.path.id });
  }

  rangeArgs() {
    const first = this.dialog.querySelector('[name="organization-start"]')?.value;
    const last = this.dialog.querySelector('[name="organization-end"]')?.value;
    const qas = this.context.qas;
    if (!first || !last) throw new Error('这条阅读路径尚无可整理的 Q/A。');
    if (qas.findIndex(qa => qa.id === first) > qas.findIndex(qa => qa.id === last)) throw new Error('起始轮次不能在结束轮次之后。');
    return { conversationId: this.context.conversation.id, pathId: this.context.path.id, startQAId: first, endQAId: last };
  }

  render() {
    const { conversation, path, qas, suggestions = [] } = this.context;
    this.dialog.replaceChildren();
    const close = () => { if (!this.busy) this.dialog.close(); };
    this.dialog.append(el('header', { class: 'dialog-header' }, [
      el('div', {}, [el('h2', { text: '整理连续讨论' }), el('p', { class: 'muted', text: conversation.title })]),
      button('关闭', close)
    ]));
    const body = el('div', { class: 'organization-body' });
    body.append(el('p', { class: 'muted', text: '生成的规则或模型建议先保存为预览。确认后才更新导航结构；完整 Q/A、消息正文与版本继续保留。' }),
      el('p', { class: 'organization-notice notice', hidden: true, role: 'status' }));
    const pathControl = el('select', { name: 'organization-path', 'aria-label': '整理的阅读路径' }, (this.context.paths ?? [path]).map(item => el('option', { value: item.id, text: item.label ?? item.id })));
    pathControl.value = path.id;
    pathControl.addEventListener('change', () => this.run(async () => {
      await this.open({ conversationId: conversation.id, pathId: pathControl.value });
      this.setNotice('已切换阅读路径，请重新选择范围或打开这条路径的建议。');
    }));
    const option = qa => el('option', { value: qa.id, text: `第 ${qa.ordinal} 轮 · ${qa.preview ?? qa.id}` });
    const start = el('select', { name: 'organization-start', disabled: !qas.length, 'aria-label': '起始轮次' }, qas.map(option));
    const end = el('select', { name: 'organization-end', disabled: !qas.length, 'aria-label': '结束轮次' }, qas.map(option));
    if (this.detail?.rangeQAIds?.length) { start.value = this.detail.rangeQAIds[0]; end.value = this.detail.rangeQAIds.at(-1); }
    else if (qas.length) end.value = qas.at(-1).id;
    body.append(el('div', { class: 'organization-range' }, [
      el('label', { class: 'field' }, [el('span', { text: '阅读路径' }), pathControl]),
      el('label', { class: 'field' }, [el('span', { text: '从这一轮开始' }), start]),
      el('label', { class: 'field' }, [el('span', { text: '到这一轮结束' }), end])
    ]));
    body.append(el('div', { class: 'actions' }, [
      button('生成本地规则建议', () => this.run(async () => {
        this.setDetail(await this.api('organizationRules', this.rangeArgs()));
        await this.refreshContext(); this.render(); this.setNotice('本地规则建议已保存，地图尚未改变。请核对主题、标题和边界。');
      }), 'btn primary', { disabled: !qas.length }),
      button('导出给模型的整理包', () => this.run(() => this.exportPack()), 'btn', { disabled: !qas.length })
    ]));
    body.append(el('p', { class: 'footnote', text: `本路径共 ${qas.length} 轮。范围外分段保留。规则根据连续轮次、词语与内容变化分组；模型语义结果需从外部导入。` }));
    const saved = el('details', { class: 'organization-saved', open: !this.detail }, [el('summary', { text: `已保存的整理建议（${suggestions.length}）` })]);
    const savedList = el('div', { class: 'organization-suggestion-list' });
    if (!suggestions.length) savedList.append(el('p', { class: 'muted', text: '尚无建议。可以生成规则建议，或导出整理包后导入模型返回的 JSON。' }));
    for (const item of suggestions.slice().sort((a, b) => (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? ''))) {
      const title = `${methodLabel(item.method)} · ${STATUS[item.status] ?? item.status ?? '待确认'}${item.stale ? ' · 源数据已更新' : ''}`;
      savedList.append(button('', () => this.run(() => this.openSuggestion(item.id)), 'organization-suggestion', {}));
      savedList.lastChild.append(el('strong', { text: title }), el('span', { class: 'muted', text: `${item.groups?.length ?? item.groupCount ?? '?'} 个建议片段 · ${item.rangeQAIds?.length ?? item.qaCount ?? '?'} 轮` }));
    }
    saved.append(savedList); body.append(saved);
    const importArea = el('details', { class: 'organization-import' }, [el('summary', { text: '导入外部模型分析 JSON' })]);
    const jsonInput = el('textarea', { rows: 5, class: 'organization-json', placeholder: '粘贴模型返回的完整 JSON；使用导出的稳定 QA / 消息 / 版本引用。', 'aria-label': '外部模型分析结果 JSON' });
    const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
    const importText = async text => {
      if (!text.trim()) throw new Error('请粘贴或选择外部模型返回的 JSON。');
      const detail = await this.api('organizationImport', { text });
      this.context = await this.api('organizationContext', { conversationId: detail.conversationId, pathId: detail.pathId });
      this.setDetail(detail); this.render(); this.setNotice('模型语义建议已通过引用校验并进入预览。地图尚未改变。');
    };
    fileInput.addEventListener('change', () => this.run(async () => {
      const file = fileInput.files?.[0]; if (!file) return;
      try { await importText(await file.text()); } finally { fileInput.value = ''; }
    }));
    importArea.append(el('p', { class: 'muted', text: '先导出整理包，复制提示词给 ChatGPT 或其他模型，再将其结构化结果导入。不存在或过期的引用不会覆盖地图。' }), jsonInput, fileInput,
      el('div', { class: 'actions' }, [button('校验并预览 JSON', () => this.run(() => importText(jsonInput.value))), button('选择 JSON 文件', () => fileInput.click())]));
    body.append(importArea);
    this.previewHost = el('section', { class: 'organization-preview', 'aria-label': '整理建议预览' }); body.append(this.previewHost);
    this.dialog.append(body);
    this.footer = el('footer', { class: 'preview-footer' }); this.dialog.append(this.footer);
    if (this.detail) this.renderPreview();
    else this.footer.append(el('p', { class: 'muted', text: '已有地图保持原样。先生成建议，再核对并确认。' }), el('div', { class: 'actions' }, [button('取消整理', close)]));
    prepareDialogLayout(this.dialog);
    if (this.busy) this.setBusy(true);
  }

  qaLabel(qaId) {
    const qa = this.context.qas.find(item => item.id === qaId);
    return qa ? `第 ${qa.ordinal} 轮 · ${qa.preview ?? qa.id}` : `未知引用：${qaId}`;
  }

  markDirty() {
    this.dirty = true;
    if (this.reviewManual) this.reviewManual.checked = false;
    const status = this.dialog.querySelector('.organization-dirty');
    if (status) { status.textContent = '预览已修改 · 保存后重新校验人工冲突'; status.hidden = false; }
  }

  canEdit() { return Boolean(this.detail && ['pending', 'needs_review', 'stale'].includes(this.detail.status ?? 'pending') && !this.detail.stale); }

  renderPreview() {
    const detail = this.detail, range = new Set(detail.rangeQAIds ?? []);
    const before = (detail.beforeSegments ?? []).filter(segment => segment.qaIds.some(qaId => range.has(qaId)));
    const editable = this.canEdit();
    this.previewHost.replaceChildren(el('hr'), el('h3', { text: '修改前后对照' }),
      el('div', { class: 'reader-meta' }, [badge(methodLabel(detail.method), detail.method?.kind === 'model' ? 'good' : 'warning'), badge(STATUS[detail.status] ?? detail.status ?? '待确认'), badge(`原 ${before.length} 个节点 → 建议 ${this.groups.length} 个节点`), badge(`范围内 ${range.size} 轮 Q/A`)]),
      el('p', { class: 'muted', text: `分析方法：${detail.method?.name ?? detail.method?.kind ?? '未知'} · 版本 ${detail.method?.version ?? '未知'}。源数据版本与每条原文引用将在确认时再次校验。` }),
      el('p', { class: 'organization-dirty muted', hidden: !this.dirty, text: '预览已修改 · 保存后重新校验人工冲突' }));
    if (detail.stale && ['pending', 'needs_review', 'stale'].includes(detail.status ?? 'pending')) this.previewHost.append(el('p', { class: 'preview-warnings', text: `需要复核：${detail.staleReason ?? '源对话或地图已更新，不能应用这份过期建议。请重新生成或导出新的整理包。'}` }));
    if (detail.warnings?.length) this.previewHost.append(el('div', { class: 'preview-warnings' }, [el('strong', { text: '范围与分组提示' }), el('ul', {}, detail.warnings.map(text => el('li', { text })))]));
    const comparison = el('div', { class: 'organization-comparison' });
    const originals = el('section', { class: 'organization-before' }, [el('h3', { text: '原有分组' })]);
    for (const segment of before) {
      const topicNames = segment.topicIds.map(id => this.context.topics?.find(topic => topic.id === id)?.name ?? id);
      originals.append(el('article', { class: 'organization-original' }, [el('strong', { text: segment.title }),
        el('div', { class: 'reader-meta' }, [badge(`${segment.qaIds.length} 轮`), segment.manual ? badge('人工调整 · 受保护', 'warning') : null]),
        el('p', { class: 'muted', text: topicNames.length ? `主题：${topicNames.join('、')}` : '未设主题' }),
        el('details', {}, [el('summary', { text: '查看真实成员' }), this.memberList(segment.qaIds)])]));
    }
    const proposed = el('section', { class: 'organization-after' }, [el('h3', { text: '建议分组' })]);
    this.groups.forEach((group, index) => proposed.append(this.groupCard(group, index, editable)));
    comparison.append(originals, proposed); this.previewHost.append(comparison);
    this.footer.replaceChildren();
    const conflicts = detail.manualConflicts ?? [];
    this.reviewManual = el('input', { type: 'checkbox', disabled: !editable });
    if (conflicts.length) {
      const list = el('ul', {}, conflicts.map(conflict => el('li', { text: conflict.reason ?? `人工片段 ${conflict.segmentId} 会发生变化。` })));
      this.footer.append(el('div', { class: 'preview-warnings' }, [el('strong', { text: '人工调整需要复核' }), list,
        el('label', { class: 'check' }, [this.reviewManual, el('span', { text: '我已对照原分组，明确同意本次建议修改这些人工标题、标签或边界。' })])]));
    }
    this.footer.append(el('p', { class: 'footnote', text: '只更新此范围的导航分组；采用后记录整次修改，可在项目地图撤销。保存预览、取消或拒绝均不改变现有 Segment。' }),
      el('div', { class: 'actions' }, [
        button('关闭预览', () => this.dialog.close()),
        button('拒绝建议', () => this.run(async () => {
          this.setDetail(await this.api('organizationReject', { suggestionId: detail.id, baseRevision: this.detail.revision }));
          await this.refreshContext(); this.render(); this.setNotice('建议已拒绝，已有地图和原文继续保留。');
        }), 'btn', { disabled: !['pending', 'needs_review', 'stale'].includes(detail.status ?? 'pending') }),
        button('保存修改后的预览', () => this.run(async () => { await this.saveEdits(); this.setNotice('编辑已保存在建议中，地图尚未改变。'); }), 'btn', { disabled: !editable }),
        button('确认采用并更新地图', () => this.run(async () => {
          const reviewManual = this.reviewManual.checked;
          const beforeConflicts = JSON.stringify(this.detail.manualConflicts ?? []);
          await this.saveEdits(false);
          const conflictsChanged = beforeConflicts !== JSON.stringify(this.detail.manualConflicts ?? []);
          if ((this.detail.manualConflicts?.length ?? 0) && (!reviewManual || conflictsChanged)) {
            this.render();
            this.setNotice('编辑已保存在建议中。最新校验发现人工调整冲突，请对照下方复核提示，明确勾选后再次确认；地图尚未改变。', true);
            return;
          }
          const result = await this.api('organizationApply', { suggestionId: this.detail.id, baseRevision: this.detail.revision, reviewManual });
          this.dialog.close(); await this.onApplied?.({ conversationId: this.detail.conversationId, pathId: this.detail.pathId, ...result });
        }), 'btn primary', { disabled: !editable })
      ]));
    prepareDialogLayout(this.dialog);
    if (this.busy) this.setBusy(true);
  }

  memberList(qaIds) {
    return el('div', { class: 'organization-members' }, qaIds.map(qaId => this.memberButton(qaId, this.context.qas.find(item => item.id === qaId))));
  }

  memberButton(qaId, qa) {
    const control = button('', () => this.run(() => this.navigate({ qaId, messageId: qa?.userMessageId })), 'organization-member');
    control.append(el('span', { text: this.qaLabel(qaId) }));
    if (qa?.status) control.append(badge(labelStatus(qa.status), qa.status === 'unanswered' ? 'warning' : ''));
    return control;
  }

  groupCard(group, index, editable) {
    const title = el('input', { value: group.title, maxlength: 500, disabled: !editable, 'aria-label': `建议片段 ${index + 1} 标题` });
    title.addEventListener('input', () => { group.title = title.value; this.markDirty(); });
    const topicControl = el('input', { value: (group.topics ?? []).join('，'), disabled: !editable, placeholder: '多个主题用逗号分隔', 'aria-label': `建议片段 ${index + 1} 主题` });
    topicControl.addEventListener('input', () => { group.topics = names(topicControl.value); this.markDirty(); });
    const card = el('article', { class: 'organization-group' }, [el('div', { class: 'organization-group-head' }, [el('strong', { text: `建议片段 ${index + 1}` }), badge(`${group.qaIds.length} 轮`)]),
      el('label', { class: 'field' }, [el('span', { text: '标题' }), title]), el('label', { class: 'field' }, [el('span', { text: '主题标签 · 首个主题决定主色' }), topicControl]),
      el('p', { class: 'organization-reason', text: `理由：${group.reason ?? '未提供'}` }), el('details', {}, [el('summary', { text: `成员 Q/A（${group.qaIds.length}）· 点击查看原文` }), this.memberList(group.qaIds)])]);
    if (group.evidence?.length) card.append(el('details', {}, [el('summary', { text: `支撑建议的原文引用（${group.evidence.length}）` }),
      el('div', { class: 'organization-members' }, group.evidence.map(reference => button(`${this.qaLabel(reference.qaId)} · 原文消息 / 版本`, () => this.run(() => this.navigate(reference)), 'organization-member', { title: `消息 ${reference.messageId}\n版本 ${reference.versionId}` })))]));
    if (editable) {
      const tools = el('div', { class: 'organization-boundary actions small' });
      const next = this.groups[index + 1];
      if (next) {
        tools.append(button('将本段末轮移到下一段', () => { const qaId = group.qaIds.pop(); next.qaIds.unshift(qaId); this.moveEvidence(group, next, qaId); this.markDirty(); this.renderPreview(); }, 'btn', { disabled: group.qaIds.length < 2 }),
          button('将下一段首轮移入本段', () => { const qaId = next.qaIds.shift(); group.qaIds.push(qaId); this.moveEvidence(next, group, qaId); this.markDirty(); this.renderPreview(); }, 'btn', { disabled: next.qaIds.length < 2 }),
          button('合并下一相邻段', () => {
            group.qaIds.push(...next.qaIds); group.topics = [...new Set([...(group.topics ?? []), ...(next.topics ?? [])])];
            group.evidence = [...(group.evidence ?? []), ...(next.evidence ?? [])]; group.reason = `${group.reason ?? ''}；人工合并相邻建议片段。`;
            this.groups.splice(index + 1, 1); this.markDirty(); this.renderPreview();
          }));
      }
      if (group.qaIds.length > 1) {
        const boundary = el('select', { 'aria-label': `片段 ${index + 1} 的拆分边界` }, group.qaIds.slice(0, -1).map(qaId => el('option', { value: qaId, text: `在${this.qaLabel(qaId)}之后拆分` })));
        tools.append(boundary, button('按此边界拆分', () => {
          const cut = group.qaIds.indexOf(boundary.value) + 1; if (cut < 1 || cut >= group.qaIds.length) return;
          const tail = group.qaIds.splice(cut), tailIds = new Set(tail);
          const latter = { ...clone(group), title: `${group.title} · 后半段`, qaIds: tail, evidence: (group.evidence ?? []).filter(item => tailIds.has(item.qaId)), reason: '人工在 Q/A 边界拆分建议片段。' };
          group.evidence = (group.evidence ?? []).filter(item => !tailIds.has(item.qaId)); this.groups.splice(index + 1, 0, latter);
          this.markDirty(); this.renderPreview();
        }));
      }
      if (tools.childNodes.length) card.append(tools);
    }
    return card;
  }

  moveEvidence(from, to, qaId) {
    const moving = (from.evidence ?? []).filter(item => item.qaId === qaId);
    from.evidence = (from.evidence ?? []).filter(item => item.qaId !== qaId);
    to.evidence = [...(to.evidence ?? []), ...moving];
    from.reason = `${from.reason ?? ''}；人工调整相邻边界。`;
    to.reason = `${to.reason ?? ''}；人工调整相邻边界。`;
  }

  async saveEdits(render = true) {
    if (this.dirty && this.canEdit()) {
      this.setDetail(await this.api('organizationUpdate', { suggestionId: this.detail.id, groups: this.groups.map(({ title, topics, qaIds, reason }) => ({ title, topics, qaIds, reason })), baseRevision: this.detail.revision }));
      await this.refreshContext();
    }
    if (render) this.render();
  }

  async navigate(reference) {
    // Keep edited suggestions recoverable when the modal closes for source reading.
    await this.saveEdits(false);
    const args = { ...reference, conversationId: this.detail?.conversationId ?? this.context.conversation.id, pathId: this.detail?.pathId ?? this.context.path.id };
    this.dialog.close(); await this.onNavigate?.(args);
  }

  download(value, filename) {
    const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: typeof value === 'string' ? 'text/plain;charset=utf-8' : 'application/json' }));
    this.urls.push(url);
    const link = el('a', { href: url, download: filename }); document.body.append(link); link.click(); link.remove();
    return el('a', { href: url, download: filename, text: `下载 ${filename}` });
  }

  async copyPrompt(text, textarea) {
    try { await navigator.clipboard.writeText(text); this.setNotice('提示词已复制，可以粘贴给外部模型。'); }
    catch { textarea.focus(); textarea.select(); this.setNotice('浏览器未允许自动复制，提示词已选中，请按 Ctrl+C。'); }
  }

  async exportPack() {
    const batchSize = el('input', { type: 'number', value: 20, min: 2, max: 100, 'aria-label': '每批目标 Q/A 数量' });
    const packHost = el('section', { class: 'organization-pack' }, [el('h3', { text: '外部模型整理包' }),
      el('p', { class: 'muted', text: '每批包含稳定 QA、消息、版本引用和相邻上下文。模型只能整理本批目标成员；上下文用于衔接。多批结果需按返回格式汇总全部 batches 后一次导入，单批结果不会覆盖地图。导入后仍需人工确认。' })]);
    this.previewHost.before(packHost);
    const generate = async () => {
      const result = await this.api('organizationExport', { ...this.rangeArgs(), batchSize: Number(batchSize.value) });
      const filename = `ACVN-analysis-${this.context.conversation.id}.json`;
      const prompt = result.prompt ?? result.pack?.prompt ?? '';
      packHost.replaceChildren(el('h3', { text: '整理包与分析提示词' }), el('div', { class: 'actions' }, [this.download(result.pack, filename)]));
      if (result.pack.warnings?.length) packHost.append(el('ul', { class: 'preview-warnings' }, result.pack.warnings.map(text => el('li', { text }))));
      const promptArea = el('textarea', { class: 'organization-json', rows: 8, readOnly: true, value: prompt, 'aria-label': '可复制给 ChatGPT 的分析提示词' });
      packHost.append(promptArea, el('div', { class: 'actions' }, [button('复制完整提示词', () => this.run(() => this.copyPrompt(prompt, promptArea))), button('下载提示词', () => this.download(prompt, 'ACVN-analysis-prompt.txt'))]));
      for (const [index, batch] of (result.batches ?? []).entries()) {
        const batchPrompt = batch.prompt ?? prompt;
        const batchArea = el('textarea', { class: 'organization-json', rows: 6, readOnly: true, value: batchPrompt, 'aria-label': `第 ${index + 1} 批提示词` });
        const payload = batch.pack ?? batch.packet ?? batch.data ?? batch;
        packHost.append(el('details', {}, [el('summary', { text: `第 ${index + 1} 批 · ${batch.coreQAIds?.length ?? batch.qaIds?.length ?? batch.targetQAIds?.length ?? '?'} 个目标轮次 · 带相邻上下文` }), batchArea,
          el('div', { class: 'actions' }, [button('复制这批提示词', () => this.run(() => this.copyPrompt(batchPrompt, batchArea))), button('下载这批 JSON', () => this.download(payload, `ACVN-analysis-batch-${index + 1}.json`))])]));
      }
      this.setNotice('整理包已保存稳定引用，尚未更改地图。将提示词和对应 JSON 给模型，导入返回 JSON 后预览确认。');
    };
    packHost.append(el('label', { class: 'field' }, [el('span', { text: '每批目标轮数（长对话分批，自动保留相邻上下文）' }), batchSize]),
      button('生成并下载整理包', () => this.run(generate), 'btn primary'));
    packHost.scrollIntoView({ block: 'nearest' }); this.setNotice('选择每批轮数，再生成整理包。');
  }
}
