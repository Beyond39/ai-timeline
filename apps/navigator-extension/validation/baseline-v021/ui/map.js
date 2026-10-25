import { el, button, badge, timeLabel } from './dom.js';
export class SnakeMap {
  constructor(host, onSelect) { this.host = host; this.onSelect = onSelect; this.limit = 60; this.observer = new ResizeObserver(() => this.layout()); this.observer.observe(host); }
  render(segments, view, selectedId) {
    this.segments = segments; this.view = view; this.selectedId = selectedId;
    this.host.replaceChildren(); this.grid = el('div', { class: 'map-grid' });
    const byConversation = new Map(view.conversations.map(c => [c.id, c])); const topics = new Map(view.topics.map(t => [t.id, t]));
    segments.slice(0, this.limit).forEach((segment, index) => {
      const color = topics.get(segment.topicIds[0])?.color ?? '#64748b';
      const node = button('', () => this.onSelect(segment), `map-node ${segment.id === selectedId ? 'selected' : ''}`);
      node.dataset.segmentId = segment.id; node.style.setProperty('--topic-color', color);
      node.setAttribute('aria-pressed', String(segment.id === selectedId));
      const status = segment.organizationStatus ?? (segment.manual ? 'confirmed' : 'unorganized');
      node.append(el('div', { class: 'node-top' }, [badge(String(index + 1).padStart(2, '0')), badge(({ confirmed: '已确认', needs_review: '需要复核', unorganized: '未整理' }[status] ?? '未整理'), status === 'needs_review' ? 'warning' : status === 'confirmed' ? 'good' : '')]),
        el('strong', { class: 'node-title', text: segment.title }), el('span', { class: 'node-conversation', text: byConversation.get(segment.conversationId)?.title ?? '未知对话' }),
        el('span', { class: 'node-time', text: timeLabel(segment.time) }), el('div', { class: 'tags' }, segment.topicIds.length ? segment.topicIds.map(k => badge(topics.get(k)?.name ?? '未知主题')) : [badge('未分类')]),
        el('div', { class: 'node-footer' }, [el('span', { text: `${segment.qaIds.length} 轮 Q/A` }), el('span', { text: segment.id === selectedId ? '● 已选中' : '展开 →' })]));
      if (segment.pendingSuggestionIds?.length) node.append(badge(segment.suggestionNeedsReview ? '建议过期 / 需复核' : '待确认建议', 'warning'));
      if (segment.organization?.method) node.append(badge(segment.organization.method.kind === 'model' ? '模型建议 · 人工确认' : '规则建议 · 人工确认'));
      this.grid.append(node);
    });
    this.host.append(this.grid);
    if (!segments.length) this.host.append(el('div', { class: 'empty' }, [el('h3', { text: '这里将出现你的真实讨论' }), el('p', { text: '采集或导入对话后，每一轮问题都会成为一个可展开的节点。更早历史与其他分支以实际保存范围为准。' })]));
    if (segments.length > this.limit) this.host.append(button(`继续加载地图（已显示 ${Math.min(this.limit, segments.length)} / ${segments.length}）`, () => { this.limit += 60; this.render(segments, view, selectedId); }, 'btn load-more'));
    requestAnimationFrame(() => this.layout());
  }
  layout() {
    if (!this.grid?.isConnected) return;
    const columns = Math.max(1, Math.floor((this.host.clientWidth + 18) / 225));
    this.grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    const nodes = Array.from(this.grid.querySelectorAll('.map-node'));
    nodes.forEach((node, i) => { const row = Math.floor(i / columns), offset = i % columns; node.style.gridColumn = String(row % 2 ? columns - offset : offset + 1); node.style.gridRow = String(row + 1); });
    this.grid.querySelector('svg')?.remove();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('map-lines'); svg.setAttribute('aria-hidden', 'true');
    const rect = this.grid.getBoundingClientRect(); svg.setAttribute('width', this.grid.clientWidth); svg.setAttribute('height', this.grid.scrollHeight);
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1].getBoundingClientRect(), b = nodes[i].getBoundingClientRect();
      const nextRow = Math.floor((i - 1) / columns) !== Math.floor(i / columns);
      const x1 = (nextRow ? a.left + a.width / 2 : a.left < b.left ? a.right : a.left) - rect.left;
      const y1 = (nextRow ? a.bottom : a.top + a.height / 2) - rect.top;
      const x2 = (nextRow ? b.left + b.width / 2 : a.left < b.left ? b.left : b.right) - rect.left;
      const y2 = (nextRow ? b.top : b.top + b.height / 2) - rect.top;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y2}`); svg.append(path);
    }
    this.grid.prepend(svg);
  }
  select(segmentId, reveal = false) {
    this.selectedId = segmentId;
    const position = this.segments?.findIndex(s => s.id === segmentId) ?? -1;
    if (position >= this.limit) { this.limit = Math.ceil((position + 1) / 60) * 60; this.render(this.segments, this.view, segmentId); }
    for (const node of this.grid?.querySelectorAll('.map-node') ?? []) {
      const selected = node.dataset.segmentId === segmentId; node.classList.toggle('selected', selected); node.setAttribute('aria-pressed', String(selected));
      const status = node.querySelector('.node-footer span:last-child'); if (status) status.textContent = selected ? '● 已选中' : '展开 →';
      if (selected && reveal) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}
