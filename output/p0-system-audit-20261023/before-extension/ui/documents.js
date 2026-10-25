import { el, button, badge, labelRole, showDialog } from './dom.js';
import { prepareDialogLayout, routeDialogNotice } from './dialog-layout.js';
import { markPanelSaved } from './panel-close.js';
import { composeDocument } from '../domain/document-export.js';
import { createDocxBlob } from '../exports/docx.js';
import { documentToMarkdown, documentToPrintableHtml, renderDocument, DOCUMENT_STYLES } from '../exports/render.js';

const key = (conversationId, message) => JSON.stringify([conversationId, message.id, message.versionId]);
const filename = title => (String(title).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/g, '').slice(0, 100) || '对话资料');

export class DocumentExportPanel {
  constructor({ api, onError }) {
    this.api = api; this.onError = onError; this.urls = []; this.epoch = 0; this.session = 0;
    this.dialog = el('dialog', { class: 'preview-dialog document-dialog', 'aria-label': '导出文档与跨对话资料包' });
    document.body.append(this.dialog);
    this.dialog.addEventListener('close', () => { if (!this.dialog.open) { this.epoch++; this.session++; } });
  }
  async open(context) {
    if (!context.projectId) throw new Error('请先选择已保存对话的本地项目。');
    const savedMode = context.initialMode === 'saved';
    for (const entry of this.urls.filter(entry => !entry.printing)) URL.revokeObjectURL(entry.url);
    this.urls = this.urls.filter(entry => entry.printing);
    this.session++; this.epoch++; this.busy = null;
    this.context = context; this.mode = savedMode ? 'project' : context.initialMode ?? 'conversation'; this.sources = null; this.recipe = null; this.recipeList = [];
    this.dialog.replaceChildren();
    const close = () => this.dialog.close();
    this.dialog.append(el('div', { class: 'dialog-header' }, [el('h2', { text: '导出文档 / 资料包' }), button('关闭', close)]));
    this.content = el('div', { class: 'dialog-body document-builder' });
    this.title = el('input', { value: context.projectName || '对话资料', 'aria-label': '资料标题' });
    this.scope = el('select', { 'aria-label': '导出范围' }, [
      el('option', { value: 'conversation', text: '当前对话', disabled: !context.conversationId }),
      el('option', { value: 'qa', text: '当前问答', disabled: !context.qaId }),
      el('option', { value: 'segment', text: '当前讨论片段', disabled: !context.segmentId }),
      el('option', { value: 'project', text: '项目资料包 · 可选多条对话' }),
      el('option', { value: 'recipe', text: '已保存方案 · 固定正文版本', disabled: true })
    ]);
    if (!context.conversationId && this.mode !== 'project') this.mode = 'project';
    this.scope.value = this.mode;
    this.includeUser = el('input', { type: 'checkbox', checked: true, 'aria-label': '包含用户问题' });
    this.includeSources = el('input', { type: 'checkbox', checked: true, 'aria-label': '附加来源与版本' });
    this.content.append(el('div', { class: 'document-settings' }, [
      el('label', { class: 'field' }, [el('span', { text: '资料标题' }), this.title]),
      el('label', { class: 'field' }, [el('span', { text: '导出范围' }), this.scope]),
      el('label', { class: 'check' }, [this.includeUser, el('span', { text: '包含用户问题' })]),
      el('label', { class: 'check' }, [this.includeSources, el('span', { text: '附加来源地址、范围与正文版本' })]),
      el('p', { class: 'footnote', text: '正文和版本来自已保存资料。未确认角色的正文会保留；取消问题仅排除已确认的平台用户角色。图片保留引用，复杂公式保留原表达式。' })
    ]));
    this.recipeSelect = el('select', { 'aria-label': '已保存资料包方案' }, [el('option', { value: '', text: '尚未读取方案列表' })]);
    this.recipeName = el('input', { 'aria-label': '资料包方案名称', placeholder: '给这套选择和章节起一个名称' });
    this.includeArchived = el('input', { type: 'checkbox', 'aria-label': '显示归档方案' });
    this.recipeStatus = el('p', { class: 'footnote', text: '方案会保存章节、选择顺序和确切正文版本，重新打开时保留这套资料。' });
    this.openRecipeButton = button('打开方案', () => this.run(() => this.openRecipe(this.recipeSelect.value)));
    this.renameRecipeButton = button('重命名方案', () => this.run(() => this.renameRecipe()));
    this.archiveRecipeButton = button('归档方案', () => this.run(() => this.archiveRecipe()));
    this.content.append(el('details', { class: 'document-recipes' }, [el('summary', { text: '已保存资料包方案' }),
      el('label', { class: 'field' }, [el('span', { text: '选择已保存方案' }), this.recipeSelect]),
      el('label', { class: 'check' }, [this.includeArchived, el('span', { text: '显示归档方案' })]),
      el('label', { class: 'field' }, [el('span', { text: '方案名称' }), this.recipeName]),
      el('div', { class: 'actions small' }, [this.openRecipeButton, this.renameRecipeButton, this.archiveRecipeButton]), this.recipeStatus]));
    this.chapterHost = el('section', { class: 'document-chapters', 'aria-label': '资料章节' });
    this.sourceHost = el('section', { class: 'document-sources', 'aria-label': '选择导出正文' });
    this.preview = el('section', { class: 'document-preview', hidden: true, 'aria-label': '文件内容预览' });
    this.preview.append(el('style', { text: DOCUMENT_STYLES }));
    this.content.append(this.chapterHost, this.sourceHost, this.preview); this.dialog.append(this.content);
    this.format = el('select', { 'aria-label': '导出格式' }, [
      el('option', { value: 'docx', text: 'DOCX · Word / WPS 可编辑' }),
      el('option', { value: 'pdf', text: 'PDF · 打开打印版后另存为 PDF' }),
      el('option', { value: 'md', text: 'Markdown · 完整原文' }),
      el('option', { value: 'html', text: 'HTML · 离线阅读 / 打印' })
    ]);
    this.content.querySelector('.document-settings').append(el('label', { class: 'field document-format' }, [el('span', { text: '文件格式' }), this.format]));
    this.summary = el('p', { class: 'footnote', text: '正在读取导出范围…', role: 'status' });
    this.downloadHost = el('div', { class: 'document-download-links' });
    this.previewButton = button('预览文件', () => this.run(() => this.showPreview()));
    this.exportButton = button('生成文件', () => this.run(() => this.export()), 'btn primary');
    this.saveRecipeButton = button('保存方案', () => this.run(() => this.saveRecipe(false)));
    this.saveAsRecipeButton = button('另存方案', () => this.run(() => this.saveRecipe(true)));
    this.footer = el('div', { class: 'preview-footer' }, [this.summary, this.downloadHost,
      el('div', { class: 'actions' }, [button('取消', close), this.saveRecipeButton, this.saveAsRecipeButton, this.previewButton, this.exportButton])]);
    this.dialog.append(this.footer);
    this.title.addEventListener('input', () => { this.titleDirty = true; this.invalidatePreview(); });
    this.scope.addEventListener('change', () => this.run(() => this.load(this.scope.value)));
    for (const control of [this.includeUser, this.includeSources]) control.addEventListener('change', () => this.changed());
    this.format.addEventListener('change', () => { this.exportButton.textContent = this.format.value === 'pdf' ? '打开 PDF 打印版' : '生成文件'; });
    this.includeArchived.addEventListener('change', () => this.run(() => this.refreshRecipes()));
    this.recipeSelect.addEventListener('change', () => { this.openRecipeButton.disabled = !this.recipeSelect.value; });
    this.titleDirty = false;
    prepareDialogLayout(this.dialog); if (!this.dialog.open) showDialog(this.dialog);
    if (savedMode) this.content.querySelector('.document-recipes').open = true;
    const openingSession = this.session;
    await this.run(async () => {
      if (savedMode) {
        await this.refreshRecipes(); if (openingSession !== this.session || !this.dialog.open) return;
        if (this.recipeList.length) await this.openRecipe(this.recipeList[0].id); else await this.load('project');
      } else { await this.load(this.mode); if (openingSession !== this.session || !this.dialog.open) return; await this.refreshRecipes(); }
    });
  }
  async run(action) {
    const session = this.session;
    if (this.busy === session) return; this.busy = session;
    const held = [...this.dialog.querySelectorAll('.document-builder input, .document-builder select, .document-builder button')].map(control => [control, control.disabled]); held.forEach(([control]) => { control.disabled = true; });
    const controls = [this.previewButton, this.exportButton, this.scope, this.saveRecipeButton, this.saveAsRecipeButton, this.openRecipeButton, this.renameRecipeButton, this.archiveRecipeButton, this.recipeSelect, this.includeArchived]; controls.forEach(control => { control.disabled = true; });
    try { await action(); } catch (error) {
      if (session === this.session && this.dialog.open && !routeDialogNotice(this.dialog, error.message, true)) this.onError(error.message);
    } finally {
      if (session === this.session) { this.busy = null; this.previewButton.disabled = !this.sources; this.exportButton.disabled = !this.sources; this.scope.disabled = false;
        held.forEach(([control, disabled]) => { control.disabled = disabled; }); this.scope.disabled = false;
        this.saveRecipeButton.disabled = !this.sources || this.recipe?.status === 'archived'; this.saveAsRecipeButton.disabled = !this.sources; this.openRecipeButton.disabled = !this.recipeSelect.value;
        this.renameRecipeButton.disabled = !this.recipe; this.archiveRecipeButton.disabled = !this.recipe; this.recipeSelect.disabled = false; this.includeArchived.disabled = false; }
    }
  }
  async load(mode) {
    if (mode === 'recipe') return this.openRecipe(this.recipeSelect.value || this.recipe?.id);
    const token = ++this.epoch; this.summary.textContent = '正在读取所选正文与确切版本…'; this.sources = null;
    this.chapterHost.replaceChildren(); this.sourceHost.replaceChildren(); this.preview.hidden = true; this.downloadHost.replaceChildren();
    const args = { projectId: this.context.projectId };
    if (mode !== 'project') args.conversationIds = [this.context.conversationId];
    if (mode === 'qa') args.qaIds = [this.context.qaId];
    if (mode === 'segment') args.segmentIds = [this.context.segmentId];
    if (mode !== 'project' && this.context.pathId) args.pathSelections = { [this.context.conversationId]: this.context.pathId };
    const sources = await this.api('documentSources', args);
    if (token !== this.epoch || !this.dialog.open) return;
    this.sources = sources; this.mode = mode; this.recipe = null; this.catalog = new Map(); this.selected = new Set(); this.assignments = new Map(); this.limits = new Map(); this.entryOrder = [];
    this.chapters = sources.conversations.map((conversation, index) => ({ id: `chapter-${index}`, title: conversation.title }));
    for (const [index, conversation] of sources.conversations.entries()) for (const message of conversation.messages) {
      const id = key(conversation.id, message); this.catalog.set(id, { conversation, message }); this.selected.add(id); this.assignments.set(id, this.chapters[index].id); this.entryOrder.push(id);
    }
    if (!this.titleDirty) this.title.value = mode === 'project' ? `${sources.project.name} 资料包` : sources.conversations[0]?.title || `${sources.project.name} 对话资料`;
    this.recipeName.value = this.title.value; this.recipeStatus.textContent = '尚未保存方案。保存后可重新打开这套章节、选择和确切正文版本。'; this.archiveRecipeButton.textContent = '归档方案';
    this.renderChapters(); this.renderSources(); this.changed();
  }
  async refreshRecipes() {
    const session = this.session, selectedId = this.recipe?.id || this.recipeSelect.value;
    const result = await this.api('documentRecipeList', { projectId: this.context.projectId, includeArchived: this.includeArchived.checked });
    if (session !== this.session || !this.dialog.open) return;
    const recipes = Array.isArray(result) ? result : result.recipes;
    if (!Array.isArray(recipes) || recipes.some(recipe => recipe.projectId !== this.context.projectId)) throw new Error('方案列表不属于当前项目。');
    this.recipeList = recipes; this.recipeSelect.replaceChildren(el('option', { value: '', text: recipes.length ? '选择一个已保存方案' : '当前项目还没有已保存方案' }), ...recipes.map(recipe => el('option', { value: recipe.id, text: `${recipe.name}${recipe.status === 'archived' ? '（归档）' : ''} · ${recipe.chapterCount} 章 / ${recipe.entryCount} 段` })));
    this.recipeSelect.value = recipes.some(recipe => recipe.id === selectedId) ? selectedId : '';
  }
  async openRecipe(recipeId) {
    if (!recipeId) throw new Error('请先选择一个已保存方案。');
    const token = ++this.epoch, result = await this.api('documentRecipeGet', { projectId: this.context.projectId, recipeId });
    if (token !== this.epoch || !this.dialog.open) return;
    const { recipe, sources } = result;
    if (recipe?.projectId !== this.context.projectId || recipe.id !== recipeId || sources?.project?.id !== this.context.projectId) throw new Error('方案与当前项目不一致。');
    const catalog = new Map(); for (const conversation of sources.conversations) for (const message of conversation.messages) catalog.set(key(conversation.id, message), { conversation, message });
    const selected = new Set(), assignments = new Map(), entryOrder = [];
    for (const chapter of recipe.chapters) for (const ref of chapter.items) {
      const identity = JSON.stringify([ref.conversationId, ref.messageId, ref.versionId]), row = catalog.get(identity);
      if (!row || row.conversation.pathId !== ref.pathId || selected.has(identity)) throw new Error('方案选择的原文、路径或版本不完整，请重新检查方案。');
      selected.add(identity); assignments.set(identity, chapter.id); entryOrder.push(identity);
    }
    // Validate all references including currently excluded prompts. The saved
    // choices survive toggling "include questions" after reopening.
    composeDocument(sources, { title: recipe.title, includeUserPrompts: true, chapters: recipe.chapters });
    this.sources = sources; this.recipe = recipe; this.mode = 'recipe'; this.scope.value = 'recipe'; this.catalog = catalog; this.selected = selected; this.assignments = assignments; this.entryOrder = entryOrder; this.limits = new Map();
    this.chapters = recipe.chapters.map(chapter => ({ id: chapter.id, title: chapter.title }));
    this.title.value = recipe.title; this.titleDirty = true; this.recipeName.value = recipe.name; this.includeUser.checked = recipe.includeUserPrompts !== false; this.includeSources.checked = recipe.includeSourceAppendix !== false; this.format.value = recipe.format || 'docx';
    this.exportButton.textContent = this.format.value === 'pdf' ? '打开 PDF 打印版' : '生成文件'; this.archiveRecipeButton.textContent = recipe.status === 'archived' ? '恢复方案' : '归档方案';
    this.renderChapters(); this.renderSources(); this.changed(); this.recipeStatus.textContent = `已打开“${recipe.name}” · 保存版本固定${recipe.status === 'archived' ? '；已归档，可恢复或另存新方案' : '；修改后可保存或另存'}。`;
  }
  async saveRecipe(saveAs) {
    if (!this.sources) throw new Error('请先读取并选择正文。');
    const token = this.epoch, source = this.recipe, proposedName = this.recipeName.value.trim() || this.title.value;
    const args = { projectId: this.context.projectId, name: saveAs && source && proposedName === source.name ? `${proposedName}（副本）` : proposedName, selection: this.selectionPlan(),
      ...(source ? { sourceRecipeId: source.id, sourceRevision: source.revision } : {}), ...(!saveAs && source ? { recipeId: source.id, expectedRevision: source.revision } : {}) };
    const result = await this.api('documentRecipeSave', args); if (token !== this.epoch || !this.dialog.open) return;
    const recipe = result.recipe ?? result; if (recipe.projectId !== this.context.projectId) throw new Error('保存返回了另一项目的方案。');
    this.recipe = recipe; this.recipeName.value = recipe.name; await this.refreshRecipes(); this.recipeStatus.textContent = `已保存“${recipe.name}” · ${recipe.chapters.length} 章 · 选择顺序和确切正文版本已保留。`;
    markPanelSaved(this.dialog);routeDialogNotice(this.dialog, saveAs ? '已另存为新方案，原方案仍保留。' : '资料包方案已保存，可关闭后再次打开。');
  }
  async renameRecipe() {
    if (!this.recipe) throw new Error('请先打开需要重命名的方案。');
    const token = this.epoch, result = await this.api('documentRecipeRename', { projectId: this.context.projectId, recipeId: this.recipe.id, expectedRevision: this.recipe.revision, name: this.recipeName.value });
    if (token !== this.epoch || !this.dialog.open) return; this.recipe = result.recipe ?? result; await this.refreshRecipes(); this.recipeStatus.textContent = `方案已重命名为“${this.recipe.name}”，章节和原文选择保持原样。`;
  }
  async archiveRecipe() {
    if (!this.recipe) throw new Error('请先打开需要归档的方案。');
    const token = this.epoch, archived = this.recipe.status !== 'archived', result = await this.api('documentRecipeArchive', { projectId: this.context.projectId, recipeId: this.recipe.id, expectedRevision: this.recipe.revision, archived });
    if (token !== this.epoch || !this.dialog.open) return; this.recipe = result.recipe ?? result; this.archiveRecipeButton.textContent = archived ? '恢复方案' : '归档方案'; await this.refreshRecipes(); this.recipeStatus.textContent = archived ? '方案已归档。原文、章节和选择仍保留，可以恢复或另存新方案。' : '方案已恢复到当前项目列表。';
  }
  orderedKeys(chapterId) { return this.entryOrder.filter(identity => this.selected.has(identity) && this.assignments.get(identity) === chapterId && this.catalog.has(identity)); }
  moveEntry(identity, direction) {
    const members = this.orderedKeys(this.assignments.get(identity)), index = members.indexOf(identity), other = members[index + direction]; if (!other) return;
    const first = this.entryOrder.indexOf(identity), second = this.entryOrder.indexOf(other); [this.entryOrder[first], this.entryOrder[second]] = [this.entryOrder[second], this.entryOrder[first]];
    this.renderSources(); this.changed();
  }
  changed() { this.invalidatePreview(); this.updateSummary(); }
  invalidatePreview() { this.preview.hidden = true; this.previewButton.textContent = '预览文件'; this.downloadHost.replaceChildren(); }
  updateSummary() {
    if (!this.sources) return;
    const selected = [...this.selected].map(id => this.catalog.get(id)).filter(Boolean);
    const included = selected.filter(({ message }) => this.includeUser.checked || message.role !== 'user' || message.roleUnverified);
    const conversations = new Set(included.map(row => row.conversation.id));
    this.summary.textContent = `将导出 ${conversations.size} 条对话中的 ${included.length} 段正文 · 来源按保存版本固定。`;
  }
  chapterOptions(selected = null, empty = false) {
    return [...(empty ? [el('option', { value: '', text: '选择章节，可批量分配本条对话' })] : []),
      ...this.chapters.map(chapter => el('option', { value: chapter.id, text: chapter.title, selected: chapter.id === selected }))];
  }
  renderChapters() {
    this.chapterHost.replaceChildren(el('h3', { text: '章节与话题' }), el('p', { class: 'muted', text: '章节标题和顺序由你设置。可把不同对话放入同一话题，原文来源会分别保留。' }));
    const addTitle = el('input', { placeholder: '新话题章节名称', 'aria-label': '新话题章节名称' });
    this.chapterHost.append(el('div', { class: 'document-chapter-add actions' }, [addTitle, button('添加章节', () => {
      const title = addTitle.value.trim(); if (!title) return routeDialogNotice(this.dialog, '请先填写新话题章节名称。', true);
      this.chapters.push({ id: `chapter-new-${Date.now()}-${this.chapters.length}`, title }); this.renderChapters(); this.renderSources(); this.changed();
    }), button('按已存主题分组', () => this.groupByTopics())]));
    const list = el('div', { class: 'document-chapter-list' });
    for (const [index, chapter] of this.chapters.entries()) {
      const title = el('input', { value: chapter.title, 'aria-label': `第 ${index + 1} 章标题` });
      title.addEventListener('change', () => { chapter.title = title.value.trim(); this.renderSources(); this.changed(); });
      const move = direction => { const next = index + direction; [this.chapters[index], this.chapters[next]] = [this.chapters[next], this.chapters[index]]; this.renderChapters(); this.renderSources(); this.changed(); };
      list.append(el('div', { class: 'document-chapter-row' }, [el('span', { text: String(index + 1) }), title,
        button('↑', () => move(-1), 'btn quiet', { disabled: index === 0, 'aria-label': `上移第 ${index + 1} 章` }),
        button('↓', () => move(1), 'btn quiet', { disabled: index === this.chapters.length - 1, 'aria-label': `下移第 ${index + 1} 章` })]));
    }
    this.chapterHost.append(list);
  }
  groupByTopics() {
    const groups = new Map(); this.chapters = [];
    for (const [id, { message }] of this.catalog) {
      const name = message.topicNames?.[0] ?? '待归类正文';
      if (!groups.has(name)) { const chapter = { id: `topic-${groups.size}`, title: name }; groups.set(name, chapter); this.chapters.push(chapter); }
      this.assignments.set(id, groups.get(name).id);
    }
    this.renderChapters(); this.renderSources(); this.changed();
    routeDialogNotice(this.dialog, '按实际保存的第一个主题分组；没有主题的正文留在“待归类正文”，你可以调整章节。');
  }
  renderSources() {
    const expanded = new Set([...this.sourceHost.querySelectorAll('details[open]')].map(node => node.dataset.conversationId));
    this.sourceHost.replaceChildren(el('h3', { text: '选择正文' }));
    this.sourceHost.append(el('div', { class: 'actions small' }, [button('全选正文', () => { this.catalog.forEach((_, id) => this.selected.add(id)); this.renderSources(); this.changed(); }),
      button('取消全选', () => { this.selected.clear(); this.renderSources(); this.changed(); })]));
    for (const conversation of this.sources.conversations) {
      const ids = conversation.messages.map(message => key(conversation.id, message));
      const check = el('input', { type: 'checkbox', checked: ids.every(id => this.selected.has(id)), 'aria-label': `包含对话 ${conversation.title}` });
      check.indeterminate = ids.some(id => this.selected.has(id)) && !check.checked;
      check.addEventListener('change', () => { ids.forEach(id => check.checked ? this.selected.add(id) : this.selected.delete(id)); this.renderSources(); this.changed(); });
      const count = badge(`${ids.filter(id => this.selected.has(id)).length} / ${ids.length} 段`);
      const updateConversation = () => {
        check.checked = ids.every(id => this.selected.has(id)); check.indeterminate = ids.some(id => this.selected.has(id)) && !check.checked;
        count.textContent = `${ids.filter(id => this.selected.has(id)).length} / ${ids.length} 段`;
      };
      const section = el('details', { class: 'document-conversation', open: this.sources.conversations.length === 1 || expanded.has(conversation.id), 'data-conversation-id': conversation.id }, [
        el('summary', {}, [el('span', { text: conversation.title }), count]),
        el('label', { class: 'check' }, [check, el('span', { text: '包含这条对话的正文' })]), el('p', { class: 'footnote', text: conversation.scopeDescription })]);
      const batch = el('select', { 'aria-label': `对话 ${conversation.title} 的章节` }, this.chapterOptions(null, true));
      batch.addEventListener('change', () => { if (!batch.value) return; ids.forEach(id => this.assignments.set(id, batch.value)); this.renderSources(); this.changed(); });
      section.append(el('label', { class: 'field' }, [el('span', { text: '整条对话放入章节' }), batch]));
      const limit = this.limits.get(conversation.id) ?? 40;
      for (const [index, message] of conversation.messages.slice(0, limit).entries()) {
        const id = key(conversation.id, message), include = el('input', { type: 'checkbox', checked: this.selected.has(id), 'aria-label': `导出 ${conversation.title} 第 ${index + 1} 段` });
        include.addEventListener('change', () => { include.checked ? this.selected.add(id) : this.selected.delete(id); updateConversation(); this.renderSources(); this.changed(); });
        const assignment = el('select', { 'aria-label': `${conversation.title} 第 ${index + 1} 段的章节` }, this.chapterOptions(this.assignments.get(id)));
        assignment.addEventListener('change', () => { this.assignments.set(id, assignment.value); this.renderSources(); this.changed(); });
        const members = this.orderedKeys(this.assignments.get(id)), position = members.indexOf(id);
        section.append(el('div', { class: 'document-message-row' }, [el('label', { class: 'check' }, [include, el('span', { text: `${index + 1} · ${labelRole(message.role)} · ${message.text.length.toLocaleString()} 字符` })]),
          el('p', { class: 'document-excerpt', text: message.text.slice(0, 140) || '（此段没有可读文字）' }), assignment,
          el('div', { class: 'actions small' }, [el('span', { class: 'muted', text: position >= 0 ? `章节内第 ${position + 1} 段` : '未选择' }),
            button('↑', () => this.moveEntry(id, -1), 'btn quiet', { disabled: position <= 0, 'aria-label': `上移 ${conversation.title} 第 ${index + 1} 段` }),
            button('↓', () => this.moveEntry(id, 1), 'btn quiet', { disabled: position < 0 || position >= members.length - 1, 'aria-label': `下移 ${conversation.title} 第 ${index + 1} 段` })])]));
      }
      if (conversation.messages.length > limit) section.append(button(`显示更多正文（${Math.min(limit, conversation.messages.length)} / ${conversation.messages.length}）`, () => { this.limits.set(conversation.id, limit + 40); this.renderSources(); }));
      this.sourceHost.append(section);
    }
  }
  selectionPlan() {
    return { title: this.title.value, includeUserPrompts: this.includeUser.checked, includeSourceAppendix: this.includeSources.checked, format: this.format.value,
      chapters: this.chapters.map(chapter => ({ id: chapter.id, title: chapter.title, items: this.orderedKeys(chapter.id).map(identity => {
        const { conversation, message } = this.catalog.get(identity);
        return { conversationId: conversation.id, pathId: conversation.pathId, messageId: message.id, versionId: message.versionId,
          role: message.role, roleUnverified: message.roleUnverified === true, confirmedRole: message.confirmedRole ?? null, sourceTime: message.sourceTime };
      }) })) };
  }
  specification() { return composeDocument(this.sources, this.selectionPlan()); }
  showPreview() {
    const spec = this.specification(); this.preview.replaceChildren(el('style', { text: DOCUMENT_STYLES }), renderDocument(document, spec)); this.preview.hidden = false;
    this.previewButton.textContent = '更新预览'; this.preview.scrollIntoView({ block: 'start', behavior: 'smooth' });
    routeDialogNotice(this.dialog, '下方预览包含本次选择的完整正文。修改选择后请更新预览。');
  }
  async export() {
    const spec = this.specification(), format = this.format.value, name = filename(spec.title);
    if (format === 'pdf') {
      const token = this.epoch, snapshot = await this.api('documentPrintSave', { projectId: this.context.projectId, selection: this.selectionPlan(),
        ...(this.recipe ? { recipeId: this.recipe.id, expectedRevision: this.recipe.revision } : {}) });
      if (token !== this.epoch || !this.dialog.open) return;
      if (!snapshot?.id || snapshot.projectId !== this.context.projectId) throw new Error('打印快照保存失败，请重新生成。');
      const url = `${chrome.runtime.getURL('print.html')}?record=${encodeURIComponent(snapshot.id)}`;
      this.downloadHost.replaceChildren(el('a', { href: url, target: '_blank', rel: 'noopener', text: '重新打开已保存的 PDF 打印版' }));
      await chrome.tabs.create({ url }); routeDialogNotice(this.dialog, '固定版本的打印快照已保存并打开。点击打印，选择“另存为 PDF”；重开页面仍读取同一快照。'); return;
    }
    let blob, suffix;
    if (format === 'docx') { blob = createDocxBlob(spec); suffix = '.docx'; }
    else if (format === 'md') { blob = new Blob([documentToMarkdown(spec)], { type: 'text/markdown;charset=utf-8' }); suffix = '.md'; }
    else { blob = new Blob([documentToPrintableHtml(spec)], { type: 'text/html;charset=utf-8' }); suffix = '.html'; }
    const url = URL.createObjectURL(blob); this.urls.push({ url, printing: false });
    const downloads = this.urls.filter(entry => !entry.printing);
    for (const entry of downloads.slice(0, -2)) { URL.revokeObjectURL(entry.url); this.urls.splice(this.urls.indexOf(entry), 1); }
    this.downloadHost.replaceChildren();
    const link = el('a', { href: url, download: `${name}${suffix}`, text: `再次下载 ${name}${suffix}` }); document.body.append(link); link.click(); link.remove(); this.downloadHost.append(link);
    routeDialogNotice(this.dialog, '文件已生成。下方保留下载入口，可继续调整或关闭。');
  }
}
