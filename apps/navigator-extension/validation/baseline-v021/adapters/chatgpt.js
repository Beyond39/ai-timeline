/* Executed only on explicit capture, in Chrome's isolated world. No page API calls. */
(() => {
  const VERSION = 'chatgpt-dom-v1';
  const SELECTORS = {
    roles: 'main [data-message-author-role]',
    turns: 'main [data-testid^="conversation-turn-"], main article[data-turn]',
    bodies: ['[data-message-content]', '[data-testid="user-message"]', '.markdown', '.whitespace-pre-wrap'],
    controls: 'button,svg,script,style,[aria-hidden="true"],[data-testid*="copy"],[data-testid*="feedback"]',
    attachments: '[data-testid*="attachment"],[data-testid*="file"],a[download],a[href^="https://files."]',
    streaming: '[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="停止生成"],button[aria-label="停止响应"]'
  };
  const visible = el => {
    if (!el || el.closest('[hidden],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(el); return style.display !== 'none' && style.visibility !== 'hidden';
  };
  function detect() {
    if (!['chatgpt.com', 'chat.openai.com'].includes(location.hostname)) return { ok: false, reason: '当前页不是支持的 ChatGPT 站点。请打开 chatgpt.com 的一条对话。' };
    const candidates = Array.from(document.querySelectorAll(SELECTORS.roles)).filter(visible);
    if (!candidates.length) return { ok: false, reason: '没有找到可靠的消息角色标记。可能仍在加载、尚无消息、需要登录，或页面结构已变化。可稍后重试或使用 JSON 文件导入。' };
    return { ok: true, candidates };
  }
  function renderedText(el) {
    const clone = el.cloneNode(true); clone.querySelectorAll(SELECTORS.controls).forEach(n => n.remove());
    // Preserve block and code boundaries without retaining executable markup.
    const output = [];
    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) { output.push(node.textContent); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const block = /^(P|DIV|PRE|LI|UL|OL|H[1-6]|TR|BLOCKQUOTE|SECTION|TABLE)$/.test(node.tagName);
      if (block && output.length && !output.at(-1).endsWith('\n')) output.push('\n');
      if (node.tagName === 'BR') output.push('\n');
      else Array.from(node.childNodes).forEach(visit);
      if (/^(TD|TH)$/.test(node.tagName)) output.push('\t');
      if (block && output.length && !output.at(-1).endsWith('\n')) output.push('\n');
    }
    visit(clone); return output.join('').replace(/^\n|\n$/g, '');
  }
  function textOf(el) {
    for (const selector of SELECTORS.bodies) {
      const nodes = Array.from(el.querySelectorAll(selector)).filter(n => visible(n) && !n.parentElement?.closest(selector));
      if (nodes.length) return nodes.map(renderedText).join('\n\n');
    }
    return renderedText(el);
  }
  function attachmentsOf(el) {
    const result = [];
    for (const node of el.querySelectorAll(SELECTORS.attachments)) {
      if (!visible(node) || result.some(r => r.reference && r.reference === node.getAttribute('href'))) continue;
      result.push({ type: node.getAttribute('data-content-type') ?? 'attachment', name: node.getAttribute('download') || node.getAttribute('aria-label') || node.textContent?.trim() || null,
        reference: node.getAttribute('data-file-id') ?? node.getAttribute('href') ?? null, status: 'reference_only', evidence: 'rendered_attachment_element' });
    }
    for (const node of el.querySelectorAll('img,video,audio,canvas,iframe')) {
      if (!visible(node) || node.closest('button,[data-testid*="avatar"]')) continue;
      result.push({ type: node.tagName.toLowerCase(), name: node.getAttribute('alt') ?? node.getAttribute('title') ?? null,
        reference: node.getAttribute('src') ?? null, status: 'body_unavailable', evidence: 'rendered_media_element' });
    }
    return result;
  }
  function timestamp(el) {
    const time = el.querySelector('time[datetime]'); const value = time?.getAttribute('datetime');
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? { value: date.toISOString(), precision: /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'date_only' : 'message', source: 'DOM.time.datetime', raw: value } : { value: null, precision: 'unknown', source: null };
  }
  function normalize(el, index) {
    const container = el.closest('[data-message-id]') ?? el;
    const turn = el.closest('[data-testid^="conversation-turn-"],article[data-turn]') ?? el;
    const sourceMessageId = el.getAttribute('data-message-id') ?? container.getAttribute('data-message-id');
    const parent = el.getAttribute('data-parent-message-id') ?? container.getAttribute('data-parent-message-id');
    const text = textOf(el), attachments = attachmentsOf(turn);
    const role = el.getAttribute('data-message-author-role');
    return { key: `dom:${index}`, nodeKey: sourceMessageId ?? null, sourceMessageId, identityBasis: sourceMessageId ? 'DOM.data-message-id' : 'ordered_context_fallback',
      role, originalRole: role, text, position: index, rowHint: turn.getAttribute('data-testid') ?? turn.getAttribute('data-turn') ?? null,
      sourceParentKey: parent, relationStatus: parent ? 'provided' : 'unknown', time: timestamp(turn),
      contentTypes: [...new Set([...(text ? ['rendered_text'] : []), ...attachments.map(a => a.type)])], attachments,
      contentStatus: text ? (attachments.length ? 'text_with_references' : 'available') : 'body_unavailable', streaming: 'unknown',
      raw: { messageIdAttribute: sourceMessageId, parentMessageIdAttribute: parent, turnAttribute: turn.getAttribute('data-testid'), extraction: 'rendered_DOM_text' } };
  }
  async function collect() {
    let detection = detect(); if (!detection.ok) return detection;
    const href = location.href;
    const first = detection.candidates.map(textOf);
    // One short observation detects changes; it does not claim generation completion.
    await new Promise(resolve => setTimeout(resolve, 650));
    if (location.href !== href) return { ok: false, reason: '观察期间页面已切换。请在目标对话页面重新采集。' };
    detection = detect(); if (!detection.ok) return detection;
    const messages = detection.candidates.map(normalize);
    const generating = !!document.querySelector(SELECTORS.streaming);
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'assistant' && (first[i] !== messages[i].text || (generating && i === messages.length - 1))) messages[i].streaming = 'generating';
      else messages[i].streaming = first[i] === messages[i].text ? 'stable_observed' : 'unknown';
    }
    const duplicateIDs = messages.filter(m => m.sourceMessageId && messages.filter(n => n.sourceMessageId === m.sourceMessageId).length > 1);
    if (duplicateIDs.length) return { ok: false, reason: '页面出现重复源消息标识，无法可靠区分消息。请等待页面稳定后重试，或导入导出文件。' };
    const match = location.pathname.match(/\/c\/([^/]+)/);
    const projectElement = document.querySelector('main [data-project-id]');
    const nativeProject = projectElement ? { id: projectElement.getAttribute('data-project-id'), name: projectElement.getAttribute('data-project-name') ?? null, status: 'provided', basis: 'DOM.data-project-id' } : { id: null, name: null, status: 'unknown', basis: null };
    const titleElement = document.querySelector('main [data-conversation-title]');
    const title = titleElement?.getAttribute('data-conversation-title') || document.title.replace(/\s*[-|–]\s*ChatGPT\s*$/, '').trim() || '未命名 ChatGPT 对话';
    const warnings = ['仅采集当前页面已加载且可识别的消息，无法确认更早历史是否全部加载。', '未展示的分支未采集；页面顺序不代表已取得完整父子关系。', '附件、图片、画布和其他非文本内容仅保存存在信息及可见引用，不下载文件正文。', '渲染后文本会保留段落与代码；公式、表格、隐藏工具详情可能缺少平台原始表示。'];
    if (messages.some(m => !m.sourceMessageId)) warnings.push('部分消息没有源 ID，将采用保守的上下文匹配；不确定时保留为独立记录。');
    if (messages.some(m => m.time.value === null)) warnings.push('部分或全部消息的来源时间未知；采集时间不会用作讨论发生时间。');
    if (messages.some(m => m.streaming === 'generating')) warnings.push('检测到回答仍在变化。本次可保存为生成中版本，稍后点击更新采集。');
    if (nativeProject.status === 'unknown') warnings.push('无法确认 ChatGPT 原生项目，可在保存时手动记录归属。');
    return { ok: true, conversation: { title, titleBasis: titleElement ? 'DOM.data-conversation-title' : 'document.title',
      platform: 'openai-chatgpt', sourceConversationId: match?.[1] ?? null, identityBasis: match ? 'URL.c_path' : 'source_url_fallback', sourceUrl: href,
      sourceTime: { value: null, precision: 'unknown', source: null }, nativeProject,
      messages, graph: messages.filter(m => m.sourceMessageId).map(m => ({ key: m.sourceMessageId, messageKey: m.key, parent: m.sourceParentKey, children: [] })),
      paths: [{ key: 'observed-dom', label: '当前页面实际展示的阅读顺序', messageKeys: messages.map(m => m.key), status: 'observed_order', isCurrent: true }],
      currentPathKey: 'observed-dom', method: VERSION, adapterVersion: VERSION, capturedAt: new Date().toISOString(),
      scope: { kind: 'loaded_page', history: 'unknown_unloaded', branches: 'not_collected', attachments: 'references_only', description: '当前页面已加载、展示且能够识别的内容。' }, warnings } };
  }
  globalThis.__ACVN_CHATGPT__ = { detect, collect, version: VERSION };
})();
