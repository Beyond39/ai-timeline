// Serialized by chrome.scripting into the user-selected ChatGPT page's MAIN
// world. All requests are read-only and same-origin. Credentials stay here;
// only a conversation graph or a fixed error code returns to the extension.
export async function readConversationData(options = {}) {
  const fail = code => ({ ok: false, errorCode: code });
  const key = value => { const url = new URL(value); const match = url.pathname.match(/\/(c|share)\/([a-zA-Z0-9_-]{1,128})(?:\/|$)/); return match ? `${url.origin}:${match[1]}:${match[2]}` : null; };
  if (location.protocol !== 'https:' || !['chatgpt.com', 'chat.openai.com'].includes(location.hostname)) return fail('unsupported_page');
  const startingURL = location.href, identity = key(startingURL);
  if (!identity) return fail('conversation_not_saved');
  if (!options.expectedSourceUrl || key(options.expectedSourceUrl) !== identity) return fail('source_changed');
  const changed = () => key(location.href) !== identity;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
  const request = async (path, headers = {}) => {
    if (changed()) throw new Error('page_changed');
    const response = await fetch(new URL(path, location.origin).href, { method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json', ...headers }, signal: controller.signal });
    if (changed()) throw new Error('page_changed');
    if (response.status === 429) throw new Error('capture_rate_limited');
    if ([401, 403].includes(response.status)) throw new Error('conversation_access_denied');
    if (!response.ok) throw new Error('conversation_data_unavailable');
    if (!/\bapplication\/json\b/i.test(response.headers.get('content-type') ?? '')) throw new Error('conversation_data_unavailable');
    if (Number(response.headers.get('content-length')) > 32 * 1024 * 1024) throw new Error('conversation_too_large');
    const text = await response.text();
    if (text.length > 32 * 1024 * 1024) throw new Error('conversation_too_large');
    if (changed()) throw new Error('page_changed');
    try { return JSON.parse(text); } catch { throw new Error('conversation_data_unavailable'); }
  };
  try {
    const match = new URL(startingURL).pathname.match(/\/(c|share)\/([^/]+)/), kind = match[1], id = match[2];
    const headers = {};
    if (kind === 'c') {
      const session = await request('/api/auth/session');
      if (typeof session.accessToken !== 'string' || !session.accessToken) return fail('conversation_access_denied');
      headers.Authorization = `Bearer ${session.accessToken}`;
      headers['X-Authorization'] = headers.Authorization;
      const account = document.cookie.match(/(?:^|;\s*)_account=([^;]+)/)?.[1];
      if (account) { try { headers['Chatgpt-Account-Id'] = decodeURIComponent(account); } catch { return fail('conversation_access_denied'); } }
    }
    const payload = await request(`/backend-api/${kind === 'share' ? 'share' : 'conversation'}/${encodeURIComponent(id)}`, headers);
    const data = payload.conversation ?? payload;
    if (!data || typeof data.mapping !== 'object' || Array.isArray(data.mapping) || !data.mapping || !data.current_node || !data.mapping[data.current_node]) return fail('conversation_data_incomplete');
    if (kind === 'c' && (data.conversation_id ?? data.id) != null && String(data.conversation_id ?? data.id) !== id) return fail('source_changed');
    if (data.has_missing_messages || data.is_partial || data.next_cursor) return fail('conversation_data_incomplete');
    const entries = Object.entries(data.mapping);
    if (!entries.length || entries.length > 20000) return fail('conversation_too_large');
    const mapping = Object.create(null), ids = new Set(); let messageCount = 0, hasQuestion = false;
    for (const [nodeId, node] of entries) {
      if (!node || typeof node !== 'object' || node.parent != null && !Object.hasOwn(data.mapping, node.parent) || !Array.isArray(node.children ?? [])) return fail('conversation_data_incomplete');
      if ((node.children ?? []).some(child => !Object.hasOwn(data.mapping, child) || data.mapping[child].parent !== nodeId)) return fail('conversation_data_incomplete');
      const message = node.message;
      if (message && (!['user', 'assistant', 'tool', 'function', 'system', 'developer'].includes(message.author?.role) || !message.id || ids.has(message.id))) return fail('conversation_roles_unavailable');
      if (message) { ids.add(message.id); messageCount++; hasQuestion ||= message.author.role === 'user'; }
      // Whitelist graph/message fields. Never return the auth session, headers,
      // cookies, or arbitrary top-level response data to the service worker.
      mapping[nodeId] = { id: nodeId, parent: node.parent ?? null, children: node.children ?? [], message: message ? {
        id: message.id, author: { role: message.author.role, name: message.author.name ?? null }, content: message.content,
        create_time: message.create_time ?? null, update_time: message.update_time ?? null, status: message.status ?? null, end_turn: message.end_turn ?? null,
        channel: message.channel ?? null, recipient: message.recipient ?? null,
        metadata: { attachments: message.metadata?.attachments ?? [], citations: message.metadata?.citations ?? [],
          content_references: message.metadata?.content_references ?? [], finish_details: message.metadata?.finish_details ?? null,
          is_visually_hidden_from_conversation: message.metadata?.is_visually_hidden_from_conversation === true }
      } : null };
    }
    // A graph can have multiple roots, but it cannot have a circular parent
    // chain. Memoize completed chains to validate a long conversation linearly.
    const complete = new Set();
    for (const nodeId of Object.keys(mapping)) {
      const chain = new Set(); let cursor = nodeId;
      while (cursor && !complete.has(cursor)) { if (chain.has(cursor)) return fail('conversation_data_incomplete'); chain.add(cursor); cursor = mapping[cursor]?.parent; }
      for (const member of chain) complete.add(member);
    }
    if (!messageCount || !hasQuestion) return fail('conversation_data_incomplete');
    // current_node from the response can lag a branch switch in the page.
    // Reconcile only stable message IDs in the actually displayed main area.
    // Scroll position is irrelevant: offscreen, loaded ancestors still count.
    let selectedNode = data.current_node, selectionBasis = 'response.current_node';
    const main = document.querySelector?.('main');
    const displayed = main?.querySelectorAll?.('[data-message-id][data-message-author-role]') ?? [];
    const nodeByMessage = new Map(Object.entries(mapping).filter(([, node]) => node.message).map(([nodeId, node]) => [node.message.id, nodeId]));
    const visibleNodes = [...new Set([...displayed].filter(element => !element.closest('[hidden],[aria-hidden="true"]') && element.getClientRects().length)
      .map(element => nodeByMessage.get(element.getAttribute('data-message-id'))).filter(Boolean))];
    if (visibleNodes.length) {
      const chain = end => { const result = new Set(); for (let cursor = end; cursor; cursor = mapping[cursor]?.parent) result.add(cursor); return result; };
      const selectedChain = chain(selectedNode);
      if (!visibleNodes.every(nodeId => selectedChain.has(nodeId))) {
        const ends = visibleNodes.filter(nodeId => visibleNodes.every(visible => chain(nodeId).has(visible)));
        if (ends.length !== 1) return fail('selected_branch_unavailable');
        selectedNode = ends[0]; selectionBasis = 'visible_message_id_chain';
      } else selectionBasis = 'visible_message_ids_confirm_response';
      // A visible generating control is explicit evidence. Never use a brief
      // unchanged body observation to prove the answer has finished.
      if (main.querySelector('[data-testid="stop-button"]') && mapping[selectedNode]?.message?.author.role === 'assistant') {
        mapping[selectedNode].message.opc_observation = { status: 'in_progress', endTurn: false, basis: 'visible_stop_control' };
      }
    }
    if (changed()) return fail('page_changed');
    return { ok: true, sourceUrl: startingURL, conversation: { id: data.conversation_id ?? data.id ?? id, title: typeof data.title === 'string' ? data.title : document.title,
      create_time: data.create_time ?? null, update_time: data.update_time ?? null, current_node: selectedNode, mapping, selection_basis: selectionBasis,
      project_id: data.project_id ?? null, source_url: startingURL }, messageCount, nodeCount: entries.length };
  } catch (error) {
    const codes = ['page_changed', 'capture_rate_limited', 'conversation_access_denied', 'conversation_data_unavailable', 'conversation_too_large'];
    return fail(error.name === 'AbortError' ? 'conversation_read_timeout' : codes.includes(error.message) ? error.message : 'conversation_data_unavailable');
  } finally { clearTimeout(timeout); }
}
