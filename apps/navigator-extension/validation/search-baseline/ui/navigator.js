import { el, button, badge, timeLabel, labelStatus } from './dom.js';
import { conversationOverview, topicGroups, qaNavigation } from '../domain/navigation.js';

export class ProjectNavigator {
  constructor(host, { onSegment, onConversation, onQA, onReset }) {
    this.host = host; this.onSegment = onSegment; this.onConversation = onConversation; this.onQA = onQA; this.onReset = onReset;
    this.limit = 60; this.topicState = new Map();
  }
  render(segments, view, selectedId, options = {}) {
    const scope = `${view.project?.id}:${options.mode}:${options.segmentId ?? ''}:${segments.map(row => row.id).join('|')}`;
    if (scope !== this.scope) { this.limit = 60; }
    this.scope = scope; this.segments = segments; this.view = view; this.options = options; this.selectedId = selectedId;
    this.host.replaceChildren(); this.host.dataset.view = options.mode ?? 'qas';
    if (!view.conversations?.length) return this.empty('从一条真实对话开始', '在 ChatGPT 页面采集，或导入已有对话。保存后就能从项目走进每一轮问答。');
    if (options.mode === 'overview') return this.overview();
    if (!segments.length && !options.contentFiltered && view.conversations.some(conversation => (!options.conversationId || conversation.id === options.conversationId) && !view.qas.some(qa => qa.conversationId === conversation.id))) return this.overview();
    if (!segments.length) return this.empty('这个筛选范围没有片段', '可以清除筛选，或选择其他对话和阅读路径。', true);
    if (options.mode === 'topics') return this.topics();
    if (options.mode === 'qas') return this.qas();
    return this.qas();
  }
  empty(title, description, reset = false) {
    this.host.append(el('div', { class: 'empty map-empty' }, [el('div', { class: 'empty-orbit', text: '◇', 'aria-hidden': 'true' }), el('h3', { text: title }), el('p', { text: description }), reset ? button('清除地图筛选', this.onReset, 'btn') : null]));
  }
  overview() {
    const topics = new Map(this.view.topics.map(row => [row.id, row]));
    const rows = conversationOverview(this.view, this.segments);
    const scoped = this.options.conversationId ? rows.filter(row => row.conversation.id === this.options.conversationId) : rows;
    const filtered = this.options.contentFiltered ? scoped.filter(row => row.segments.length) : scoped;
    if (!filtered.length) return this.empty('没有符合筛选的对话', '清除主题或状态筛选后，查看项目中的全部对话。', true);
    const grid = el('div', { class: 'overview-grid' });
    for (const row of filtered.slice(0, this.limit)) {
      const card = button('', () => this.onConversation(row.conversation.id), 'overview-card'); card.dataset.conversationId = row.conversation.id;
      card.style.setProperty('--topic-color', topics.get(row.topicIds[0])?.color ?? '#6274e8');
      card.append(el('div', { class: 'overview-card-top' }, [el('span', { class: 'conversation-symbol', text: '↗', 'aria-hidden': 'true' }), badge(['chatgpt', 'openai-chatgpt'].includes(row.conversation.platform) ? 'ChatGPT' : '已导入')]),
        el('h3', { text: row.conversation.title }), el('p', { class: 'overview-description', text: row.segments[0]?.title ?? '已保存正文，尚未确认问答轮次；点击阅读完整原文。' }),
        el('div', { class: 'tags' }, row.topicIds.length ? row.topicIds.slice(0, 3).map(id => badge(topics.get(id)?.name ?? '未知主题')) : [badge('未分类')]),
        el('div', { class: 'overview-metrics' }, [el('span', { text: `${row.qaCount} 轮问答` }), el('span', { text: `${row.segments.length} 个片段` }), row.reviewCount ? badge(`${row.reviewCount} 段需复核`, 'warning') : null]),
        el('div', { class: 'overview-card-footer' }, [el('span', { text: row.conversation.sourceTime?.value ? timeLabel(row.conversation.sourceTime) : '来源时间未知' }), el('strong', { text: '进入对话 →' })]));
      grid.append(card);
    }
    this.host.append(grid); this.more(filtered.length);
  }
  segmentRow(segment) {
    const conversation = this.view.conversations.find(row => row.id === segment.conversationId);
    const row = button('', () => this.onSegment(segment), `topic-segment ${segment.id === this.selectedId ? 'selected' : ''}`);
    row.dataset.segmentId = segment.id; row.setAttribute('aria-pressed', String(segment.id === this.selectedId));
    row.append(el('span', { class: 'tree-branch', text: '└', 'aria-hidden': 'true' }), el('span', { class: 'topic-segment-copy' }, [el('strong', { text: segment.title }), el('small', { text: conversation?.title ?? '未知对话' })]), badge(`${segment.qaIds.length} 轮`), el('span', { class: 'row-arrow', text: '↗', 'aria-hidden': 'true' }));
    return row;
  }
  topics() {
    this.host.append(el('p', { class: 'view-explanation', text: '按主题展开真实片段。多主题片段可在不同分组出现，原文只保存一份。' }));
    const groups = topicGroups(this.view, this.segments);
    for (const [index, group] of groups.entries()) {
      const key = `${this.view.project.id}:${group.id}`;
      const detail = el('details', { class: 'topic-tree', open: this.topicState.has(key) ? this.topicState.get(key) : index === 0 });
      detail.style.setProperty('--topic-color', group.color);
      detail.append(el('summary', {}, [el('span', { class: 'color-dot' }), el('strong', { text: group.name }), el('span', { text: `${group.segments.length} 个片段 · ${group.qaCount} 轮` })]));
      let mounted = false;
      const mount = () => {
        if (!detail.open || mounted) return; mounted = true;
        const list = el('div', { class: 'topic-tree-members' }); let limit = 0;
        const append = () => {
          list.querySelector('.load-more')?.remove();
          const next = Math.min(limit + 40, group.segments.length);
          for (const segment of group.segments.slice(limit, next)) list.append(this.segmentRow(segment));
          limit = next;
          if (limit < group.segments.length) list.append(button(`继续展开（${limit} / ${group.segments.length}）`, append, 'btn load-more'));
        }; append(); detail.append(list);
      };
      detail.addEventListener('toggle', () => { this.topicState.set(key, detail.open); mount(); });
      mount(); this.host.append(detail);
    }
  }
  qas() {
    const rows = qaNavigation(this.view, this.segments, this.options.segmentId);
    if (!rows.length) return this.empty('这个片段已变化', '返回讨论地图，按当前成员重新选择。', true);
    const list = el('div', { class: 'qa-map-list' });
    const conversations = new Map(this.view.conversations.map(row => [row.id, row]));
    for (const { qa, segment } of rows.slice(0, this.limit)) {
      const row = button('', () => this.onQA(qa, segment), `qa-map-row ${qa.id === this.options.qaId ? 'selected' : ''}`);
      row.dataset.qaId = qa.id; row.dataset.segmentId = segment.id; row.setAttribute('aria-pressed', String(qa.id === this.options.qaId));
      row.append(el('span', { class: 'qa-map-number', text: String(qa.ordinal).padStart(2, '0') }), el('span', { class: 'qa-map-copy' }, [el('strong', { text: qa.preview }), el('small', { text: `${conversations.get(qa.conversationId)?.title ?? '未知对话'} · ${segment.title}` })]),
        badge(labelStatus(qa.status), qa.status === 'answered' ? 'good' : 'warning'), el('span', { class: 'row-arrow', text: '↗', 'aria-hidden': 'true' })); list.append(row);
    }
    this.host.append(list); this.more(rows.length);
  }
  more(total) {
    if (total <= this.limit) return;
    this.host.append(button(`继续加载（${this.limit} / ${total}）`, () => { this.limit += 60; this.render(this.segments, this.view, this.selectedId, this.options); }, 'btn load-more'));
  }
  select(segmentId, reveal = false, qaId = null) {
    this.selectedId = segmentId; this.options = { ...this.options, qaId };
    if (this.options.mode === 'qas') {
      const rows = qaNavigation(this.view, this.segments, this.options.segmentId), index = rows.findIndex(row => row.qa.id === qaId);
      if (index >= this.limit) { this.limit = Math.ceil((index + 1) / 60) * 60; this.render(this.segments, this.view, segmentId, this.options); }
    }
    for (const row of this.host.querySelectorAll('[data-segment-id]')) {
      const selected = this.options.mode === 'qas' ? row.dataset.qaId === qaId : row.dataset.segmentId === segmentId;
      row.classList.toggle('selected', selected); row.setAttribute('aria-pressed', String(selected));
      if (selected && reveal) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}
