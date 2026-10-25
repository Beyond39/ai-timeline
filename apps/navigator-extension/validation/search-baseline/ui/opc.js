import { el, button, badge, ask, timeLabel, openSource } from './dom.js';
import { richBody, copyBodyButton } from './body.js';
import { CARD_TYPES, ORGANIZATION_STATES, ADOPTION_STATES } from '../domain/card-metadata.js';
import { HorizontalTimeline } from './horizontal-timeline.js';
import { ContextDeploy } from './context-deploy.js';
import { ReflectionPanel } from './reflection.js';
import { defaultTrackPreferences } from '../domain/timeline-tracks.js';
import { AnnotationDrafts } from './opc-drafts.js';
import { canvasEdge } from '../domain/canvas-layout.js';
import { fitNodeViewport, visibleNodeViewport } from '../domain/canvas-viewport.js';

const day = value => value ? new Intl.DateTimeFormat('sv-SE').format(new Date(value)) : '时间未知';
const title = card => card.metadata?.title || card.questionPreview;
export function comparePositions(cards, width = 1400, range = null) {
  const known = cards.filter(c => c.questionTime?.value), times = known.map(c => Date.parse(c.questionTime.value));
  const min = range?.min ?? (times.length ? Math.min(...times) : null), max = range?.max ?? (times.length ? Math.max(...times) : null), span = Math.max(1, max - min);
  return { min, max, positions: new Map(known.map(c => [c.id, 40 + (Date.parse(c.questionTime.value) - min) / span * (width - 340)])) };
}

