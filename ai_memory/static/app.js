const state = { dashboard: null, projects: [], projectId: null, tree: null, selected: null, preview: null, staged: null, evaluation: [], evaluationIndex: 0 };
const $ = (id) => document.getElementById(id);

async function request(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || body.error || "请求失败");
  return body;
}

function notice(message, bad = false) {
  const node = $("notice");
  node.textContent = message;
  node.classList.remove("hidden");
  node.style.borderColor = bad ? "#a53a32" : "#e8b44d";
  setTimeout(() => node.classList.add("hidden"), 4500);
}

function renderStats(counts) {
  const labels = { projects: "项目", conversations: "对话", qa_units: "Q/A 单元", topics: "主题", pending_documents: "待核对总结", pending_merges: "待判断归并" };
  $("stats").innerHTML = Object.entries(labels).map(([key, label]) => `<div class="stat"><strong>${counts[key] || 0}</strong><span>${label}</span></div>`).join("");
}

function renderTopics(filter = "") {
  const nodes = state.tree?.nodes || [];
  const term = filter.trim().toLowerCase();
  const groups = new Map();
  for (const node of nodes) {
    const parent = nodes.some(item => item.id === node.parent_id) ? node.parent_id : "root";
    groups.set(parent, [...(groups.get(parent) || []), node]);
  }
  const card = node => `<button class="topic ${state.selected === node.id ? "active" : ""}" data-id="${escapeHtml(node.id)}"><strong>${escapeHtml(node.title)} ${node.manual_indicator ? '<small title="人工修订">✎</small>' : ''}</strong><span>${node.fragment_count} 片段 · ${node.evidence_count} 证据${node.dirty ? " · 待重编译" : ""}</span></button>`;
  const branch = (parent, seen = new Set()) => (groups.get(parent) || []).filter(node => !seen.has(node.id)).map(node => {
    const next = new Set(seen); next.add(node.id);
    const children = branch(node.id, next);
    return children ? `<details class="tree-group" open><summary>${escapeHtml(node.title)}</summary>${card(node)}${children}</details>` : card(node);
  }).join("");
  $("topic-list").innerHTML = term ? nodes.filter(item => item.title.toLowerCase().includes(term)).map(card).join("") :
    `<details class="project-root" open><summary>${escapeHtml(state.tree?.title || "项目")}</summary>${branch("root")}</details>`;
  if (!nodes.length) $("topic-list").innerHTML = `<div class="tree-empty">尚无主题。导入对话后点击“编译主题树”。</div>`;
  document.querySelectorAll(".topic").forEach(node => node.addEventListener("click", () => selectTopic(node.dataset.id)));
}
async function renderMergeReviews() {
  const reviews = (await request("/v0/merge-reviews")).data;
  const ids = new Set((state.tree?.nodes || []).map(item => item.id));
  const shown = reviews.filter(item => ids.has(item.candidate_topic_id) && ids.has(item.suggested_topic_id));
  $("merge-review-list").innerHTML = shown.length ? `<strong>相似主题待判断</strong>` + shown.map(item =>
    `<div>${escapeHtml(item.candidate_title)} ↔ ${escapeHtml(item.suggested_title)}<br><button class="secondary merge-suggestion" data-id="${escapeHtml(item.id)}" data-source="${escapeHtml(item.candidate_topic_id)}" data-target="${escapeHtml(item.suggested_topic_id)}">确认合并</button><button class="secondary keep-suggestion" data-id="${escapeHtml(item.id)}">保持分开</button></div>`).join("") : "";
  document.querySelectorAll(".merge-suggestion").forEach(button => button.addEventListener("click", async () => {
    if (!confirm("确认把这两个主题合并？")) return;
    try {
      const proposal = await request(`/v0/projects/${encodeURIComponent(state.projectId)}/tree/proposals`, { method: "POST", body: JSON.stringify({ topic_id: button.dataset.source, action: "merge", target_topic_id: button.dataset.target }) });
      await request(`/v0/tree-proposals/${encodeURIComponent(proposal.id)}/resolve`, { method: "POST", body: JSON.stringify({ decision: "accept" }) });
      await load(); notice("已合并主题。");
    } catch (error) { notice(error.message, true); }
  }));
  document.querySelectorAll(".keep-suggestion").forEach(button => button.addEventListener("click", async () => {
    try { await request(`/v0/merge-reviews/${encodeURIComponent(button.dataset.id)}`, { method: "POST", body: JSON.stringify({ action: "keep_separate" }) }); await load(); notice("已记录保持分开。"); }
    catch (error) { notice(error.message, true); }
  }));
}
async function renderSemanticReviews() {
  const reviews = (await request(`/v0/projects/${encodeURIComponent(state.projectId)}/semantic-reviews`)).data;
  $("semantic-review-list").innerHTML = reviews.length ? `<strong>待复核主题 · ${reviews.length}</strong>` + reviews.map(item => {
    const candidate = JSON.parse(item.candidate_json);
    return `<div><strong>${escapeHtml(candidate.title)}</strong><p>${escapeHtml(item.reason)}</p><select data-review="${escapeHtml(item.id)}">${state.tree.nodes.map(node => `<option value="${escapeHtml(node.id)}">${escapeHtml(node.title)}</option>`).join("")}</select><div class="review-actions"><button class="secondary semantic-attach" data-id="${escapeHtml(item.id)}">归入所选</button><button class="secondary semantic-create" data-id="${escapeHtml(item.id)}">新建主题</button><button class="mini semantic-ignore" data-id="${escapeHtml(item.id)}">忽略</button></div></div>`;
  }).join("") : "";
  const resolve = async (id, action) => {
    try {
      const topic_id = action === "attach_existing" ? document.querySelector(`select[data-review="${CSS.escape(id)}"]`).value : null;
      await request(`/v0/semantic-reviews/${encodeURIComponent(id)}/resolve`, { method: "POST", body: JSON.stringify({ action, topic_id }) });
      await load(); notice("复核决定已保存。");
    } catch (error) { notice(error.message, true); }
  };
  document.querySelectorAll(".semantic-attach").forEach(button => button.addEventListener("click", () => resolve(button.dataset.id, "attach_existing")));
  document.querySelectorAll(".semantic-create").forEach(button => button.addEventListener("click", () => resolve(button.dataset.id, "create_new")));
  document.querySelectorAll(".semantic-ignore").forEach(button => button.addEventListener("click", () => resolve(button.dataset.id, "ignore")));
}

