/* Explicit, local DOM capture in Chrome's isolated world. Role markers can be
 * outside <main>; current turn wrappers can be sections as well as articles.
 * Compatibility fixtures are not a claim that a user's live page was tested. */
(() => {
  const VERSION = 'chatgpt-dom-v7';
  const SELECTORS = {
    roles: '[data-message-author-role]',
    legacyRoles: '[data-role],[data-message-author]',
    markers: '[data-testid="user-message"],[data-testid="assistant-message"]',
    turns: '[data-testid^="conversation-turn-"],[data-testid="conversation-turn"],[data-turn]',
    headingTurns: '#thread section,main section,[role="main"] section,#thread article,main article,[role="main"] article',
    bodies: ['[data-message-content]', '[data-testid="user-message"]', '[data-testid="assistant-message"]', '.markdown', '.markdown-new-styling', '.whitespace-pre-wrap', '.prose', '[class*="markdown"]', '[class*="prose"]'],
    richBlocks: 'p,pre,table,blockquote,ul,ol',
    controls: 'button,svg,script,style,[aria-hidden="true"],[data-testid*="copy"],[data-testid*="feedback"]',
    excluded: 'nav,aside,header,footer,form,button,svg,script,style,textarea,input,[role="menu"],[role="textbox"],[contenteditable="true"],[contenteditable="plaintext-only"]',
    attachments: '[data-testid*="attachment"],[data-testid*="file"],a[download],a[href^="https://files."]',
    streaming: '[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="停止生成"],button[aria-label="停止响应"]',
    loading: 'main[aria-busy="true"],main [aria-busy="true"],[id="thread"][aria-busy="true"],[id="thread"] [aria-busy="true"],main [role="progressbar"],[id="thread"] [role="progressbar"],main [data-testid*="loading"]'
  };
  const visible = element => {
    if (!element || element.closest('[hidden],[aria-hidden="true"]')) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    return true;
  };
  const readable = element => {
    if (!visible(element) || element.closest(SELECTORS.excluded)) return false;
    const dialog = element.closest('[role="dialog"],dialog');
    // Project conversations may be portalled into a dialog outside <main>.
    // A generic preview/dialog alone is insufficient: require a conversation
    // thread or an explicitly marked turn containing this exact element.
    return !dialog || !!element.closest('[id="thread"]') || !!element.closest(SELECTORS.turns);
  };
  const ROLES = new Set(['user', 'assistant', 'tool', 'function', 'system', 'developer']);
  let capturePlans = new WeakMap();
  let capturedCandidates = [];
  function speakerHeading(element) {
    return Array.from(element.children).find(node => /^(H[1-6])$/.test(node.tagName) &&
      /^(?:you said|chatgpt said|你说|您说|你說|您說|chatgpt\s*[说說])\s*[:：]?$/i.test(node.textContent.trim())) ?? null;
  }
  function roleOf(element) {
    if (capturePlans.has(element)) return capturePlans.get(element).role;
    const author = element.getAttribute('data-message-author-role');
    if (ROLES.has(author)) return { role: author, basis: 'DOM.data-message-author-role' };
    for (const attribute of ['data-role', 'data-message-author']) {
      const role = element.getAttribute(attribute);
      if (ROLES.has(role)) return { role, basis: `DOM.${attribute}` };
    }
    const turn = element.getAttribute('data-turn');
    if (ROLES.has(turn)) return { role: turn, basis: 'DOM.data-turn' };
    const heading = speakerHeading(element);
    if (heading) return { role: /^(?:you said|你说|您说|你說|您說)/i.test(heading.textContent.trim()) ? 'user' : 'assistant', basis: 'DOM.speaker-heading' };
    const marker = element.getAttribute('data-testid');
    if (marker === 'user-message') return { role: 'user', basis: 'DOM.user-message-marker' };
    if (marker === 'assistant-message') return { role: 'assistant', basis: 'DOM.assistant-message-marker' };
    return null;
  }
  const boundarySelector = `${SELECTORS.turns},[data-message-id]`;
  const sameOrContains = (parent, child) => parent === child || ancestorOf(parent, child);
  function reliableId(element) {
    const own = element.closest('[data-message-id]')?.getAttribute('data-message-id');
    if (own) return own;
    const ids = [...new Set(Array.from(element.querySelectorAll('[data-message-id]')).filter(readable).map(node => node.getAttribute('data-message-id')).filter(Boolean))];
    return ids.length === 1 ? ids[0] : null;
  }
  function conversationArea(pool) {
    const threads = Array.from(document.querySelectorAll('[id="thread"]')).filter(visible);
    const mains = Array.from(document.querySelectorAll('main,[role="main"]')).filter(element => visible(element) && !element.closest(SELECTORS.excluded));
    const occupied = candidates => {
      const roots = [...new Set(candidates)];
      const outer = roots.filter(root => !roots.some(other => other !== root && ancestorOf(other, root)));
      return outer.filter(root => pool.some(element => sameOrContains(root, element)));
    };
    const occupiedThreads = occupied(threads), occupiedMains = occupied(mains);
    if (occupiedThreads.length > 1 || occupiedMains.length > 1) return { ambiguous: true, root: null };
    let root = occupiedThreads[0] ?? occupiedMains[0] ?? null;
    // A narrow thread can wrap prompts while the response is a sibling in the
    // SAME main. Keep that main's current conversation together; never expand
    // to document/body, unrelated dialogs, sidebars or another occupied main.
    if (root === occupiedThreads[0] && occupiedMains[0] && ancestorOf(occupiedMains[0], root) &&
        pool.some(node => sameOrContains(occupiedMains[0], node) && !sameOrContains(root, node))) root = occupiedMains[0];
    return { ambiguous: false, root };
  }
  function ancestorOf(parent, element) {
    for (let node = element.parentElement; node; node = node.parentElement) if (node === parent) return true;
    return false;
  }
  function scan() {
    capturePlans = new WeakMap();
    const roles = Array.from(document.querySelectorAll(SELECTORS.roles));
    const turns = Array.from(document.querySelectorAll(SELECTORS.turns));
    const bodies = Array.from(document.querySelectorAll(SELECTORS.bodies.join(','))).filter(readable);
    const richBlocks = Array.from(document.querySelectorAll(SELECTORS.richBlocks)).filter(node => readable(node) && !node.closest(SELECTORS.controls) && renderedText(node).trim());
    const boundaryPool = Array.from(document.querySelectorAll(boundarySelector)).filter(readable);
    const rolePool = Array.from(document.querySelectorAll(`${SELECTORS.roles},${SELECTORS.legacyRoles},${SELECTORS.markers},${SELECTORS.turns},${SELECTORS.headingTurns}`));
    const rawRoleEvidence = new Map(rolePool.map(node => [node, roleOf(node)]));
    const found = rolePool.filter(element => readable(element) && rawRoleEvidence.get(element));
    const area = conversationArea([...found, ...bodies, ...boundaryPool, ...richBlocks].filter(element => renderedText(element).trim() || roleOf(element)));
    const withinArea = element => !area.root || sameOrContains(area.root, element);
    const roleNodes = found.filter(withinArea), evidence = new Map(roleNodes.map(node => [node, roleOf(node)]));
    // Expand an explicit role marker to its reliable message-ID boundary when
    // that boundary owns just this role/message. This keeps code siblings and
    // text before/after a narrow body marker without merging independent turns.
    for (const node of [...roleNodes]) {
      const owner = node.closest('[data-message-id]');
      if (!owner || owner === node || !readable(owner) || !withinArea(owner)) continue;
      const nested = roleNodes.filter(candidate => sameOrContains(owner, candidate));
      const ownId = owner.getAttribute('data-message-id');
      const otherBodies = bodies.some(body => ancestorOf(owner, body) && !sameOrContains(node, body) && !sameOrContains(body, node) && !body.closest('pre,code,table'));
      if (nested.some(candidate => evidence.get(candidate).role !== evidence.get(node).role || reliableId(candidate) && reliableId(candidate) !== ownId) ||
          otherBodies || Array.from(owner.querySelectorAll('[data-message-id]')).some(candidate => readable(candidate) && candidate.getAttribute('data-message-id') !== ownId)) continue;
      if (!evidence.has(owner)) { roleNodes.push(owner); evidence.set(owner, evidence.get(node)); }
    }
    const conflicts = (outer, inner) => evidence.get(outer).role !== evidence.get(inner).role || reliableId(outer) && reliableId(inner) && reliableId(outer) !== reliableId(inner);
    const split = new Set(roleNodes.filter(outer => roleNodes.some(inner => inner !== outer && ancestorOf(outer, inner) && conflicts(outer, inner))));
    const known = roleNodes.filter(node => !split.has(node) && !roleNodes.some(outer => outer !== node && !split.has(outer) && ancestorOf(outer, node)));
    const roots = new Set(known), unknown = new Set(), anchors = new Map(known.map(node => [node, node]));
    const establishedConversation = /\/(?:c|share)\/[^/]+/.test(location.pathname);
    // A just-started chat can still be at / before ChatGPT assigns its c/ URL.
    // Existing explicit user/assistant evidence inside one area permits its
    // unknown response; a project-home prose card alone never permits recovery.
    const newConversation = area.root && known.some(node => ['user', 'assistant'].includes(evidence.get(node)?.role));
    const recover = (establishedConversation || newConversation) && !area.ambiguous;
    if (recover) {
      const knownWithin = owner => known.filter(node => sameOrContains(owner, node));
      const siblingBranch = (seed, limit) => {
        let owner = seed;
        while (owner.parentElement && owner.parentElement !== area.root && withinArea(owner.parentElement)) {
          const parent = owner.parentElement;
          // A generic section can hold the entire feed. A known message in a
          // different branch is a hard stop, not a reason to swallow its peers.
          if (parent === limit || known.some(node => sameOrContains(parent, node) && !sameOrContains(owner, node))) break;
          owner = parent;
        }
        return owner;
      };
      const richRoots = [];
      // A renderer may use no old Markdown CSS or author attributes at all.
      // Recover visible prose/code/table in the current bounded feed, grouping
      // by an article/section or the sibling branch beside an existing message.
      // These nodes remain UNKNOWN: content shape is never role evidence.
      if (area.root) for (const block of richBlocks.filter(withinArea)) {
        if (known.some(owner => sameOrContains(owner, block)) || bodies.some(owner => sameOrContains(owner, block) && !knownWithin(owner).length)) continue;
        let owner = block.closest(boundarySelector) ?? block.closest('article,section');
        if (owner && !withinArea(owner)) owner = null;
        if (!owner || knownWithin(owner).length) owner = siblingBranch(block, owner);
        if (owner !== area.root && readable(owner)) richRoots.push({ node: block, owner, anchor: block, rich: true });
      }
      const plainRoots = [...boundaryPool, ...bodies].filter(withinArea).map(node => {
        let owner = node.closest(boundarySelector) ?? node;
        // Even a nominal turn wrapper can contain multiple explicit messages.
        // Keep each unknown body beside those messages in its own branch.
        if (bodies.includes(node) && node !== owner && knownWithin(owner).length > 1) owner = siblingBranch(node, owner);
        if (bodies.includes(node) && !node.closest(boundarySelector) && known.length && area.root && node !== area.root) {
          const generic = node.closest('article,section');
          if (!generic || knownWithin(generic).length) owner = siblingBranch(node, generic ?? area.root);
        }
        return { node, owner, anchor: node, rich: false };
      });
      for (const { node, owner: chosenOwner, anchor, rich } of [...plainRoots, ...richRoots]) {
        // Body-like classes inside code/table cells are formatting fragments,
        // never independent messages. A body CSS ancestor is NOT a role owner.
        if (!rich && node.closest('pre,code,table') || known.some(owner => sameOrContains(owner, node))) continue;
        let owner = chosenOwner;
        if (!withinArea(owner)) owner = node;
        // Do not promote an outer turn over a closer independent message-ID.
        // Nested real boundaries remain separate; only their residual text is
        // read from the parent, with child roots excluded below.
        roots.add(owner); unknown.add(owner);
        if (!anchors.has(owner) || ancestorOf(anchors.get(owner), anchor)) anchors.set(owner, anchor);
      }
    }
    // A nested CSS formatting block between readable text on BOTH sides is not
    // a defensible message break. Keep that plain body intact instead of
    // outputting "before + after" followed by its middle block. Real turn/ID
    // boundaries and explicit roles always stay separate.
    for (const outer of [...unknown]) {
      if (outer.matches(boundarySelector) || known.some(node => ancestorOf(outer, node)) || boundaryPool.some(node => ancestorOf(outer, node))) continue;
      const whole = renderedText(outer);
      const nested = [...unknown].filter(inner => inner !== outer && roots.has(inner) && ancestorOf(outer, inner) && !inner.matches(boundarySelector));
      if (nested.some(inner => {
        const text = renderedText(inner), index = text ? whole.indexOf(text) : -1;
        return index >= 0 && whole.slice(0, index).trim() && whole.slice(index + text.length).trim();
      })) for (const inner of nested) { roots.delete(inner); unknown.delete(inner); }
    }
    const order = new Map(Array.from(document.querySelectorAll('*')).map((node, index) => [node, index]));
    let candidates = area.ambiguous ? [] : [...roots];
    for (const node of candidates) {
      const excludes = candidates.filter(other => other !== node && ancestorOf(node, other));
      capturePlans.set(node, { role: unknown.has(node) ? null : evidence.get(node), excludes, bodySelector: unknown.has(node) ? node.matches(boundarySelector) ? 'unverified_message_boundary' : 'unverified_body_fragment' : 'verified_message_boundary' });
    }
    candidates = candidates.filter(node => !unknown.has(node) || textOf(node).trim() || !known.some(owner => ancestorOf(node, owner)) && attachmentsOf(node).length);
    candidates.sort((a, b) => (order.get(anchors.get(a)) ?? order.get(a) ?? 0) - (order.get(anchors.get(b)) ?? order.get(b) ?? 0));
    const knownCount = candidates.filter(node => roleOf(node)).length;
    const captureMode = knownCount === candidates.length && knownCount ? 'message_markers' : knownCount ? 'mixed_markers' : 'body_fallback';
    capturedCandidates = candidates;
    const loading = Array.from(document.querySelectorAll(SELECTORS.loading)).filter(readable);
    const pageStructure = {
      mainRegions: document.querySelectorAll('main,[role="main"]').length,
      threadRegions: document.querySelectorAll('[id="thread"]').length,
      authorRoleMarkers: roles.length, visibleAuthorRoleMarkers: roles.filter(readable).length,
      turnContainers: turns.length, visibleTurnContainers: turns.filter(readable).length,
      readableBodyBlocks: bodies.filter(element => renderedText(element).trim()).length,
      candidateMessages: candidates.length, loadingIndicators: loading.length,
      semanticRoleMarkers: rolePool.filter(node => rawRoleEvidence.get(node)).length,
      userMarkers: rolePool.filter(node => rawRoleEvidence.get(node)?.role === 'user').length,
      assistantMarkers: rolePool.filter(node => rawRoleEvidence.get(node)?.role === 'assistant').length,
      visibleUserMarkers: found.filter(node => rawRoleEvidence.get(node)?.role === 'user').length,
      visibleAssistantMarkers: found.filter(node => rawRoleEvidence.get(node)?.role === 'assistant').length,
      richBodyBlocks: richBlocks.length,
      unclaimedRichBlocks: richBlocks.filter(block => !candidates.some(owner => sameOrContains(owner, block) && !(capturePlans.get(owner)?.excludes ?? []).some(other => sameOrContains(other, block)))).length,
      outOfScopeBodyBlocks: bodies.filter(node => !withinArea(node)).length
    };
    return { candidates, pageStructure, captureMode, loading: document.readyState === 'loading' || loading.length > 0 };
  }
  const errorReasons = {
    unsupported_page: '当前页面不支持采集。请打开 ChatGPT 的对话页面。',
    messages_not_loaded: '当前页面尚未取得消息。请等待消息加载，或滚动到需要采集的内容后重试。',
    messages_not_found: '未识别到可读取的对话消息。若页面已显示正文，请复制诊断信息检查页面结构；滚动不一定能解决。',
    structure_unrecognized: '页面已有内容，但消息角色或结构无法可靠识别。请复制诊断信息检查适配器，或使用 JSON 导入。',
    page_changed: '观察期间页面已切换。请在目标对话页面重新采集。',
    source_changed: '开始采集前来源发生变化。请再次点击“采集当前对话”。',
    duplicate_source_ids: '页面出现重复消息标识，无法可靠区分消息。请等页面稳定后重试。'
  };
  function baseDiagnostic({ candidates = [], errorCode = null, counts = {}, pageStructure = null, captureMode = null } = {}) {
    return {
      adapterVersion: VERSION,
      pageType: !['chatgpt.com', 'chat.openai.com'].includes(location.hostname) ? 'unsupported' : /\/g\/[^/]+\/c\//.test(location.pathname) ? 'project_conversation' : /\/c\/[^/]+/.test(location.pathname) ? 'conversation' : 'chatgpt_other',
      status: errorCode ? 'failed' : 'recognized',
      counts: { messages: candidates.length, roles: {}, reliableSourceIds: 0, unknownSourceIds: candidates.length, generating: 0, bodyUnavailable: 0, attachments: 0, referenceOnly: 0, ...counts },
      capabilities: { text: 'not_checked', structure: 'not_checked', messageIdentity: 'not_checked', parents: 'unknown', nativeProject: 'unknown', sourceTime: 'unknown', history: 'unknown_unloaded', branches: 'not_collected', attachmentBodies: 'unavailable' },
      coverage: { kind: 'partial_scope', description: '只统计本次页面已加载且可识别的内容；完整历史是否已加载未知。', observedMessages: candidates.length, fullHistory: 'unknown', branches: 'not_collected' },
      errors: errorCode ? [{ code: errorCode, reason: errorReasons[errorCode] ?? errorReasons.structure_unrecognized }] : [],
      notices: [],
      ...(pageStructure ? { pageStructure } : {}),
      ...(captureMode ? { captureMode } : {}),
      technical: { selectorSet: VERSION, observationWindowMs: 650, rolesSelector: SELECTORS.roles, bodySelectors: [...SELECTORS.bodies] }
    };
  }
  function failure(errorCode, candidates = [], details = {}) {
    const diagnostics = baseDiagnostic({ candidates, errorCode });
    if (details.pageStructure) diagnostics.pageStructure = details.pageStructure;
    diagnostics.technical = { ...diagnostics.technical, ...details };
    return { ok: false, errorCode, reason: errorReasons[errorCode] ?? errorReasons.structure_unrecognized, diagnostics };
  }
  function detect() {
    if (!['chatgpt.com', 'chat.openai.com'].includes(location.hostname)) return failure('unsupported_page');
    const { candidates, pageStructure, loading, captureMode } = scan();
    if (candidates.length) return { ok: true, candidates, captureMode, diagnostics: baseDiagnostic({ candidates, pageStructure, captureMode }) };
    // Content evidence beats a generic busy indicator. Never call an unrecognized
    // rendered conversation "not loaded" simply because selectors missed it.
    const rendered = pageStructure.visibleTurnContainers || pageStructure.readableBodyBlocks || pageStructure.richBodyBlocks;
    const code = rendered ? 'structure_unrecognized' : loading ? 'messages_not_loaded' : 'messages_not_found';
    return failure(code, [], { pageStructure, causeCertainty: rendered ? 'rendered_content_without_role' : loading ? 'loading_indicator' : 'no_recognized_message_markers' });
  }
  function readableClone(element) {
    const clone = element.cloneNode(true);
    const originalNodes = Array.from(element.querySelectorAll('*'));
    const clonedNodes = Array.from(clone.querySelectorAll('*'));
    const heading = speakerHeading(element);
    const excludes = capturePlans.get(element)?.excludes ?? [];
    originalNodes.forEach((node, index) => {
      if (!visible(node) || node.matches(`${SELECTORS.controls},${SELECTORS.excluded},${SELECTORS.attachments},time[datetime]`) || node === heading || excludes.includes(node) ||
          node === speakerHeading(node.parentElement) && !SELECTORS.bodies.some(selector => node.parentElement.matches(selector))) clonedNodes[index]?.remove();
    });
    return clone;
  }
  function renderedText(element) {
    const clone = readableClone(element), output = [];
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
    visit(clone);
    return output.join('').replace(/^\n|\n$/g, '');
  }
  function bodyNodes(element) {
    // The selected message/fragment boundary is authoritative for text scope.
    // Picking the first CSS selector could retain only a code box or first
    // paragraph and silently drop the rest of an assistant's answer.
    return { nodes: [element], selector: capturePlans.get(element)?.bodySelector ?? 'message_boundary' };
  }
  function textOf(element) { return bodyNodes(element).nodes.map(renderedText).join('\n\n'); }
  function inlineOf(element, text) {
    const parts = [];
    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) { parts.push({ type: 'text', text: node.textContent }); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.tagName === 'CODE') parts.push({ type: 'code', text: node.textContent });
      else if (node.tagName === 'BR') parts.push({ type: 'text', text: '\n' });
      else Array.from(node.childNodes).forEach(visit);
    }
    Array.from(element.childNodes).forEach(visit);
    return parts.some(part => part.type === 'code') && parts.map(part => part.text).join('') === text ? parts : undefined;
  }
  function presentationOf(element) {
    const blocks = [], chosen = bodyNodes(element);
    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) { if (node.textContent.trim()) blocks.push({ type: 'paragraph', text: node.textContent }); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.tagName === 'PRE') {
        const code = node.querySelector('code') ?? node;
        const language = Array.from(code.classList).find(name => /^language-[a-z0-9_+-]+$/i.test(name))?.slice(9) ?? null;
        blocks.push({ type: 'code', text: code.textContent, ...(language ? { language } : {}) }); return;
      }
      if (node.tagName === 'TABLE') {
        for (const caption of node.querySelectorAll('caption')) if (caption.closest('table') === node) blocks.push({ type: 'paragraph', text: renderedText(caption) });
        const rows = Array.from(node.querySelectorAll('tr')).filter(row => row.closest('table') === node).map(row => Array.from(row.children).filter(cell => /^(TD|TH)$/.test(cell.tagName)).map(cell => renderedText(cell).replace(/\t$/, '')));
        const firstRow = node.querySelector('tr');
        const hasHeader = !!firstRow && Array.from(firstRow.children).some(cell => cell.tagName === 'TH');
        if (rows.length) blocks.push({ type: 'table', headers: hasHeader ? rows[0] : [], rows: hasHeader ? rows.slice(1) : rows, structureStatus: 'observed_cells' });
        return;
      }
      const text = renderedText(node);
      if (/^H[1-6]$/.test(node.tagName)) { blocks.push({ type: 'heading', level: Number(node.tagName.slice(1)), text, inline: inlineOf(node, text) }); return; }
      if (/^(UL|OL)$/.test(node.tagName)) { blocks.push({ type: 'list', ordered: node.tagName === 'OL', items: Array.from(node.children).filter(child => child.tagName === 'LI').map(renderedText), text }); return; }
      if (node.tagName === 'BLOCKQUOTE') { blocks.push({ type: 'quote', text, inline: inlineOf(node, text) }); return; }
      if (node.tagName === 'P') { blocks.push({ type: 'paragraph', text, inline: inlineOf(node, text) }); return; }
      Array.from(node.childNodes).forEach(visit);
    }
    chosen.nodes.forEach(node => visit(readableClone(node)));
    const structural = blocks.some(block => ['code', 'table', 'heading', 'list', 'quote'].includes(block.type) || block.inline?.some(part => part.type === 'code'));
    const blockText = blocks.map(block => block.type === 'table' ? [...block.headers, ...block.rows.flat()].join('') : block.type === 'list' ? block.items.join('') : block.text).join('');
    // Formatting is optional. If any readable non-whitespace characters were
    // omitted/reordered by extraction, use the complete plain text instead.
    const complete = blockText.replace(/\s/g, '') === textOf(element).replace(/\s/g, '');
    return structural && complete ? { format: 'dom-structured', source: 'dom', status: 'verified_structure', textCoverage: 'all_readable_characters', blocks, bodySelector: chosen.selector } : { format: 'plain', source: 'dom', status: 'text_only', bodySelector: chosen.selector };
  }
  function attachmentsOf(element, { ignorePlan = false } = {}) {
    const result = [], seen = new Set();
    const excludes = ignorePlan ? [] : capturePlans.get(element)?.excludes ?? [];
    const belongs = node => visible(node) && !excludes.some(owner => sameOrContains(owner, node));
    for (const node of element.querySelectorAll(SELECTORS.attachments)) {
      if (!belongs(node)) continue;
      const reference = node.getAttribute('data-file-id') ?? node.getAttribute('href') ?? null;
      if (reference && seen.has(reference)) continue;
      if (reference) seen.add(reference);
      result.push({ type: node.getAttribute('data-content-type') ?? 'attachment', name: node.getAttribute('download') || node.getAttribute('aria-label') || node.textContent?.trim() || null, reference, status: 'reference_only', evidence: 'rendered_attachment_element' });
    }
    for (const node of element.querySelectorAll('img,video,audio,canvas,iframe')) {
      if (!belongs(node) || node.closest('button,[data-testid*="avatar"]')) continue;
      result.push({ type: node.tagName.toLowerCase(), name: node.getAttribute('alt') ?? node.getAttribute('title') ?? null, reference: node.getAttribute('src') ?? null, status: 'body_unavailable', evidence: 'rendered_media_element' });
    }
    return result;
  }
  function timestamp(element, { ignorePlan = false } = {}) {
    const excludes = ignorePlan ? [] : capturePlans.get(element)?.excludes ?? [];
    const times = Array.from(element.querySelectorAll('time[datetime]')).filter(node => visible(node) && !excludes.some(other => sameOrContains(other, node)));
    const value = times.length === 1 ? times[0].getAttribute('datetime') : null, date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? { value: date.toISOString(), precision: /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'date_only' : 'message', source: 'DOM.time.datetime', raw: value } : { value: null, precision: 'unknown', source: null };
  }
  function normalize(element, index) {
    const excludes = capturePlans.get(element)?.excludes ?? [];
    const innerIds = Array.from(element.querySelectorAll('[data-message-id]')).filter(node => readable(node) && !excludes.some(other => sameOrContains(other, node)));
    const container = element.closest('[data-message-id]') ?? (innerIds.length === 1 ? innerIds[0] : element);
    const turn = element.closest(SELECTORS.turns) ?? element;
    const providedId = element.getAttribute('data-message-id') ?? container.getAttribute('data-message-id');
    const sharedBoundary = providedId && capturedCandidates.filter(node => sameOrContains(container, node)).length > 1;
    const sourceMessageId = sharedBoundary ? null : providedId;
    const parent = sharedBoundary ? null : element.getAttribute('data-parent-message-id') ?? container.getAttribute('data-parent-message-id');
    const turnOwners = capturedCandidates.filter(node => sameOrContains(turn, node));
    const text = textOf(element), attachments = attachmentsOf(turnOwners.length <= 1 ? turn : element, { ignorePlan: turnOwners.length <= 1 }), recognizedRole = roleOf(element), role = recognizedRole?.role ?? 'unknown';
    return { key: `dom:${index}`, nodeKey: sourceMessageId ?? null, sourceMessageId, identityBasis: sourceMessageId ? 'DOM.data-message-id' : 'ordered_context_fallback', role, originalRole: role, roleUnverified: !recognizedRole, text, position: index,
      ...(sharedBoundary ? { sharedSourceMessageId: providedId } : {}),
      rowHint: turn.getAttribute('data-testid') ?? turn.getAttribute('data-turn-id') ?? null,
      sourceParentKey: parent, relationStatus: parent ? 'provided' : 'unknown', time: timestamp(turnOwners.length <= 1 ? turn : element, { ignorePlan: turnOwners.length <= 1 }), presentation: presentationOf(element),
      contentTypes: [...new Set([...(text ? ['rendered_text'] : []), ...attachments.map(attachment => attachment.type)])], attachments,
      contentStatus: text ? (attachments.length ? 'text_with_references' : 'available') : 'body_unavailable', streaming: 'unknown',
      raw: { messageIdAttribute: providedId, parentMessageIdAttribute: parent, turnAttribute: turn.getAttribute('data-testid'), roleBasis: recognizedRole?.basis ?? 'unverified_body', extraction: 'rendered_DOM_text', adapterVersion: VERSION, bodySelector: bodyNodes(element).selector } };
  }
  function diagnose(messages, { nativeProject = { status: 'unknown' }, pageStructure = null, captureMode = null, scrollAction = null } = {}) {
    const counts = { messages: messages.length, roles: {}, reliableSourceIds: 0, unknownSourceIds: 0, generating: 0, bodyUnavailable: 0, attachments: 0, referenceOnly: 0, structuredMessages: 0 };
    for (const message of messages) {
      counts.roles[message.role || 'unknown'] = (counts.roles[message.role || 'unknown'] ?? 0) + 1;
      counts[message.sourceMessageId ? 'reliableSourceIds' : 'unknownSourceIds']++;
      if (message.streaming === 'generating') counts.generating++;
      if (message.contentStatus === 'body_unavailable') counts.bodyUnavailable++;
      counts.attachments += message.attachments.length;
      counts.referenceOnly += message.attachments.filter(attachment => ['reference_only', 'body_unavailable'].includes(attachment.status)).length;
      if (message.presentation?.format === 'dom-structured') counts.structuredMessages++;
    }
    const diagnostics = baseDiagnostic({ counts, pageStructure, captureMode });
    diagnostics.coverage.observedMessages = messages.length;
    diagnostics.capabilities = { ...diagnostics.capabilities, text: counts.bodyUnavailable ? 'partial' : 'available', structure: counts.structuredMessages ? 'observed_blocks' : 'text_only',
      messageIdentity: counts.unknownSourceIds ? (counts.reliableSourceIds ? 'partial_source_ids' : 'context_fallback') : 'source_ids',
      parents: messages.some(message => message.sourceParentKey) ? 'partial_provided' : 'unknown', nativeProject: nativeProject.status,
      sourceTime: messages.some(message => message.time.value) ? 'partial_provided' : 'unknown' };
    diagnostics.notices.push({ code: 'partial_scope', reason: diagnostics.coverage.description });
    if (counts.generating) diagnostics.notices.push({ code: 'generating', reason: '回答仍在生成或观察期间正文发生变化；本次可保存，稍后再更新。' });
    if (counts.bodyUnavailable) diagnostics.notices.push({ code: 'body_unavailable', reason: `${counts.bodyUnavailable} 条消息没有取得可读正文，消息和缺失状态仍保留。` });
    if (counts.referenceOnly) diagnostics.notices.push({ code: 'reference_only', reason: `${counts.referenceOnly} 个附件或媒体仅取得引用 / 存在信息，正文未下载。` });
    if (counts.unknownSourceIds) diagnostics.notices.push({ code: 'source_id_unknown', reason: `${counts.unknownSourceIds} 条消息没有可靠源 ID，保存时使用有不确定性记录的保守匹配。` });
    if (messages.some(message => message.roleUnverified)) diagnostics.notices.push({ code: 'role_unverified', reason: '未确认说话人的正文仍按页面边界保留；有标记与无标记的内容都会保存。未知部分不根据正文样式或前后位置猜测角色或完整轮次。' });
    if (pageStructure?.unclaimedRichBlocks) diagnostics.notices.push({ code: 'uncovered_content', reason: '当前页仍有可读内容未被采集边界覆盖，请复制诊断帮助定位；这不代表页面尚未加载。' });
    if (scrollAction) diagnostics.notices.push({ code: scrollAction.status === 'moved' ? 'scrolled_partial' : 'scroll_unavailable', reason: scrollAction.status === 'moved' ? '已向上加载一屏并采集；仍不代表完整历史。' : '本次没有找到可继续向上滚动的对话区域，已采集当前取得的内容。' });
    return diagnostics;
  }
  function loadEarlier() {
    const { candidates } = scan();
    let target = candidates[0];
    while (target) {
      const contentBox = SELECTORS.bodies.some(selector => target.matches(selector)) && !target.matches('main,[role="main"],[id="thread"]');
      if (!contentBox && !target.closest('pre,code,table') && target.scrollHeight > target.clientHeight + 30 && /auto|scroll/.test(getComputedStyle(target).overflowY ?? '')) break;
      target = target.parentElement;
    }
    target ??= document.scrollingElement;
    if (!target || !(target.scrollHeight > target.clientHeight + 30) || !(target.scrollTop > 0)) return { status: 'unavailable' };
    const before = target.scrollTop, step = Math.max(1, Math.floor(target.clientHeight * 0.85));
    target.scrollTop = Math.max(0, before - step);
    return { status: target.scrollTop < before ? 'moved' : 'unavailable' };
  }
  const observationKey = message => message.sourceMessageId ? `source:${message.sourceMessageId}` : `row:${message.rowHint ?? ''}:${message.position}:${message.role}`;
  async function collect(options = {}) {
    if (!['chatgpt.com', 'chat.openai.com'].includes(location.hostname)) return failure('unsupported_page');
    if (options.expectedSourceUrl) {
      try {
        const key = url => { const match = url.pathname.match(/\/(c|share)\/([^/]+)/); return `${url.hostname}:${match ? `${match[1]}:${match[2]}` : url.pathname}`; };
        if (key(new URL(options.expectedSourceUrl)) !== key(location)) return failure('source_changed');
      } catch { return failure('source_changed'); }
    }
    const startingHref = location.href;
    const scrollAction = options.loadEarlier === true ? loadEarlier() : null;
    if (scrollAction) await new Promise(resolve => setTimeout(resolve, 400));
    if (location.href !== startingHref) return failure('page_changed');
    let detection = detect(); if (detection.errorCode === 'unsupported_page') return detection;
    const href = location.href, first = new Map((detection.candidates ?? []).map(normalize).map(message => [observationKey(message), message.text]));
    // A brief unchanged observation never proves completion or full history coverage.
    await new Promise(resolve => setTimeout(resolve, 650));
    if (location.href !== href) return failure('page_changed');
    detection = detect(); if (!detection.ok) return detection;
    const messages = detection.candidates.map(normalize), generating = Array.from(document.querySelectorAll(SELECTORS.streaming)).some(visible);
    const lastAssistant = messages.findLastIndex(message => message.role === 'assistant' || message.roleUnverified);
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index], previous = first.get(observationKey(message));
      if ((message.role === 'assistant' || message.roleUnverified) && (previous !== undefined && previous !== message.text || generating && index === lastAssistant)) message.streaming = 'generating';
      else message.streaming = previous === message.text ? 'stable_observed' : 'unknown';
    }
    const observedIds = new Set();
    for (const message of messages) if (message.sourceMessageId) { if (observedIds.has(message.sourceMessageId)) return failure('duplicate_source_ids', detection.candidates); observedIds.add(message.sourceMessageId); }
    const match = location.pathname.match(/\/c\/([^/]+)/), projectElement = document.querySelector('main [data-project-id],[id="thread"] [data-project-id]');
    const nativeProject = projectElement ? { id: projectElement.getAttribute('data-project-id'), name: projectElement.getAttribute('data-project-name') ?? null, status: 'provided', basis: 'DOM.data-project-id' } : { id: null, name: null, status: 'unknown', basis: null };
    const titleElement = document.querySelector('main [data-conversation-title],[id="thread"] [data-conversation-title]');
    const title = titleElement?.getAttribute('data-conversation-title') || document.title.replace(/\s*[-|–]\s*ChatGPT\s*$/, '').trim() || '未命名 ChatGPT 对话';
    const captureMode = detection.captureMode;
    const diagnostics = diagnose(messages, { nativeProject, pageStructure: detection.diagnostics.pageStructure, captureMode, scrollAction }), warnings = diagnostics.notices.map(notice => notice.reason);
    warnings.push('未展示的分支未采集；页面顺序不代表已取得完整父子关系。', '来源时间未知时保持未知；采集时间不会用作讨论发生时间。', 'DOM 中确认的代码 / 表格结构单独保存；没有取得的页面格式和公式表示不会推测还原。');
    if (nativeProject.status === 'unknown') warnings.push('无法确认 ChatGPT 原生项目，可在保存时手动记录归属。');
    return { ok: true, diagnostics, conversation: { title, titleBasis: titleElement ? 'DOM.data-conversation-title' : 'document.title', platform: 'openai-chatgpt', sourceConversationId: match?.[1] ?? null,
      identityBasis: match ? 'URL.c_path' : 'source_url_fallback', sourceUrl: href, sourceTime: { value: null, precision: 'unknown', source: null }, nativeProject,
      messages, graph: messages.filter(message => message.sourceMessageId).map(message => ({ key: message.sourceMessageId, messageKey: message.key, parent: message.sourceParentKey, children: [] })),
      paths: [{ key: 'observed-dom', label: captureMode === 'body_fallback' ? '本次已加载正文顺序（角色和轮次未确认）' : captureMode === 'mixed_markers' ? '当前页面阅读顺序（含未确认角色正文）' : '当前页面实际展示的阅读顺序', messageKeys: messages.map(message => message.key), status: 'observed_order', isCurrent: true }],
      currentPathKey: 'observed-dom', method: VERSION, adapterVersion: VERSION, capturedAt: new Date().toISOString(), diagnostics,
      scope: { kind: 'loaded_page', captureMode, history: 'unknown_unloaded', branches: 'not_collected', attachments: 'references_only', description: captureMode === 'body_fallback' ? '本次当前对话区域已加载的正文片段；说话人和完整问答轮次未确认，保存后可直接阅读。' : captureMode === 'mixed_markers' ? '已确认角色与未确认说话人的正文都已保留；未知部分不代表完整问答轮次，本次也不是完整历史声明。' : '本次页面已加载、展示且能够识别的内容；不是完整历史声明。', coverage: diagnostics.coverage,
        observedMessageCount: messages.length, sourceIdCount: diagnostics.counts.reliableSourceIds, generatingCount: diagnostics.counts.generating, unavailableBodyCount: diagnostics.counts.bodyUnavailable, missingReasons: diagnostics.notices.map(notice => notice.code) }, warnings } };
  }
  globalThis.__ACVN_CHATGPT__ = { detect, collect, normalize, diagnose, version: VERSION };
})();