export class OPCTimeline {
  constructor(host, { api, onError, onModeChange, legacyList = false } = {}) {
    this.host = host; this.api = api; this.onError = onError; this.epoch = 0; this.detailEpoch = 0;
    this.filters = { timelineIds: [], query: '', tag: '', date: '', cardId: null, offset: 0, limit: 60 };
    this.checked = new Set(); this.mode = 'timeline'; this.positions = {}; this.viewport = { x: 20, y: 20, zoom: 1 };
    this.drafts = new AnnotationDrafts({ onError });
    this.onModeChange=onModeChange;this.legacyList=legacyList;this.horizontal=new HorizontalTimeline(this);this.deploy=new ContextDeploy(this);this.reflection=new ReflectionPanel(this);
    this.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.onPageHide = () => { this.drafts.flush(); this.flushMetadata(); this.flushLayout(); this.deploy.flush(); this.horizontal.flush(); };
    globalThis.addEventListener?.('pagehide', this.onPageHide);
  }
  safe(run) { return async (...args) => { try { await run(...args); } catch (e) { this.onError?.(e.message); } }; }
  async show({ projectId, mode = 'timeline', targetCardId = null }) {
    await this.deploy.flush();await this.horizontal.flush();await this.flushMetadata();
    await this.flushLayout();
    if (this.projectId !== projectId) { this.trackPreferences=null;Object.assign(this.filters, { timelineIds: [], offset: 0, cardId: null, query: '', date: '', tag: '', revealCardId: null, canvasCardIds: [], includeHidden: false, includeInvalid: false, conversationId: '', contentType: '', organizationStatus: '', favorite: false, dateFrom: '', dateTo: '' }); this.checked.clear(); this.selected = null; this.relationSource = null; }
    this.projectId = projectId; this.mode = mode;if(mode==='deploy'){await this.deploy.show(projectId);return;} await this.load(); if (targetCardId) await this.locate(targetCardId);
  }
  async navigate(mode,targetCardId=null){await this.flushMetadata();await this.deploy.flush();if(this.onModeChange)return this.onModeChange(mode,targetCardId);return this.show({projectId:this.projectId,mode,targetCardId});}
  async addToTray(cardIds){await this.flushMetadata();await this.api('releaseWrite',{projectId:this.projectId,action:'tray',operation:'add',cardIds});if(this.mode==='deploy')await this.deploy.show(this.projectId);else await this.load();}
  async load() {
    if(this.mode==='deploy'){await this.deploy.show(this.projectId);return;}
    this.horizontal.capture();await this.horizontal.flush();
    await this.flushMetadata();
    await this.flushLayout();
    const epoch = ++this.epoch;
    const args = () => ({ projectId: this.projectId, ...this.filters, timeZone: this.timeZone, canvasCardIds: this.mode === 'canvas' ? this.filters.canvasCardIds : [] });
    const pageAPI=this.mode==='timeline'&&!this.legacyList?'opcTimeline':'opcPage';
    let data = await this.api(pageAPI, args());
    if (epoch !== this.epoch) return;
    const visibleIds = new Set(data.timelines.filter(t => !t.hidden && !t.archived).map(t => t.id));
    if (!this.filters.includeHidden && !this.filters.cardId && this.filters.timelineIds.some(k => !visibleIds.has(k))) {
      this.filters.timelineIds = this.filters.timelineIds.filter(k => visibleIds.has(k)); this.filters.offset = 0;
      data = await this.api(pageAPI, args()); if (epoch !== this.epoch) return;
    }
    if ((!data.timelines.length || data.needsProjection) && !this.ensured?.has(this.projectId)) {
      this.ensured ??= new Set(); await this.api('opcEnsure', { projectId: this.projectId }); this.ensured.add(this.projectId);
      data = await this.api(pageAPI, args()); if (epoch !== this.epoch) return;
    }
    this.filters.offset = data.offset; this.filters.revealCardId = null;
    this.data = data; this.canvasCards = [...data.cards, ...(data.pinnedCards ?? [])];
    if(data.preferences)this.trackPreferences={...data.preferences,fresh:false};else if(!this.trackPreferences||this.trackPreferences.initialNoActivity)this.trackPreferences=defaultTrackPreferences(data);
    this.savedPositions = structuredClone(data.layout?.positions ?? {}); this.positions = structuredClone(this.savedPositions);
    this.savedViewport = { ...(data.layout?.viewport ?? { x: 0, y: 0, zoom: 1 }) }; this.viewport = { ...(data.layout?.viewport ?? { x: 20, y: 20, zoom: 1 }) };
    this.render();
    if (this.selected) await this.openCard(this.selected);
  }
  async write(action, values, { reload = true } = {}) {
    const result = await this.api('opcWrite', { projectId: this.projectId, action, ...values });
    if (reload) await this.load(); return result;
  }
  render() {
    this.horizontal.capture();this.host.replaceChildren(); this.root = el('section', { class: 'opc-root','data-mode':this.mode });
    const header = el('div', { class: 'opc-toolbar' }), create = button('＋ 主题时间线', this.safe(async () => {
      const v = await ask('新建主题时间线', [{ name: 'name', label: '名称' }]); if (v) await this.write('timeline', v);
    }));
    const manage = button('管理时间线', this.safe(() => this.manageTimelines()));
    const compare = button(this.compare ? '单线阅读' : '多线对照', this.safe(async () => { this.compare = !this.compare; await this.load(); }), 'btn', { 'aria-pressed': String(Boolean(this.compare)) });
    const menu=el('details',{class:'opc-actions-menu'},[el('summary',{text:'整理'}),create,manage,button('选择当前结果',()=>{this.data.cards.forEach(c=>this.checked.add(c.id));this.render();if(this.selected)this.safe(()=>this.openCard(this.selected))();})]);
    header.append(button(`构建上下文${this.data.tray?.cardIds?.length?' · '+this.data.tray.cardIds.length:''}`,this.safe(async()=>{if(this.checked.size)await this.addToTray([...this.checked]);await this.navigate('deploy');}),'btn primary'),menu); this.root.append(header);
    if(!this.data.total)this.root.append(el('div',{class:'capture-onboarding'},[el('strong',{text:'提取 → 回顾 → 判断 → 重新部署'}),el('p',{text:'先打开 ChatGPT 对话并点击“导入当前对话”。导入完整有效 Q/A 后，选择节点阅读，再加入上下文托盘并编译复制。无需先学习画布。'})]));
    const chips = el('div', { class: 'opc-timelines', role: 'group', 'aria-label': '选择时间线，可多选' });
    chips.append(button('全部可见时间线', this.safe(async () => { this.filters.timelineIds = []; this.filters.cardId = null; this.filters.includeHidden = false; this.filters.offset = 0; await this.load(); }), `btn ${this.filters.timelineIds.length ? '' : 'primary'}`));
    for (const t of this.data.timelines.filter(t => !t.archived && !t.hidden)) {
      const selected = this.filters.timelineIds.includes(t.id);
      chips.append(button(`${t.kind === 'source' ? '↗' : '#'} ${t.name}`, this.safe(async () => {
        if (!selected && this.compare && this.filters.timelineIds.length >= 5) throw new Error('多线对照最多选择 5 条时间线。');
        this.filters.timelineIds = selected ? this.filters.timelineIds.filter(k => k !== t.id) : this.compare ? [...this.filters.timelineIds, t.id] : [t.id];
        this.filters.offset = 0; this.filters.cardId = null; this.filters.includeHidden = false; await this.load();
      }), `btn ${selected ? 'primary' : ''}`, { 'aria-pressed': String(selected) }));
    }
    if(this.mode!=='timeline'||this.legacyList)menu.append(chips);
    const filters = el('form', { class: 'opc-filters' });
    const query = el('input', { type: 'search', placeholder: '搜索问题、回答、标签或备注', value: this.filters.query, 'aria-label': '搜索 Q/A' });
    const date = el('input', { type: 'date', value: this.filters.date, 'aria-label': `按提问日期筛选（${this.timeZone}）` });
    const tag = el('input', { value: this.filters.tag, placeholder: '标签', 'aria-label': '筛选标签' });
    filters.append(query, el('button', { type: 'submit', class: 'btn', text: '搜索' }), button('清除', this.safe(async () => { Object.assign(this.filters, { query: '', tag: '', date: '', cardId: null, offset: 0, includeInvalid: false, conversationId: '', contentType: '', organizationStatus: '', favorite: false, dateFrom: '', dateTo: '' }); await this.load(); })));
    filters.addEventListener('submit', this.safe(async e => { e.preventDefault(); Object.assign(this.filters, { query: query.value, date: date.value, tag: tag.value.trim(), cardId: null, offset: 0 }); await this.load(); }));
    this.root.append(filters);
    const advanced = el('details', { class: 'opc-search-options' }, [el('summary', { text: '更多筛选' })]);
    const extra = el('form', { class: 'opc-filters' });
    const select = (label, key, values) => { const input = el('select', { 'aria-label': label }, [el('option', { value: '', text: label + '：全部' }), ...values.map(v => el('option', { value: v.id ?? v, text: v.title ?? v }))]); input.value = this.filters[key] ?? ''; return input; };
    const source = select('来源会话', 'conversationId', this.data.sources ?? []), kind = select('类型', 'contentType', CARD_TYPES), state = select('整理状态', 'organizationStatus', ORGANIZATION_STATES);
    const from = el('input', { type: 'date', value: this.filters.dateFrom ?? '', 'aria-label': '开始日期' }), to = el('input', { type: 'date', value: this.filters.dateTo ?? '', 'aria-label': '结束日期' });
    const favorite = el('input', { type: 'checkbox', checked: this.filters.favorite, 'aria-label': '仅收藏' }), invalid = el('input', { type: 'checkbox', checked: this.filters.includeInvalid, 'aria-label': '包含隐藏和待确认记录' });
    extra.append(date,tag,source, kind, state, from, to, el('label', {}, [favorite, '仅收藏']), el('label', {}, [invalid, '包含隐藏记录']), el('button', { type: 'submit', class: 'btn', text: '应用' }));
    extra.addEventListener('submit', this.safe(async e => { e.preventDefault(); Object.assign(this.filters, {date:date.value,tag:tag.value.trim(), conversationId: source.value, contentType: kind.value, organizationStatus: state.value, dateFrom: from.value, dateTo: to.value, favorite: favorite.checked, includeInvalid: invalid.checked, offset: 0 }); await this.load(); }));
    advanced.append(extra); filters.append(advanced);
    const bulk = el('div', { class: 'opc-bulk' });
    this.bulkCount = el('span', { text: `已选 ${this.checked.size} 张` });
    const redraw = () => { this.render(); if (this.selected) this.safe(() => this.openCard(this.selected))(); };
    bulk.append(this.bulkCount, button(this.mode==='timeline'&&!this.legacyList?'选择当前结果':'选择本页', () => { this.data.cards.forEach(c => this.checked.add(c.id)); redraw(); }), button('清空选择', () => { this.checked.clear(); redraw(); }),button('加入上下文托盘',this.safe(()=>this.addToTray([...this.checked]))),button('添加到主题线', this.safe(() => this.membershipDialog([...this.checked]))));
    const selectedTheme = this.filters.timelineIds.length === 1 && this.data.timelines.find(t => t.id === this.filters.timelineIds[0] && t.kind === 'theme');
    if (selectedTheme) bulk.append(button('从此主题线移除', this.safe(async () => { await this.write('membership', { timelineId: selectedTheme.id, cardIds: [...this.checked], remove: true }); this.checked.clear(); this.render(); })));
    if (this.relationSource) bulk.append(el('strong', { text: '点击另一张卡片，或搜索选择关系目标' }), button('搜索目标', this.safe(() => this.relationshipDialog(this.relationSource))), button('取消连接', () => { this.relationSource = null; this.render(); }));
    bulk.hidden=!this.checked.size&&!this.relationSource;this.root.append(bulk);
    const layout = el('div', { class: 'opc-layout opc-stable-workspace' }); this.list = el('div', { class: 'opc-list' }); this.detail = el('aside', { class: 'opc-detail', 'aria-label': 'Q/A 详情', hidden: !this.selected });
    layout.append(this.list, this.detail); this.root.append(layout); this.host.append(this.root);
    if (this.mode === 'canvas') this.renderCanvas(); else if(!this.legacyList)this.safe(()=>this.horizontal.render(this.list,this.data))();else if (this.compare) this.renderCompare(); else this.renderTimeline();
    const pager = el('div', { class: 'opc-pagination' });
    if (this.filters.offset) pager.append(button('上一页', this.safe(async () => { this.filters.offset = Math.max(0, this.filters.offset - this.filters.limit); await this.load(); })));
    pager.append(el('span', { text: this.data.total ? `${this.filters.offset + 1}–${this.filters.offset + this.data.cards.length} / ${this.data.total}` : '暂无已确认完整的问答；可重新同步当前对话' }));
    if (this.data.syncCounts?.pending || this.data.syncCounts?.hidden) pager.append(el('small', { text: `${this.data.syncCounts.pending} 轮待确认，${this.data.syncCounts.hidden} 轮已隐藏；来源与标注已保留` }));
    if (this.data.nextOffset != null) pager.append(button('下一页', this.safe(async () => { this.filters.offset = this.data.nextOffset; await this.load(); })));
    if(this.mode!=='timeline'||this.legacyList)this.list.append(pager);
    if (!this.data.total && this.filters.query) this.list.append(button('扩大搜索范围', this.safe(async () => { Object.assign(this.filters, { tag: '', date: '', dateFrom: '', dateTo: '', conversationId: '', contentType: '', organizationStatus: '', favorite: false, timelineIds: [], offset: 0 }); await this.load(); })), el('p', { class: 'muted', text: '也可以减少关键词；多个关键词以空格分隔。' }));
  }
  card(card) {
    const host = el('article', { class: `opc-card ${this.selected === card.id ? 'selected' : ''}`, 'data-card-id': card.id });
    const checkbox = el('input', { type: 'checkbox', checked: this.checked.has(card.id), 'aria-label': `选择 ${title(card)}` });
    checkbox.addEventListener('change', () => { if (checkbox.checked) this.checked.add(card.id); else this.checked.delete(card.id); this.bulkCount.textContent = `已选 ${this.checked.size} 张`; });
    const open = el('div', { role: 'button', tabindex: 0, class: 'opc-card-content', 'aria-label': `展开完整问答：${title(card)}` });
    const activate = this.safe(async () => {
      if (this.relationSource && this.relationSource !== card.id) { const source = this.relationSource; this.relationSource = null; await this.relationshipDialog(source, card.id); } else await this.openCard(card.id);
    });
    open.addEventListener('click', e => { if (!e.target.closest('a,button,summary')) activate(); });
    open.addEventListener('keydown', e => { if (e.target === open && ['Enter', ' '].includes(e.key)) { e.preventDefault(); activate(); } });
    const q = el('section', { class: 'opc-question', 'aria-label': '问题预览' }, [el('span', { class: 'opc-region-label', text: 'Q' }),
      el('time', { text: card.questionTime.value ? card.questionTime.precision === 'date_only' ? timeLabel(card.questionTime) : new Date(card.questionTime.value).toLocaleString('zh-CN', { timeZone: this.timeZone, hour12: false }) : '时间未知' }),
      el('h3', { text: title(card) }), el('p', { class: 'opc-question-preview', text: card.questionPreview })]);
    const answer = el('section', { class: 'opc-answer', 'aria-label': '回答预览' }, [el('span', { class: 'opc-region-label', text: 'A' }), richBody(card.answerRenderPreview || card.answerPreview || '尚无已确认的完整回答', { format: 'markdown' }), el('small', { text: '展开完整问答 ↗' })]);
    open.append(q, answer);
    const tags = this.tagModule(card);
    const menu = el('details', { class: 'opc-card-menu' }, [el('summary', { 'aria-label': '卡片操作', text: '⋯' })]);
    menu.append(button('连接其他 Q/A', this.safe(() => this.relationshipDialog(card.id))), button('添加到主题线', this.safe(() => this.membershipDialog([card.id]))),
      button('加入上下文托盘',this.safe(()=>this.addToTray([card.id]))),
      button(card.metadata.favorite ? '取消收藏' : '收藏', this.safe(async () => { await this.write('metadata', { cardId: card.id, favorite: !card.metadata.favorite, expectedRevision: card.metadata.revision ?? 0 }); })),
      button('编辑标题与备注', this.safe(() => this.openCard(card.id))));
    host.append(checkbox, open, tags, menu); return host;
  }
  tagModule(card) {
    const tags = button('', this.safe(() => this.tagDialog(card)), 'opc-card-tags', { 'aria-label': `编辑标签：${title(card)}` });
    for (const [label, value, key] of [['主题', card.metadata.topic || '未设置', 'topic'], ['类型', card.metadata.contentType || '未设置', 'type'], ['状态', card.metadata.organizationStatus || '未整理', 'state']]) tags.append(el('span', { class: `opc-tag-dimension opc-tag-${key}` }, [el('small', { text: label }), el('strong', { text: value })]));
    if (card.relationshipCount) tags.append(el('small', { text: `${card.relationshipCount} 条关系` }));
    if (card.metadata.favorite) tags.append(el('small', { text: '★ 收藏' }));
    tags.append(el('small',{text:`采纳：${card.metadata.adoptionStatus??'未判断'}`}));
    if (card.validity?.state !== 'ACTIVE') tags.append(el('small', { class: 'opc-invalid', text: card.validity?.state === 'PENDING' ? '待确认' : '已隐藏' }));
    return tags;
  }
  async tagDialog(card) {
    await this.flushMetadata();
    const data = await this.api('opcDetail', { projectId: this.projectId, cardId: card.id }), projectId = this.projectId;
    const dialog = document.querySelector('#edit-dialog'); dialog.replaceChildren();
    const draftKey = card.id + ':tags', draft = this.drafts.get(projectId, draftKey);
    let revision = draft?.baseRevision ?? data.metadata.revision ?? 0, queue = Promise.resolve(), error = revision !== (data.metadata.revision ?? 0);
    const status = el('p', { role: 'status', text: error ? '另一窗口已修改标签。草稿已恢复，请核对已保存内容后继续。' : draft ? '已恢复标签草稿' : '修改后自动保存' });
    const topic = el('input', { value: draft?.topic ?? data.metadata.topic, list: 'opc-topics', 'aria-label': '主题（可以新建）' });
    const topics = el('datalist', { id: 'opc-topics' }, (this.data.topics ?? []).map(t => el('option', { value: t })));
    const choose = (key, choices, empty = false) => { const control = el('select', { 'aria-label': key === 'contentType' ? '类型' : '整理状态' }, [...(empty ? [el('option', { value: '', text: '未设置' })] : []), ...choices.map(t => el('option', { value: t, text: t }))]); control.value = draft?.[key] ?? data.metadata[key]; return control; };
    const kind = choose('contentType', CARD_TYPES, true), state = choose('organizationStatus', ORGANIZATION_STATES);
    const values = () => ({ topic: topic.value, contentType: kind.value, organizationStatus: state.value });
    const remember = () => { this.drafts.set(projectId, draftKey, { ...values(), baseRevision: revision }); this.drafts.flush(); };
    topic.addEventListener('input', remember);
    const update = () => {
      const snapshot = values(); remember(); status.textContent = error ? '冲突草稿已保留，请读取最新内容并核对。' : '保存中…';
      queue = queue.then(async () => { if (error) return; const saved = await this.api('opcWrite', { projectId, action: 'metadata', cardId: card.id, ...snapshot, expectedRevision: revision }); revision = saved.revision;
        if (JSON.stringify(snapshot) === JSON.stringify(values())) { this.drafts.remove(projectId, draftKey); status.textContent = '已保存'; } else remember(); })
        .catch(e => { error = true; status.textContent = e.message + '；当前输入仍保留，请核对后重试。'; this.onError?.(e.message); });
    };
    for (const control of [topic, kind, state]) control.addEventListener('change', update);
    const close = button('完成', this.safe(async () => { if (this.drafts.get(projectId, draftKey) && !error) update(); close.disabled = true; await queue; close.disabled = false; if (!error) { dialog.close(); await this.load(); } }));
    dialog.oncancel = e => { e.preventDefault(); close.click(); };
    const form = el('form', { class: 'dialog-body' }, [el('h2', { text: '编辑卡片标签' }), el('label', { class: 'field' }, ['主题', topic]), topics, el('label', { class: 'field' }, ['类型', kind]), el('label', { class: 'field' }, ['整理状态', state]), status, close, button('保留已保存内容并关闭', this.safe(async () => { await queue; dialog.close(); await this.load(); }))]);
    form.append(el('details', {}, [el('summary', { text: '已保存的标签' }), el('p', { text: [data.metadata.topic || '主题未设置', data.metadata.contentType || '类型未设置', data.metadata.organizationStatus].join(' · ') })]),
      button('读取最新标签并保留草稿', this.safe(async () => { await queue; dialog.close(); await this.tagDialog(card); })),
      button('已核对，基于此保存版本继续', () => { revision = data.metadata.revision ?? 0; error = false; update(); }));
    form.addEventListener('submit', e => { e.preventDefault(); close.click(); }); dialog.append(form); dialog.showModal();
  }
  renderTimeline() {
    let prior;
    for (const c of this.data.cards) { const date = day(c.questionTime.value); if (date !== prior) { this.list.append(el('h2', { class: 'opc-date', text: date })); prior = date; } this.list.append(this.card(c)); }
  }
  renderCompare() {
    const selected = this.filters.timelineIds.length ? this.filters.timelineIds : this.data.timelines.filter(t => !t.hidden && !t.archived).map(t => t.id);
    const lanes = this.data.timelines.filter(t => selected.includes(t.id)).slice(0, 5);
    const width = 1800, { positions, min, max } = comparePositions(this.data.cards, width, this.data.timeRange);
    const scroll = el('div', { class: 'opc-compare-scroll', tabindex: 0, 'aria-label': '多线共享提问时间坐标，可横向滚动' });
    const axis = el('div', { class: 'opc-time-axis', style: `width:${width}px` });
    if (positions.size) for (let i = 0; i <= 5; i++) { const value = min + (max - min) * i / 5; axis.append(el('time', { style: `left:${40 + (width - 340) * i / 5}px`, text: new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) })); }
    scroll.append(axis);
    for (const lane of lanes) {
      const ids = new Set(this.data.memberships.filter(m => m.timelineId === lane.id).map(m => m.cardId));
      const cards = this.data.cards.filter(c => ids.has(c.id));
      scroll.append(el('h3', { class: 'opc-lane-title', text: lane.name }));
      const plot = el('div', { class: 'opc-lane', style: `width:${width}px` }), ends = [];
      for (const c of cards.filter(c => positions.has(c.id))) {
        const x = positions.get(c.id); let row = ends.findIndex(end => end + 12 < x); if (row < 0) row = ends.length; ends[row] = x + 285;
        const node = this.card(c); node.style.left = `${x}px`; node.style.top = `${row * 300}px`; plot.append(node);
      }
      plot.style.height = `${Math.max(1, ends.length) * 300}px`; scroll.append(plot);
      const unknown = cards.filter(c => !positions.has(c.id)); if (unknown.length) scroll.append(el('div', { class: 'opc-unknown' }, [el('h4', { text: '时间未知 · 未放入时间坐标' }), ...unknown.map(c => this.card(c))]));
    }
    this.list.append(el('p', { class: 'muted', text: '共享所选范围的连续时间坐标，翻页保持坐标不变。上下叠放避免卡片重叠，当前页摘要按需显示；未知时间单列。' }), scroll);
  }
  async openCard(cardId) {
    await this.flushMetadata();
    this.drafts.flush();
    const epoch = ++this.detailEpoch; this.selected = cardId; this.detail.hidden = false;
    for (const node of this.list.querySelectorAll('[data-card-id]')) node.classList.toggle('selected', node.dataset.cardId === cardId);
    this.detail.replaceChildren(el('p', { text: '读取完整问答…' }));
    const data = await this.api('opcDetail', { projectId: this.projectId, cardId }); if (epoch !== this.detailEpoch) return;
    const relatedIds = new Set(data.relatedCards.map(c => c.id));
    for (const node of this.list.querySelectorAll('[data-card-id]')) node.classList.toggle('related', relatedIds.has(node.dataset.cardId));
    this.detail.replaceChildren();
    this.detail.append(button('收起详情', () => { ++this.detailEpoch; this.selected = null; this.detail.hidden = true;this.list.querySelectorAll('.selected').forEach(node=>node.classList.remove('selected')); },'btn close-detail'), el('h2', { text: data.metadata.title || data.card.questionPreview }),
      el('p', { class: 'muted', text: `${data.card.sourceTitle} · ${timeLabel(data.card.questionTime)}` }));
    const actions = el('div', { class: 'actions' }, [button('建立关系', () => { this.relationSource = cardId; this.render(); this.safe(() => this.openCard(cardId))(); }), button('搜索关系目标', this.safe(() => this.relationshipDialog(cardId))), button('添加到主题线', this.safe(() => this.membershipDialog([cardId])))]);
    const readingBody=el('div',{class:'opc-reading-body'},[el('h3',{text:'Q · 原始用户提问'}),richBody(data.questionBody || data.question?.text || '问题正文未取得或提问尚未完成', data.question?.presentation),el('h3',{text:'A · 历史 AI 最终回答'})]);
    this.detail.append(actions,el('article',{class:'opc-reading-card'},[readingBody,this.tagModule({...data.card,metadata:data.metadata,relationshipCount:data.relationships.length})]));
    actions.append(button('加入上下文托盘',this.safe(()=>this.addToTray([cardId]))),button('构建上下文',this.safe(async()=>{await this.addToTray([cardId]);await this.navigate('deploy');})),button('在时间线定位',this.safe(()=>this.navigate('timeline',cardId))),button('在画布定位',this.safe(()=>this.navigate('canvas',cardId))));
    actions.append(copyBodyButton(data.questionBody, '复制问题', this.onError), copyBodyButton(data.answerBody, '复制回答', this.onError));
    if (data.card.sourceUrl) actions.append(button('定位来源对话 ↗', () => openSource(data.card.sourceUrl)));
    const secondary=el('details',{class:'reading-menu'},[el('summary',{text:'更多操作'})]);for(const child of [...actions.children])if(!['建立关系','加入上下文托盘'].includes(child.textContent))secondary.append(child);actions.append(secondary);
    if (!data.answers.length) readingBody.append(el('p', { text: data.card.status === 'generating' ? '回答尚未完成，请稍后同步。' : '尚无可读回答。' }));
    if (data.answers.length) readingBody.append(richBody(data.answerBody, { format: 'markdown' }, this.onError));
    for (const diagnostic of data.diagnostics ?? []) this.detail.append(el('p', { class: 'muted', text: diagnostic.reason }));
    const form = el('form', { class: 'opc-annotation' });
    const projectId = this.projectId, draft = this.drafts.get(projectId, cardId);
    let baseRevision = draft?.baseRevision ?? data.metadata.revision ?? 0;
    const name = el('input', { value: draft?.title ?? data.metadata.title, placeholder: '自定义标题', 'aria-label': '卡片标题' });
    const tags = el('input', { value: draft?.tags ?? data.metadata.tags.join('，'), placeholder: '用逗号分隔标签', 'aria-label': '标签' });
    const notes = el('textarea', { value: draft?.notes ?? data.metadata.notes, rows: 5, placeholder: '写下我的理解、质疑或实践反馈…', 'aria-label': '我的批注（用户）' });
    const status = el('p', { class: 'opc-draft-status', text: draft ? '已恢复未保存草稿' : '标注已保存' });
    const remember = () => { this.drafts.set(projectId, cardId, { title: name.value, tags: tags.value, notes: notes.value, baseRevision }); status.textContent = '未保存草稿 · 已在本地保留'; };
    let saving = Promise.resolve(), blocked = baseRevision !== (data.metadata.revision ?? 0);
    const persist = async () => {
      clearTimeout(this.metadataTimer);
      const snapshot = { title: name.value, tags: tags.value, notes: notes.value };
      remember(); this.drafts.flush();
      saving = saving.then(async () => {
        if (blocked) return;
        status.textContent = '保存中…';
        try {
          const saved = await this.api('opcWrite', { projectId, action: 'metadata', cardId, title: snapshot.title, tags: snapshot.tags.split(/[,，]/), notes: snapshot.notes, expectedRevision: baseRevision });
          baseRevision = saved.revision;
          if (name.value === snapshot.title && tags.value === snapshot.tags && notes.value === snapshot.notes) { this.drafts.remove(projectId, cardId); status.textContent = '已自动保存'; }
          else remember();
          for (const card of [...this.data.cards, ...(this.data.pinnedCards ?? [])]) if (card.id === cardId) card.metadata = saved;
          if (this.projectId === projectId) for (const node of this.list.querySelectorAll('[data-card-id]')) if (node.dataset.cardId === cardId) {
            const current = { ...data.card, metadata: saved, relationshipCount: data.relationships.length }; node.querySelector('.opc-card-tags')?.replaceWith(this.tagModule(current));
            const heading = node.querySelector('.opc-question h3'); if (heading) heading.textContent = title(current);
            const micro=node.querySelector('.ht-node-open h3');if(micro){micro.textContent=title(current).slice(0,120);micro.title=title(current);}this.horizontal.measureNodes();
          }
        } catch (e) { blocked = true; status.textContent = '保存未完成，草稿已保留：' + e.message; this.onError?.(e.message); }
      });
      await saving;
    };
    for (const input of [name, tags, notes]) input.addEventListener('input', () => { remember(); this.pendingMetadata = persist; clearTimeout(this.metadataTimer); this.metadataTimer = setTimeout(() => this.flushMetadata(), 500); });
    const save = el('button', { type: 'submit', class: 'btn primary', text: '保存标注' });
    form.append(el('h3', { text: '我的批注与元信息 · 用户编辑' }), name, tags, notes, status, save, button('读取最新已保存标注', this.safe(() => this.openCard(cardId))));
    const adoption=el('select',{'aria-label':'用户采纳状态'},ADOPTION_STATES.map(s=>el('option',{value:s,text:s})));adoption.value=data.metadata.adoptionStatus;
    adoption.addEventListener('change',this.safe(async()=>{await this.flushMetadata();const latest=await this.api('opcDetail',{projectId:this.projectId,cardId});await this.write('metadata',{cardId,adoptionStatus:adoption.value,expectedRevision:latest.metadata.revision??0});}));form.append(el('label',{class:'field'},['观点采纳状态（不同于整理／同步状态）',adoption]));
    if (baseRevision !== (data.metadata.revision ?? 0)) {
      form.append(el('p', { class: 'opc-conflict', text: '另一窗口已修改标注。您的草稿已保留，请核对已保存版本后继续编辑。' }),
        el('details', {}, [el('summary', { text: '当前已保存版本' }), el('p', { text: data.metadata.title }), el('p', { text: data.metadata.tags.join('，') }), el('pre', { text: data.metadata.notes })]),
        button('已核对，基于最新版本继续编辑', () => { baseRevision = data.metadata.revision ?? 0; blocked = false; remember(); this.pendingMetadata = persist; status.textContent = '已采用最新版本作为保存依据，您的草稿仍保留'; }));
    }
    form.addEventListener('submit', this.safe(async e => {
      e.preventDefault(); if (save.disabled) return; remember(); save.disabled = true;
      for (const control of [name, tags, notes]) control.disabled = true;
      try { this.pendingMetadata = persist; await this.flushMetadata(); if (!blocked) await this.load(); }
      finally { save.disabled = false; for (const control of [name, tags, notes]) control.disabled = false; }
    })); this.detail.append(form);this.reflection.mount(this.detail,data);
    this.detail.append(el('h3', { text: `关联节点 · ${data.relationships.length}` }));
    for (const r of data.relationships) {
      const target = r.fromCardId === cardId ? r.toCardId : r.fromCardId;
      const label = `${r.directed ? r.fromCardId === cardId ? '→' : '←' : '↔'} ${r.type} ${r.description ? '· ' + r.description : ''}`;
      const related = data.relatedCards?.find(c => c.id === target);
      this.detail.append(el('div', { class: 'opc-relation' }, [el('span', { text: related ? `${related.sourceTitle} · ${related.questionPreview}` : '关联卡片' }), button(label, this.safe(() => this.relationshipDialog(r.fromCardId, r.toCardId, r))), button('定位节点 ↗', this.safe(() => this.locate(target)))]));
    }
    if (this.mode === 'canvas' && data.relationships.length) this.detail.append(button('在画布展开关联节点', this.safe(async () => { this.filters.canvasCardIds = [...new Set([...(this.filters.canvasCardIds ?? []), ...data.relatedCards.map(c => c.id)])].slice(0, 40); await this.load(); this.fitCanvas(); })));
    const diagnostics = el('details', { class: 'opc-diagnostics' }, [el('summary', { text: '来源记录与排查' }), el('p', { text: `提问时间来源：${data.card.questionTime.source ?? '未知'}；精度：${data.card.questionTime.precision ?? 'unknown'}。导入时间：${data.card.importedAt}。原始消息及历史版本单独保留。` })]);
    diagnostics.append(button('读取原始记录', this.safe(async () => { const raw = await this.api('opcRaw', { projectId: this.projectId, cardId }); diagnostics.append(el('pre', { text: JSON.stringify(raw, null, 2) })); })));
    this.detail.append(diagnostics);
  }
  async flushMetadata() {
    clearTimeout(this.metadataTimer);
    const pending = this.pendingMetadata; this.pendingMetadata = null;
    if (pending) this.metadataWrite = (this.metadataWrite ?? Promise.resolve()).then(pending).catch(e => this.onError?.(e.message));
    await this.metadataWrite;
  }
  async locate(cardId) {
    Object.assign(this.filters, { query: '', date: '', tag: '', timelineIds: [], offset: 0, conversationId: '', contentType: '', organizationStatus: '', favorite: false, dateFrom: '', dateTo: '' });
    const data = await this.api('opcDetail', { projectId: this.projectId, cardId });
    // Include hidden source timelines when following an explicit reference.
    const member = this.data.memberships.find(m => m.cardId === cardId);
    const source = this.data.timelines.find(t => t.conversationId === data.card.conversationId);
    if(this.mode==='timeline'&&!this.legacyList){
      if(source&&!this.trackPreferences.selectedTimelineIds.includes(source.id)){this.trackPreferences.selectedTimelineIds.push(source.id);this.trackPreferences.trackOrder.push(source.id);this.horizontal.preferences=this.trackPreferences;await this.horizontal.save();}
      if(source)this.trackPreferences.collapsedTimelineIds=this.trackPreferences.collapsedTimelineIds.filter(k=>k!==source.id);
      this.filters.timelineIds=[];
    }else if (source) this.filters.timelineIds = [source.id]; else if (member) this.filters.timelineIds = [member.timelineId];
    // Exact card filter keeps navigation bounded even for very long histories.
    this.filters.cardId = null; this.filters.revealCardId = cardId; this.filters.includeHidden = true; this.selected = cardId; await this.load();
    if(this.mode==='timeline'&&!this.legacyList){this.horizontal.locate(cardId);return;}
    if (this.mode === 'canvas' && this.canvasNodes?.has(cardId)) {
      const p = this.positions[cardId]; this.viewport.x = this.canvas.clientWidth / 2 - (p.x + 135) * this.viewport.zoom; this.viewport.y = this.canvas.clientHeight / 2 - (p.y + 115) * this.viewport.zoom; this.applyViewport(); this.scheduleLayout([], true);
    }
    const node = [...this.list.querySelectorAll('[data-card-id]')].find(n => n.dataset.cardId === cardId); node?.scrollIntoView?.({ block: 'center' });
  }
  async membershipDialog(cardIds) {
    if (!cardIds.length) throw new Error('请先选择卡片。');
    const themes = this.data.timelines.filter(t => t.kind === 'theme' && !t.archived);
    if (!themes.length) throw new Error('请先新建主题时间线。');
    const v = await ask(`添加 ${cardIds.length} 张卡片`, [{ name: 'timelineId', label: '主题时间线', options: themes.map(t => ({ value: t.id, label: t.name })) }]);
    if (v) await this.write('membership', { timelineId: v.timelineId, cardIds });
  }
  async manageTimelines() {
    const dialog = document.querySelector('#edit-dialog'); dialog.replaceChildren(el('h2', { text: '管理时间线' }));
    const operations = new Set();
    const done = button('完成', this.safe(async () => {
      const controls = [...dialog.querySelectorAll('button,input')], disabled = controls.map(c => c.disabled); controls.forEach(c => c.disabled = true);
      const results = await Promise.allSettled([...operations]);
      if (results.some(r => r.status === 'rejected')) controls.forEach((c, i) => c.disabled = disabled[i]); else dialog.close();
    })); dialog.append(done);
    dialog.addEventListener('cancel', e => { if (operations.size) { e.preventDefault(); done.click(); } }, { once: true });
    for (const t of this.data.timelines) {
      const row = el('div', { class: 'opc-manage-row' }), name = el('input', { value: t.name, disabled: t.kind === 'source', 'aria-label': '时间线名称' });
      let queue = Promise.resolve();
      const update = values => { queue = queue.catch(() => {}).then(async () => { const result = await this.write('timeline', { timelineId: t.id, expectedRevision: t.revision ?? 0, ...values }, { reload: false }); Object.assign(t, result); }); const operation = queue; operations.add(operation); operation.then(() => operations.delete(operation), () => operations.delete(operation)); return operation; };
      row.append(name, badge(t.kind === 'source' ? '来源' : '主题'));
      if (t.kind === 'theme') row.append(button('重命名', this.safe(() => update({ name: name.value }))));
      for (const [key, label] of [['hidden', '隐藏'], ['archived', '归档']]) { const control = el('input', { type: 'checkbox', checked: t[key] }); control.addEventListener('change', this.safe(() => update({ [key]: control.checked }))); row.append(el('label', {}, [control, label])); }
      dialog.append(row);
    }
    dialog.addEventListener('close', this.safe(() => this.load()), { once: true }); dialog.showModal();
  }
  async relationshipDialog(fromCardId, toCardId = null, relationship = null) {
    const dialog = document.querySelector('#edit-dialog'); dialog.oncancel = null; dialog.replaceChildren();
    const form = el('form', { class: 'dialog-body' }); form.append(el('h2', { text: relationship ? '编辑关系' : '建立关系' }));
    const sourceDetail = await this.api('opcDetail', { projectId: this.projectId, cardId: fromCardId });
    form.append(el('p', { text: `来源：${sourceDetail.metadata.title || sourceDetail.card.questionPreview}` }), button('跳转来源 Q/A', this.safe(async () => { dialog.close(); await this.locate(fromCardId); })));
    const search = el('input', { type: 'search', placeholder: '搜索其他 Q/A（所有来源）', 'aria-label': '搜索关系目标' });
    const targets = el('select', { size: 6, required: true, 'aria-label': '关系目标卡片' });
    let epoch = 0, offset = 0, query = '', next = null;
    const update = async append => {
      const token = ++epoch;
      const data = await this.api('opcPage', { projectId: this.projectId, query, allCards: true, offset, limit: 60 }); if (token !== epoch || !dialog.open) return;
      if (!append) targets.replaceChildren();
      for (const c of data.cards.filter(c => c.id !== fromCardId)) if (![...targets.options].some(o => o.value === c.id)) targets.append(el('option', { value: c.id, text: `${c.sourceTitle} · ${title(c)}` }));
      next = data.nextOffset; more.hidden = next == null; if (toCardId) targets.value = toCardId;
    };
    const more = button('更多目标', this.safe(async () => { if (next != null) { offset = next; await update(true); } }));
    let timer; search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(this.safe(async () => { query = search.value; offset = 0; await update(false); }), 250); });
    const type = el('input', { value: relationship?.type ?? '主题相关', list: 'opc-relation-types', required: true, 'aria-label': '关系类型（可输入自定义类型）' });
    const types = el('datalist', { id: 'opc-relation-types' }, this.data.relationTypes.map(t => el('option', { value: t })));
    const direction = el('select', { 'aria-label': '方向' }, [{ value: 'forward', text: '来源 → 目标' }, { value: 'reverse', text: '目标 → 来源' }, { value: 'both', text: '无向关系 ↔' }].map(o => el('option', o))); direction.value = relationship?.directed === false ? 'both' : 'forward';
    const description = el('textarea', { rows: 3, value: relationship?.description ?? '', placeholder: '关系说明（可选）', 'aria-label': '关系说明' });
    form.append(search, targets, more, el('label', { class: 'field' }, ['关系类型', type]), types, direction, description,
      el('button', { type: 'submit', class: 'btn primary', text: '保存关系' }), button('取消', () => dialog.close()));
    form.append(button('跳转目标 Q/A', this.safe(async () => { if (targets.value) { dialog.close(); await this.locate(targets.value); } })));
    if (relationship) form.append(button('删除关系', this.safe(async () => { await this.write('relationship', { relationshipId: relationship.id, expectedRevision: relationship.revision ?? 0, remove: true }, { reload: false }); dialog.close(); await this.load(); }), 'btn danger'));
    form.addEventListener('submit', this.safe(async e => {
      e.preventDefault(); if (!targets.value) throw new Error('请选择目标卡片。');
      await this.write('relationship', { relationshipId: relationship?.id, expectedRevision: relationship?.revision ?? 0, fromCardId: direction.value === 'reverse' ? targets.value : fromCardId,
        toCardId: direction.value === 'reverse' ? fromCardId : targets.value, type: type.value, directed: direction.value !== 'both', description: description.value }, { reload: false });
      dialog.close(); this.relationSource = null; await this.load();
    }));
    dialog.append(form); dialog.showModal();
    if (toCardId) { const detail = await this.api('opcDetail', { projectId: this.projectId, cardId: toCardId }); targets.append(el('option', { value: toCardId, text: detail.card.sourceTitle + ' · ' + (detail.metadata.title || detail.card.questionPreview) })); targets.value = toCardId; }
    await update(false);
    if (toCardId && ![...targets.options].some(o => o.value === toCardId)) { const detail = await this.api('opcDetail', { projectId: this.projectId, cardId: toCardId }); targets.append(el('option', { value: toCardId, text: detail.card.questionPreview })); targets.value = toCardId; }
  }
  renderCanvas() {
    const tools = el('div', { class: 'canvas-controls' }, [button('放大', () => this.zoom(1.2)), button('缩小', () => this.zoom(1 / 1.2)), button('自动整理', () => {
      this.canvasCards.forEach((c, i) => this.positions[c.id] = { x: i % 4 * 320, y: Math.floor(i / 4) * 270 }); this.viewport = { x: 20, y: 20, zoom: 1 }; this.drawCanvas(); this.scheduleLayout(this.canvasCards.map(c => c.id), true);
    }), button('适配节点', () => this.fitCanvas()), button('100%', () => this.zoom(1 / this.viewport.zoom)), button('居中选中', () => this.centerCanvasCard()), button('收起跨页关联节点', this.safe(async () => { this.filters.canvasCardIds = []; await this.load(); }))]);
    this.canvas = el('div', { class: 'opc-canvas', tabindex: 0, 'aria-label': '关系画布；拖动卡片，拖动背景平移，滚轮缩放' });
    this.world = el('div', { class: 'opc-world' }); this.canvas.append(this.world);
    this.canvasStatus=el('small',{class:'canvas-status',text:'拖动背景平移 · 拖动锚点连线 · 滚轮缩放'});tools.append(this.canvasStatus);this.list.append(tools,this.canvas);
    this.canvas.style.height=`${Math.max(320,document.documentElement.clientHeight-Math.max(120,this.canvas.getBoundingClientRect().top)-36)}px`;
    const addedPositions=[],occupied = Object.values(this.positions), columns=Math.max(2,Math.ceil(Math.sqrt(this.canvasCards.length*this.canvas.clientWidth/Math.max(1,this.canvas.clientHeight)))); let slot = 0;
    for (const c of this.canvasCards) if (!this.positions[c.id]) {
      let p;
      do { p = { x: slot % columns * 320, y: Math.floor(slot++ / columns) * 270 }; } while (occupied.some(other => Math.abs(other.x - p.x) < 290 && Math.abs(other.y - p.y) < 250));
      this.positions[c.id] = p; occupied.push(p);addedPositions.push(c.id);
    }
    this.drawCanvas();if(addedPositions.length)this.scheduleLayout(addedPositions);
    const points=this.canvasCards.map(c=>this.positions[c.id]);
    if(!this.data.layout?.viewport||!visibleNodeViewport(points,this.viewport,this.canvas.clientWidth,this.canvas.clientHeight)){this.fitCanvas();if(this.viewport.zoom<.55){this.centerCanvasCard();this.canvasStatus.textContent='已聚焦首张卡片；点“适配节点”查看全貌。';}}
    this.canvas.addEventListener('wheel', e => { e.preventDefault(); const rect = this.canvas.getBoundingClientRect(); this.zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top); }, { passive: false });
    this.canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('.opc-canvas-node') || e.target.closest('.opc-edge')) return;
      const start = { x: e.clientX, y: e.clientY, vx: this.viewport.x, vy: this.viewport.y }; this.canvas.setPointerCapture(e.pointerId);
      const move = e => { this.viewport.x = start.vx + e.clientX - start.x; this.viewport.y = start.vy + e.clientY - start.y; this.applyViewport(); };
      const canvas = this.canvas;
      const stop = () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', stop); canvas.removeEventListener('pointercancel', stop); this.scheduleLayout([], true); };
      canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop);
    });
  }
  canvasCard(card){
    const node=el('article',{class:'opc-canvas-node opc-compact-node','data-card-id':card.id,tabindex:0}),name=title(card),display=name.length>60?name.slice(0,60)+'…':name;
    const header=button('',this.safe(async()=>{if(this.relationSource&&this.relationSource!==card.id)await this.relationshipDialog(this.relationSource,card.id);else await this.openCard(card.id);}),'compact-node-open');
    header.append(el('h3',{text:display,title:name}),el('p',{text:'Q 预览 · '+card.questionPreview.slice(0,45)}),el('p',{text:'A 预览 · '+card.answerPreview.slice(0,45)}));
    const selected=el('input',{type:'checkbox',checked:this.checked.has(card.id),'aria-label':`选择 ${name}`});selected.addEventListener('change',()=>{if(selected.checked)this.checked.add(card.id);else this.checked.delete(card.id);this.bulkCount.textContent=`已选 ${this.checked.size} 张`;});
    const tags=button(card.metadata.topic?card.metadata.topic.slice(0,18):'编辑标签',this.safe(()=>this.tagDialog(card)),'opc-card-tags compact-meta',{title:card.metadata.topic,'aria-label':`编辑标签：${name}`});
    const footer=el('div',{class:'compact-node-footer'},[tags,el('small',{text:card.relationshipCount?`${card.relationshipCount} 条关系`:''}),button('＋ 上下文',this.safe(()=>this.addToTray([card.id])),'btn')]);
    node.append(header,footer,selected);return node;
  }
  drawCanvas() {
    this.world.replaceChildren(); this.canvasNodes = new Map();
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); this.svg.classList.add('opc-lines');
    this.svg.setAttribute('width', '1'); this.svg.setAttribute('height', '1');
    const defs = document.createElementNS(this.svg.namespaceURI, 'defs'), marker = document.createElementNS(this.svg.namespaceURI, 'marker'), arrow = document.createElementNS(this.svg.namespaceURI, 'path');
    marker.setAttribute('id', 'opc-arrow'); marker.setAttribute('viewBox', '0 0 10 10'); marker.setAttribute('refX', '9'); marker.setAttribute('refY', '5'); marker.setAttribute('markerWidth', '7'); marker.setAttribute('markerHeight', '7'); marker.setAttribute('orient', 'auto'); arrow.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z'); marker.append(arrow); defs.append(marker); this.svg.append(defs); this.world.append(this.svg);
    for (const card of this.canvasCards) {
      const node = this.canvasCard(card);
      const anchor = button('＋', this.safe(() => this.relationshipDialog(card.id)), 'opc-connect-anchor', { 'aria-label': `连接 ${title(card)}（拖至目标卡片或按 Enter）` });
      node.append(anchor);
      anchor.addEventListener('pointerdown', e => {
        if (e.button !== 0) return; e.stopPropagation(); anchor.setPointerCapture(e.pointerId);
        const preview = document.createElementNS(this.svg.namespaceURI, 'path'); preview.classList.add('opc-connection-preview'); this.svg.append(preview);
        let moved = false; const start = this.positions[card.id];
        const move = e => { moved = true; const rect = this.canvas.getBoundingClientRect(), x = (e.clientX - rect.left - this.viewport.x) / this.viewport.zoom, y = (e.clientY - rect.top - this.viewport.y) / this.viewport.zoom; preview.setAttribute('d', `M ${start.x + 270} ${start.y + 115} L ${x} ${y}`); };
        const stop = this.safe(async e => {
          anchor.removeEventListener('pointermove', move); anchor.removeEventListener('pointerup', stop); anchor.removeEventListener('pointercancel', stop); preview.remove();
          if (!moved || e.type === 'pointercancel') return;
          anchor.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); }, { capture: true, once: true });
          const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.opc-canvas-node')?.dataset.cardId;
          if (target && target !== card.id) await this.relationshipDialog(card.id, target);
        });
        anchor.addEventListener('pointermove', move); anchor.addEventListener('pointerup', stop); anchor.addEventListener('pointercancel', stop);
      });
      this.world.append(node); this.canvasNodes.set(card.id, node); this.moveNode(card.id);
      node.addEventListener('keydown', this.safe(async e => { if (e.target === node && e.key === 'Enter') await this.openCard(card.id); }));
      node.addEventListener('pointerdown', e => {
        e.stopPropagation(); if (e.button !== 0 || e.target.closest('.opc-card-tags,.opc-card-menu,.opc-connect-anchor,input')) return;
        const start = { x: e.clientX, y: e.clientY, ...this.positions[card.id] }, initial = { ...this.positions[card.id] }; start.clientX = e.clientX; start.clientY = e.clientY;
        let moved = false; node.setPointerCapture(e.pointerId);
        const move = e => { const dx = (e.clientX - start.clientX) / this.viewport.zoom, dy = (e.clientY - start.clientY) / this.viewport.zoom; if (Math.abs(dx) + Math.abs(dy) > 4) moved = true; this.positions[card.id] = { x: initial.x + dx, y: initial.y + dy }; this.moveNode(card.id); this.scheduleEdges(card.id); };
        const stop = this.safe(async e => { node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', stop); node.removeEventListener('pointercancel', stop); if (moved) { this.scheduleLayout([card.id]); node.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); }, { capture: true, once: true }); } });
        node.addEventListener('pointermove', move); node.addEventListener('pointerup', stop); node.addEventListener('pointercancel', stop);
      });
    }
    this.applyViewport(); this.drawEdges();
  }
  moveNode(key) { const p = this.positions[key]; this.canvasNodes.get(key).style.transform = `translate(${p.x}px,${p.y}px)`; }
  drawEdges() {
    this.edgeElements = new Map(); this.edgesByCard = new Map();
    const pairs = new Map(); this.edgeOffsets = new Map();
    for (const r of this.data.relationships) { const key = [r.fromCardId, r.toCardId].sort().join('\u0000'); const group = pairs.get(key) ?? []; group.push(r); pairs.set(key, group); }
    for (const group of pairs.values()) group.forEach((r, i) => this.edgeOffsets.set(r.id, (i - (group.length - 1) / 2) * 48 * (r.fromCardId < r.toCardId ? 1 : -1)));
    for (const node of [...this.svg.children]) if (node.tagName.toLowerCase() !== 'defs') node.remove();
    for (const r of this.data.relationships) {
      if (!this.canvasNodes.has(r.fromCardId) || !this.canvasNodes.has(r.toCardId)) continue;
      const group = document.createElementNS(this.svg.namespaceURI, 'g'); group.classList.add('opc-edge'); group.setAttribute('tabindex', '0'); group.setAttribute('role', 'button'); group.setAttribute('aria-label', `编辑${r.type}关系`);
      const path = document.createElementNS(this.svg.namespaceURI, 'path'); if (r.directed) path.setAttribute('marker-end', 'url(#opc-arrow)');
      const text = document.createElementNS(this.svg.namespaceURI, 'text'); text.textContent = r.type;
      this.edgeElements.set(r.id, { relationship: r, path, text });
      for (const key of [r.fromCardId, r.toCardId]) { if (!this.edgesByCard.has(key)) this.edgesByCard.set(key, new Set()); this.edgesByCard.get(key).add(r.id); }
      this.updateEdge(r.id);
      group.append(path, text); group.addEventListener('click', this.safe(() => this.relationshipDialog(r.fromCardId, r.toCardId, r))); group.addEventListener('keydown', this.safe(e => e.key === 'Enter' && this.relationshipDialog(r.fromCardId, r.toCardId, r))); this.svg.append(group);
    }
  }
  updateEdge(id) {
    const edge = this.edgeElements?.get(id); if (!edge) return;
    const geometry = canvasEdge(this.positions[edge.relationship.fromCardId], this.positions[edge.relationship.toCardId], 270, 230, this.edgeOffsets.get(id));
    edge.path.setAttribute('d', geometry.path); edge.text.setAttribute('x', geometry.label.x); edge.text.setAttribute('y', geometry.label.y);
  }
  scheduleEdges(cardId) {
    this.pendingEdges ??= new Set(); for (const key of this.edgesByCard.get(cardId) ?? []) this.pendingEdges.add(key);
    if (this.edgeFrame != null) return;
    this.edgeFrame = requestAnimationFrame(() => { this.edgeFrame = null; for (const id of this.pendingEdges) this.updateEdge(id); this.pendingEdges.clear(); });
  }
  applyViewport() { this.world.style.transform = `translate(${this.viewport.x}px,${this.viewport.y}px) scale(${this.viewport.zoom})`; }
  zoom(factor, x = this.canvas.clientWidth / 2, y = this.canvas.clientHeight / 2) {
    const old = this.viewport.zoom, zoom = Math.max(.05, Math.min(3, old * factor));
    this.viewport.x = x - (x - this.viewport.x) * zoom / old; this.viewport.y = y - (y - this.viewport.y) * zoom / old; this.viewport.zoom = zoom; this.applyViewport(); this.scheduleLayout([], true);
  }
  centerCanvasCard() {
    const key=this.selected&&this.positions[this.selected]?this.selected:this.canvasCards[0]?.id,p=this.positions[key];if(!p)return;
    this.viewport={x:this.canvas.clientWidth/2-(p.x+135),y:this.canvas.clientHeight/2-(p.y+115),zoom:1};this.applyViewport();this.scheduleLayout([],true);
    this.canvasStatus.textContent='100% · 已居中卡片';
  }
  fitCanvas() {
    const points=this.canvasCards.map(c=>this.positions[c.id]);if(!points.length)return;
    this.viewport=fitNodeViewport(points,this.canvas.clientWidth,this.canvas.clientHeight);
    this.applyViewport();this.scheduleLayout([],true);
    this.canvasStatus.textContent=this.viewport.zoom<.6?'全部节点已适配；标题较小时可点“居中选中”以 100% 阅读。':'已适配全部节点';
  }
  scheduleLayout(cardIds = [], viewportChanged = false) {
    clearTimeout(this.layoutTimer);
    const positions = { ...(this.pendingLayout?.positions ?? {}) };
    for (const key of cardIds) positions[key] = { ...this.positions[key] };
    this.pendingLayout = { projectId: this.projectId, action: 'layout', positions,
      ...(this.pendingLayout?.viewport || viewportChanged ? { viewport: { ...this.viewport } } : {}) };
    this.layoutTimer = setTimeout(() => this.flushLayout(), 250);
  }
  async flushLayout() {
    this.drafts.flush();
    clearTimeout(this.layoutTimer); const pending = this.pendingLayout; this.pendingLayout = null;
    if (pending) this.layoutWrite = (this.layoutWrite ?? Promise.resolve()).then(async () => {
      const expectedPositions = Object.fromEntries(Object.keys(pending.positions).map(key => [key, this.savedPositions?.[key] ?? null]));
      const result = await this.api('opcWrite', { ...pending, expectedPositions, ...(pending.viewport ? { expectedViewport: this.savedViewport } : {}) });
      for (const key of Object.keys(pending.positions)) this.savedPositions[key] = { ...result.positions[key] };
      if (pending.viewport) this.savedViewport = { ...result.viewport };
    }).catch(e => { this.onError?.(`画布保存失败，本次移动未覆盖已有位置：${e.message}`); });
    await this.layoutWrite;
  }
  destroy() { ++this.epoch; ++this.detailEpoch; if (this.edgeFrame != null) cancelAnimationFrame(this.edgeFrame); this.edgeFrame = null; this.pendingEdges?.clear(); this.flushMetadata(); this.flushLayout();this.deploy.flush();this.horizontal.flush(); this.host.replaceChildren(); }
}