async function selectTopic(id) {
  const topic = await request(`/v0/projects/${encodeURIComponent(state.projectId)}/tree/topics/${encodeURIComponent(id)}`);
  state.selected = topic.id;
  renderTopics($("topic-search").value);
  $("empty-state").classList.add("hidden");
  $("topic-detail").classList.remove("hidden");
  $("detail-title").textContent = topic.title;
  $("detail-summary").textContent = topic.summary;
  $("detail-extension").textContent = topic.ai_extension || "本次没有生成额外扩展。";
  $("detail-status").textContent = topic.document?.review_status || topic.status;
  $("context-output").classList.add("hidden");
  $("fragment-list").innerHTML = topic.fragments.map(item => `<div><strong>${escapeHtml(item.conversation_title)}</strong><p>${escapeHtml(item.text)}</p><span class="source">${item.evidence_count} 条原句</span><button class="mini change-fragment" data-id="${escapeHtml(item.id)}">修改归属</button></div>`).join("") || `<p class="muted">暂无片段</p>`;
  document.querySelectorAll(".change-fragment").forEach(button => button.addEventListener("click", () => openTopicAction("assign", button.dataset.id)));
  $("topic-qa-list").innerHTML = topic.qa_units.map(item => `<div><strong>${escapeHtml(item.question_text)}</strong><p>${escapeHtml(item.summary)}</p></div>`).join("") || `<p class="muted">暂无相关 Q/A</p>`;
  const insightLabels = { claims: "主张", decisions: "决策", open_questions: "待解决" };
  $("insight-list").innerHTML = topic.insights.map(item => `<div><strong>${insightLabels[item.kind] || escapeHtml(item.kind)}</strong><p>${escapeHtml(item.text)}</p><span class="source">证据：${escapeHtml(item.evidence_ids.join("、"))}</span></div>`).join("") || `<p class="muted">暂无经证据绑定的主张、决策或待解决问题。</p>`;
  $("evidence-detail").classList.add("hidden");
  $("evidence-list").innerHTML = topic.evidence.map((item, index) => `<button class="evidence" data-message="${escapeHtml(item.message_id)}" data-conversation="${escapeHtml(item.conversation_id)}"><span class="badge">E${index + 1} · ${escapeHtml(item.role)}</span><p>${escapeHtml(item.text)}</p><span class="source">${escapeHtml(item.conversation_title)}</span></button>`).join("") || `<p class="muted">没有证据。</p>`;
  document.querySelectorAll(".evidence").forEach(button => button.addEventListener("click", async () => {
    try {
      const message = await request(`/v0/messages/${encodeURIComponent(button.dataset.message)}`);
      const messages = (await request(`/v0/conversations/${encodeURIComponent(message.conversation_id)}/messages`)).data;
      $("evidence-detail").innerHTML = `<h3>${escapeHtml(message.conversation_title)}</h3><p class="source">原始对话 · ${escapeHtml(message.source_path || "粘贴输入")}</p>` + messages.map(item => `<div class="original-message ${item.id === message.id ? "highlight" : ""}"><strong>${escapeHtml(item.role)}</strong><p>${escapeHtml(item.text)}</p></div>`).join("");
      $("evidence-detail").classList.remove("hidden");
    } catch (error) { notice(error.message, true); }
  }));
}

function escapeHtml(value) { const node = document.createElement("div"); node.textContent = value || ""; return node.innerHTML; }

async function loadSupportingViews() {
  const project = encodeURIComponent(state.projectId);
  const [qa, timeline] = await Promise.all([request(`/v0/qa-units?project_id=${project}&limit=20`), request(`/v0/timeline?project_id=${project}&limit=30`)]);
  $("qa-list").innerHTML = qa.data.map(item => `<div class="qa"><strong>${escapeHtml(item.question_text)}</strong><p>${escapeHtml(item.summary)}</p><span class="source">${escapeHtml(item.project_title)} / ${escapeHtml(item.conversation_title)} · ${escapeHtml(item.topics.join("、"))}</span></div>`).join("") || `<p class="muted">暂无 Q/A 单元。</p>`;
  $("timeline").innerHTML = timeline.data.map(item => { const numeric = typeof item.occurred_at === "number"; const date = item.occurred_at ? new Date(numeric ? item.occurred_at * 1000 : item.occurred_at) : null; const label = date && !Number.isNaN(date.valueOf()) ? date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) : "记录"; return `<div class="event"><time>${label}</time><div><strong>${escapeHtml(item.conversation_title || item.label)}</strong><p>${escapeHtml(item.detail)}</p></div></div>`; }).join("") || `<p class="muted">暂无时间线。</p>`;
}

async function load() {
  try {
    state.dashboard = await request("/v0/dashboard");
    renderStats(state.dashboard.counts);
    state.projects = (await request("/v0/projects")).data;
    if (!state.projects.some(item => item.id === state.projectId)) state.projectId = state.projects[0]?.id || null;
    $("project-select").innerHTML = state.projects.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join("");
    if (!state.projectId) { state.tree = null; renderTopics(); $("empty-state").querySelector("h2").textContent = "创建第一个记忆项目"; return; }
    $("project-select").value = state.projectId;
    state.tree = await request(`/v0/projects/${encodeURIComponent(state.projectId)}/tree`);
    renderTopics();
    await renderSemanticReviews();
    await renderMergeReviews();
    await loadSupportingViews();
  } catch (error) { notice(error.message, true); }
}

async function review(action) {
  if (!state.selected) return;
  try {
    const result = await request("/v0/review", { method: "POST", body: JSON.stringify({ document_or_topic: state.selected, action }) });
    $("detail-status").textContent = result.review_status;
    notice(action === "approve" ? "已记录：这份总结可以使用。" : "已退回：这份总结需要继续核对。");
    await load();
  } catch (error) { notice(error.message, true); }
}

$("topic-search").addEventListener("input", event => renderTopics(event.target.value));
$("project-select").addEventListener("change", async event => {
  state.projectId = event.target.value; state.selected = null;
  $("topic-detail").classList.add("hidden"); $("empty-state").classList.remove("hidden"); await load();
});
$("extractor-select").addEventListener("change", async event => {
  const semantic = event.target.value === "openai";
  $("model-id").classList.toggle("hidden", !semantic);
  const status = await request("/v0/provider-status");
  $("provider-help").classList.toggle("hidden", !semantic || status.semantic_available);
  if (status.model && !$("model-id").value) $("model-id").value = status.model;
});
$("approve").addEventListener("click", () => review("approve"));
$("reject").addEventListener("click", () => review("reject"));
$("context").addEventListener("click", async () => {
  try { const value = await request(`/v0/context/${encodeURIComponent(state.selected)}`); $("context-output").textContent = value.content; $("context-output").classList.remove("hidden"); }
  catch (error) { notice(error.message, true); }
});
let pendingTopicAction = null;
function openTopicAction(action, fragmentId = null) {
  if (!state.projectId || (action !== "create" && action !== "assign" && !state.selected)) return;
  pendingTopicAction = { action, fragmentId, selectedTopic: state.selected };
  const labels = { rename: "重命名主题", move: "移动主题", merge: "合并主题", assign: "修改片段归属", create: "新建主题" };
  $("topic-action-title").textContent = labels[action];
  const nameField = $("topic-action-name"), targetField = $("topic-action-target");
  nameField.classList.toggle("hidden", !["rename", "create"].includes(action));
  targetField.classList.toggle("hidden", ["rename", "create"].includes(action));
  nameField.value = action === "rename" ? (state.tree.nodes.find(item => item.id === state.selected)?.title || "") : "";
  if (!["rename", "create"].includes(action)) {
    const nodes = state.tree.nodes.filter(item => action === "assign" || item.id !== state.selected);
    targetField.innerHTML = (action === "move" ? '<option value="">根主题</option>' : "") + nodes.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join("");
  }
  $("topic-action-dialog").showModal();
}
$("topic-action-save").addEventListener("click", async () => {
  if (!pendingTopicAction) return;
  const { action, fragmentId, selectedTopic } = pendingTopicAction;
  const title = $("topic-action-name").value.trim(), target = $("topic-action-target").value;
  if (["rename", "create"].includes(action) && !title) return notice("请输入主题名称。", true);
  if (["merge", "assign"].includes(action) && !target) return notice("请选择主题。", true);
  try {
    if (action === "assign") {
      await request(`/v0/projects/${encodeURIComponent(state.projectId)}/assign-fragment`, { method: "POST", body: JSON.stringify({ fragment_id: fragmentId, topic_id: target }) });
      await load(); if (selectedTopic) await selectTopic(selectedTopic);
    } else if (action === "create") {
      await request(`/v0/projects/${encodeURIComponent(state.projectId)}/topics`, { method: "POST", body: JSON.stringify({ title }) }); await load();
    } else {
      const payload = { topic_id: selectedTopic, action };
      if (action === "rename") payload.title = title;
      if (action === "move") payload.parent_topic_id = target || null;
      if (action === "merge") payload.target_topic_id = target;
      const proposal = await request(`/v0/projects/${encodeURIComponent(state.projectId)}/tree/proposals`, { method: "POST", body: JSON.stringify(payload) });
      await request(`/v0/tree-proposals/${encodeURIComponent(proposal.id)}/resolve`, { method: "POST", body: JSON.stringify({ decision: "accept" }) });
      await load(); if (action !== "merge") await selectTopic(selectedTopic);
      else { state.selected = null; $("topic-detail").classList.add("hidden"); $("empty-state").classList.remove("hidden"); }
    }
    $("topic-action-dialog").close(); pendingTopicAction = null; notice("修改已保存。");
  } catch (error) { notice(error.message, true); }
});
$("rename-topic").addEventListener("click", () => openTopicAction("rename"));
$("move-topic").addEventListener("click", () => openTopicAction("move"));
$("merge-topic").addEventListener("click", () => openTopicAction("merge"));
$("new-topic").addEventListener("click", () => state.projectId ? openTopicAction("create") : notice("先导入一段对话。", true));
$("report-issue").addEventListener("click", () => { if (state.selected) $("issue-dialog").showModal(); });
$("issue-save").addEventListener("click", async () => {
  if (!state.selected) return;
  const correction = $("issue-correction").value.trim();
  if (!correction) return notice("请写下问题说明。", true);
  try {
    await request(`/v0/projects/${encodeURIComponent(state.projectId)}/issues`, { method: "POST", body: JSON.stringify({ object_id: state.selected, issue_type: $("issue-type").value, current_result: $("detail-summary").textContent, correction }) });
    $("issue-dialog").close(); $("issue-correction").value = ""; notice("问题已记录。");
  } catch (error) { notice(error.message, true); }
});
$("refresh").addEventListener("click", async () => {
  if (!state.projectId) { notice("请先导入一个项目。", true); return; }
  try {
    if ($("extractor-select").value === "openai") {
      const provider = await request("/v0/provider-status");
      if (!provider.semantic_available) { $("provider-help").classList.remove("hidden"); throw new Error("请先配置 OPENAI_API_KEY，或选择 Offline 模式。"); }
    }
    const job = await request(`/v0/projects/${encodeURIComponent(state.projectId)}/compile`, {
      method: "POST", body: JSON.stringify({ extractor: $("extractor-select").value, model: $("model-id").value })
    });
    $("refresh").disabled = true;
    $("compile-meter").classList.remove("hidden");
    while (true) {
      const status = await request(`/v0/compile-jobs/${encodeURIComponent(job.id)}`);
      const phases = { queued: "准备对话", segmenting: "切分片段", analyzing: "抽取主题", matching: "匹配主题", compiling: "整理知识", building_tree: "构建主题树", done: "完成" };
      $("compile-progress").textContent = `${phases[status.phase] || status.phase} ${status.total ? `${status.current} / ${status.total}` : ""}`;
      $("compile-meter").firstElementChild.style.width = `${status.total ? Math.max(6, Math.round(status.current / status.total * 100)) : status.phase === "done" ? 100 : 18}%`;
      if (status.status === "failed") throw new Error(`编译在 ${phases[status.failed_phase] || status.failed_phase || "分析"} 阶段失败：${status.error}。原始数据已保留，可以重试。`);
      if (status.status === "completed") break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    $("compile-progress").textContent = "编译完成"; await load(); notice("项目主题树已更新，请核对摘要和原句。");
  } catch (error) { notice(error.message, true); }
  finally { $("refresh").disabled = false; $("compile-meter").classList.add("hidden"); }
});
$("paste-toggle").addEventListener("click", () => $("paste-panel").classList.toggle("hidden"));
$("preview-paste").addEventListener("click", async () => {
  try {
    const text = $("paste-text").value.trim(); if (!text) throw new Error("请先粘贴对话原文。");
    const result = await request("/v0/paste-preview", { method: "POST", body: JSON.stringify({ text, title: $("paste-title").value.trim(), project_title: $("new-project-title").value.trim() || undefined }) });
    showStagedPreview(result);
  } catch (error) { notice(error.message, true); }
});
$("upload-file").addEventListener("change", async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const response = await fetch("/v0/upload-preview", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name), "X-Project-Title": encodeURIComponent($("new-project-title").value.trim()) }, body: file });
    const result = await response.json(); if (!response.ok) throw new Error(result.detail || result.error);
    showStagedPreview(result);
  } catch (error) { notice(error.message, true); }
});
function showStagedPreview(result) {
  state.staged = result.token;
  $("preview-result").innerHTML = `<strong>预览 · ${escapeHtml(result.filename)}</strong><p>${result.conversation_count} 条对话 · ${result.message_count} 条消息 · 约 ${result.approx_tokens} tokens</p><p>${escapeHtml(result.sample_titles.join("、"))}</p><p class="muted">${escapeHtml(result.warnings.join("；"))}</p>`;
  $("preview-result").classList.remove("hidden"); $("confirm-staged").classList.remove("hidden");
}
$("confirm-staged").addEventListener("click", async () => {
  try {
    const result = await request("/v0/staged-import", { method: "POST", body: JSON.stringify({ token: state.staged, project_id: state.projectId }) });
    state.projectId = result.project_id; state.staged = null;
    $("confirm-staged").classList.add("hidden"); $("preview-result").classList.add("hidden");
    await load(); notice("原始对话已导入。现在可以编译主题树。");
  } catch (error) { notice(error.message, true); }
});
$("preview-import").addEventListener("click", async () => {
  try {
    const path = $("source-path").value.trim(); if (!path) throw new Error("请输入本机文件或文件夹路径");
    state.preview = await request("/v0/import-preview", { method: "POST", body: JSON.stringify({ path }) });
    $("preview-result").classList.remove("hidden");
    $("preview-result").innerHTML = `<strong>${state.preview.file_count} 个文件 · ${state.preview.conversation_count} 条对话 · ${state.preview.message_count} 条消息 · 约 ${state.preview.approx_tokens} tokens</strong>` +
      state.preview.files.map(item => `<p>${escapeHtml(item.status)} · ${escapeHtml(item.source_type)} · ${escapeHtml(item.duplicate_status)} · ${escapeHtml(item.path)}<br>${item.conversation_count} 条对话 · ${item.message_count} 条消息 · ${item.text_characters} 字符<br>${escapeHtml(item.sample_titles.join("、"))}<br>${escapeHtml([...item.warnings, ...item.errors].join("；"))}</p>`).join("");
    $("confirm-import").classList.toggle("hidden", state.preview.files.some(item => item.errors.length));
  } catch (error) { notice(error.message, true); }
});
$("confirm-import").addEventListener("click", async () => {
  try {
    await request("/v0/import", { method: "POST", body: JSON.stringify({ path: $("source-path").value.trim() }) });
    state.preview = null; $("confirm-import").classList.add("hidden"); await load(); notice("导入完成，可以编译项目。");
  } catch (error) { notice(error.message, true); }
});
const evaluationLabels = { fragment_correct: "片段边界正确", topic_correct: "主题归属正确", evidence_correct: "证据可追溯", summary_supported: "摘要有证据支持", duplicate_topic: "存在重复主题" };
function renderEvaluation() {
  const item = state.evaluation[state.evaluationIndex];
  if (!item) { $("evaluation-dialog").close(); notice("抽查已完成，评价已保存。"); return; }
  $("evaluation-count").textContent = `${state.evaluationIndex + 1} / ${state.evaluation.length}`;
  $("evaluation-source").textContent = item.conversation_title;
  $("evaluation-text").textContent = item.text;
  $("evaluation-fields").innerHTML = Object.entries(evaluationLabels).map(([key, label]) => `<label>${label}<select data-key="${key}"><option value="">未评</option><option value="true" ${item[key] === 1 ? "selected" : ""}>是</option><option value="false" ${item[key] === 0 ? "selected" : ""}>否</option></select></label>`).join("");
  $("evaluation-note").value = item.note || "";
}
$("evaluate").addEventListener("click", async () => {
  if (!state.projectId) return notice("先导入项目。", true);
  try { state.evaluation = (await request(`/v0/projects/${encodeURIComponent(state.projectId)}/evaluation-queue?limit=20`)).data; state.evaluationIndex = 0;
    if (!state.evaluation.length) return notice("还没有片段，请先编译。", true);
    renderEvaluation(); $("evaluation-dialog").showModal();
  } catch (error) { notice(error.message, true); }
});
$("evaluation-save").addEventListener("click", async () => {
  const item = state.evaluation[state.evaluationIndex];
  const payload = { note: $("evaluation-note").value };
  document.querySelectorAll("#evaluation-fields select").forEach(select => { payload[select.dataset.key] = select.value === "" ? null : select.value === "true"; });
  try { await request(`/v0/projects/${encodeURIComponent(state.projectId)}/evaluate/${encodeURIComponent(item.id)}`, { method: "POST", body: JSON.stringify(payload) }); state.evaluationIndex++; renderEvaluation(); }
  catch (error) { notice(error.message, true); }
});
load();
