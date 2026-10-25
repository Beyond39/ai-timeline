# OPC Timeline 本地知识引擎：代码、验证与限制

日期：2026-10-23（Asia/Shanghai）。代码根目录：`apps/navigator-extension/`。引擎版本 `knowledge-1`；扩展沿用已有 `1.6.3`，本轮没有发布、提交或 Push。所有问答样例和性能数据来自独立合成数据。

## 1. 实际数据流与入口

```text
workspace.html / sidepanel.html → ui/app.js → ui/opc.js:OPCTimeline
    → ui/knowledge.js:KnowledgePanel.open / analyze
    → runtime RPC knowledgeDocuments → storage/knowledge-documents.js
    → opcState / workspaceScope + 既有搜索索引 + 原始 versions
    → Analysis Documents（统一 Card ID，不复制来源卡片）
    → analysis/knowledge-worker.js（页面专属 Worker）
        → 主题 TF-IDF / 词组 → 标签候选
        → 原始回答版本 → Markdown 分块 → MMR 摘录
        → 用户开启时：BGE CLS 向量 + 持久缓存
        → Lexical / Semantic / Hybrid → 受约束分组 / 代表问题
    → 独立知识 IndexedDB；Workspace 主题沿用 workspaceWrite
    → 既有统一 Reader / releaseWrite 托盘 / ContextDeploy
```

普通 Project 可从时间线的“本地知识整理”打开。已有 Project Workspace 的“知识整理 / Topics”使用同一个控制器，并把生成的候选目录保存到现有 Workspace topics/assignments。原有手动整理、关联 Conversation、主题改名、移动和 Deploy 继续复用。

## 2. 新增文件及函数

| 路径（相对扩展根目录） | 主要职责 |
|---|---|
| `analysis/knowledge-text.js` | `normalize`、`phrases`、`themeFields`、`semanticInput`、`buildTfidf`、`sparseCosine`、`keywords` |
| `analysis/knowledge-keypoints.js` | `markdownBlocks`、`extractKeypoints`、`verifyFragment` |
| `analysis/bge.js` | `BGE` 固定配置、`getExtractor`、`embedDocuments`、`embeddingKey`、`validEmbedding`、`importModelFile` |
| `analysis/knowledge-analysis.js` | `analyzeKnowledge`、`denseCosine`、`hybridScore`、内部 `normalizedDot` |
| `analysis/knowledge-worker.js` | 分析/进度/实际模式/失败降级；不依赖后台 Service Worker 持有模型 |
| `storage/knowledge-documents.js` | `knowledgeDocuments`：只读当前范围、原始回答版本、人工特征与哈希 |
| `storage/knowledge-cache.js` | `knowledgeDB`、`cacheGet/Put/Remove`、`updateReview`、`pruneEmbeddings` |
| `ui/knowledge.js` | `KnowledgePanel`：知识目录、模型同意、取消、来源核对、Reader 审核、Deploy |
| `vendor/bge/` | 固定的 Transformers.js、WASM、许可证和 tokenizer/config；不包含 ONNX 权重 |
| `validation/knowledge-fixtures.mjs` | 三主题、多 Conversation 的纯合成问答 |
| `validation/knowledge-wasm-failure-worker.js` | 测试专用真实 WASM fetch 失败注入，不打包 |
| `scripts/validate-knowledge.mjs` | CP1–4 单元测试，已接入正常测试入口 |
| `scripts/test-bge-mv3.mjs` | 真 Chrome 扩展推理、缓存、三个模式的诊断 |
| `scripts/test-knowledge-mv3.mjs` | 100 卡 UI、来源、审核、重导入、缓存损坏和失败恢复 |
| `scripts/benchmark-knowledge.mjs` / `benchmark-bge-mv3.mjs` | Node 和真实 MV3 Worker 性能，明确区分环境 |
| `scripts/evaluate-knowledge.mjs` | 精确原文核对与待人工标注表，不虚构检索准确率 |

集成修改仅涉及 `storage/repository.js` 的只读 RPC、`domain/project-workspace.js` 的 `knowledgeOrganize`、`ui/opc.js` 的入口/Reader/生命周期钩子、`ui/project-workspace.js` 的入口、少量 CSS、CSP 与构建检查。**没有修改 Timeline 缩放算法、Canvas 拖动/连线算法或原数据库版本。**

## 3. 分析输入与原始资料保护

每个 Analysis Document 有 cardId、conversationId、sourceProjectId、scopeId、question、answer、answerSources、customTitle、manualTags、sourceMetadata、sourceHash、preprocessingVersion。

`knowledgeDocuments()` 复用 `opcState()`；虚拟 Workspace 通过 Conversation 间接关联真实卡片。隐藏、归档、失效和无法在既有索引定位的卡片不参与。回答片段携带真实 messageId/versionId/text。sourceHash 排除 scopeId，因此同一来源在不同 Workspace 中保持相同身份/来源哈希；Embedding 键也排除范围。

主题输入分开加权：问题 3、不同于问题的人工标题 2、人工标签 4。完全重复的标题不计第二次。整个长回答不参与主题向量或单次 BGE 输入；回答只参与抽取和缺乏主题词时的保守关键词候选。清洗从不写回 Question/Answer。

## 4. 中文 n-gram 与可读词组

统计特征复用 `domain/search-service.js:tokenize()`：中文字符 2/3-gram，英文技术 Token，包括 C++、TF-IDF、IndexedDB 等。它与原 BM25 搜索共享 Tokenization，**没有把 BM25 分数冒充 TF-IDF**。

展示层 `phrases()` 使用既有 `readableTerms()`、浏览器 Intl.Segmenter、原文连续词组、技术标识符与停用表达过滤。中文完整词组按分词边界合并，保留“性/化/型”等后缀，不用任意字符窗口作为标签。Context Pack 保留为完整术语。只展示原文/人工字段中可核对的少量词组；无可靠内容可返回零个标签。词组规则不包含特定测试主题词典。

## 5. TF-IDF 的实际公式

对于按字段权重累加的计数 c(t,d)：

```text
TF(t,d) = log(1 + c(t,d))
DF(t) = 包含 t 的文档数量
IDF(t) = log((N + 1)/(DF(t) + 1)) + 1
w(t,d) = TF(t,d) × IDF(t)
v(t,d) = w(t,d) / sqrt(sum_t w(t,d)^2)
```

TF 采用 log1p，避免加权计数小于 1 时出现负的 1+log(TF)。稀疏向量使用 Map。`sparseCosine()` 遍历较小向量并做内积；零向量相似度为零。关键词综合完整词权重和其 n-gram 权重，去掉相互包含的重复候选；已有人工标签按完整字符串优先，最多 5 个。

## 6. 抽取式知识片段与 MMR

`markdownBlocks()` 直接遍历原始版本字符串，保留 UTF-16 start/end/exactText；识别章节标题、段落、引用与列表续行，跳过完整或未闭合代码块/显示公式。候选过滤过短、过长、表格、引用、明确的假设/反例章节、口语模板和未配对数学/代码标记。代码或公式为主的回答可以没有自然语言摘录。

实际评分：

```text
R = .55 × cosine(question, candidate)
  + .25 × min(1, readable_term_count/8)
  + .20 × min(1, candidate_length/100)
MMR = lambda × R - (1-lambda) × max_similarity_to_selected
默认 lambda=.72，minScore=.14，最多 4 个，不强制填满。
```

这些是可配置工程起点，不是人工评估得到的最优值。“总结/因此”不提供可靠性加分。保留的完整否定句不会被改成肯定句。摘录始终标记“原文摘录，待核对上下文”，不称为用户已确认的决定。

## 7. 精确来源与 Reader

`verifyFragment()` 要求当前 messageId、versionId 匹配，且 `source.text.slice(start,end) === exactText`。NFKC 后的偏移从不用于原文高亮。Reader 的证据面板展示原始版本的局部上下文及精确 `<mark>`；它不在 Markdown 渲染后的不同文本节点中猜测位置。来源变化时禁用采用，历史已确认摘录仍保留。

## 8. 真实 BGE 配置

- 模型：`Xenova/bge-small-zh-v1.5`，基础模型 `BAAI/bge-small-zh-v1.5`。
- 固定 revision：`75c43b069aac4d136ba6bc1122f995fedcfd2781`。
- Transformers.js 2.17.2；ONNX Runtime Web 1.14.0；WASM 单线程，不使用 WebGPU。
- quantized ONNX 文件：24,010,842 字节；SHA-256 `15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc`。
- **中文 small 输出维度是 512**；max_position_embeddings/model_max_length 均为 512。
- `feature-extraction` 的 `pooling:'cls', normalize:true`：已核对发布包源码，取 last_hidden_state 的第一个 Token，再做 L2，不重复池化。
- tokenizer 自动按其 512 Token 限制截断；编码前记录原 Token 数与 truncated 数量。没有依赖 v2 Pipeline 不支持的 max_length 参数来控制长度。
- 输入只包含问题、不同的人工标题与人工标签；对称问题相似性不添加只适用于 query-to-passage 检索的 instruction。

运行时校验维度、有限数值与范数。向量是实际推理结果，没有随机/Mock 向量。余弦相似度不是概率。

## 9. MV3、下载与离线方式

`vendor/bge` 中 JS/WASM 经过哈希校验并随扩展打包；所有可执行资源均来自扩展自身。CSP 增加 `'wasm-unsafe-eval'`、self 与 Hugging Face 数据来源；没有增加 Chrome permissions/host_permissions。不是从 CDN 执行 JavaScript/WASM。

默认不创建模型、不下载权重。用户点击“开启语义增强”，阅读模型/大小/本机运行说明并确认后才开始。初次在线权重下载在本机测试中遭遇 network error，**没有宣称这条路径已成功**；加载超过 120 秒会失败并回退。用户可通过“导入离线模型”选择官方同版本 `model_quantized.onnx`，完整校验 SHA-256 后写入 Cache API。tokenizer/config 已打包，离线权重导入后的真实推理已验证。

模型下载地址：[固定版本 ONNX](https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/75c43b069aac4d136ba6bc1122f995fedcfd2781/onnx/model_quantized.onnx)。不要把模型权重目录或用户资料上传到远端。官方编码依据：[BAAI 模型说明](https://huggingface.co/BAAI/bge-small-zh-v1.5)、[Xenova ONNX 模型](https://huggingface.co/Xenova/bge-small-zh-v1.5)。

## 10. 缓存键与失效

`embeddingKey()` = SHA-256(cardId、完整 BGE 配置、预处理版本、semanticInput 的 SHA-256)。完整配置包含 modelId、revision、CLS/L2、量化、维度和运行时版本。不同范围但相同输入可复用。标题、人工标签或问题改变会失效；回答改变而主题输入未变不会重复编码。

损坏/错误维度/非有限/范数异常的缓存不使用，并通过真实模型重算。`pruneEmbeddings(5000)` 只保留最近写入的 5000 条向量；当前策略是按写入时间清理，不宣称严格 LRU。模型原始数据使用 Cache API 的 transformers-cache，向量使用 IndexedDB。

## 11. Hybrid、相关问题与主题

`hybridScore()`：S = alpha × lexical + (1-alpha) × semantic，默认 alpha=.4。Semantic 保留 [-1,1] 的原始余弦范围，不转换成概率。不存在向量时 Semantic/Hybrid 不冒充成功：Worker 保存 requestedMode、实际 mode 和 semanticError，UI 显示 Semantic Unavailable / Lexical。

相关问题排除自身、按真实 Card ID 去重并稳定排序，提供来源与“关键词相关/语义相关/混合推荐”；显示层不用百分比。初始相关性下限分别为 .08/.45/.28，仍需人工标注校准。

主题采用确定性的 leader clustering + complete-link 准入：新卡与现有组内每张卡都达到阈值才加入；默认 Lexical .32、Semantic .7、Hybrid .45，每组最多 80 张。避免 A~B、B~C 的连通链把 A/C 强行合组。重复问题、零信息与单卡保留未分类。没有固定主题数量。

Labeler 汇总主题内可读关键词的 TF-IDF 得分，技术标识符有轻微可解释优先权；最多两个词组构成短标题。无可靠词组则“待命名主题”。代表问题按组内平均相关性选择真实 Card ID，最多 3 张。**当前未实现 c-TF-IDF 或 average-linkage；不要将本实现称为它们。**

## 12. 保存方式与人工结果隔离

原库 `ai-conversation-visual-navigator` 仍为 v9，没有迁移或清库。新增独立库 `opc-knowledge-engine-v1` v1：

- runs：按分析 scope 保存派生标签、摘录、相关项和候选分组，不复制原始卡片。
- embeddings：按完整版本键保存数值向量，不存问题全文。
- reviews：按真实 Card ID 保存逐项 accepted/rejected 和快照；普通 Project 的人工主题覆盖另用 `topics:<scope>`。

manualTags 继续来自 qaMetadata.tags；suggestedTags 来自 runs.cards；acceptedSuggestedTags/rejectedSuggestedTags 由 reviews 中逐项状态派生。手动标题和标签不被算法写回。相同来源/算法下已拒绝项保留在历史中，不重新当作未审核建议。已确认项保留快照，重新生成、取消或重导入不清除。

`updateReview()` 在**同一个** IndexedDB readwrite 事务里读取、检查 revision、修改并写入，拒绝过期编辑。虚拟 Workspace 的主题和人工成员沿用现有 revision、manualCardIds 和 mutation 队列；普通 Project 的主题覆盖也有 revision。Topic membership 不生成任何 Canvas 人工边。

已有原库备份不包含这个独立知识库的 reviews/runs/embeddings。浏览器清除全部扩展存储或跨 Profile 恢复时，需要另外保留此库；本轮没有扩展现有备份/ID 重映射协议。这是明确的剩余工作，不等于重新导入会丢审核。

## 13. 页面生命周期与交互

CPU 工作在独立 Worker，不放到可能休眠的 MV3 Service Worker。进度包括模型文件、编码计数和抽取计数。取消、关闭知识面板、页面关闭和控制器销毁终止 Worker。切换到另一个 Project 时取消旧范围；迟到的分析/读取响应通过 epoch、scope 和 corpusHash 核验。

知识面板使用非模态 dialog，允许分析期间点击 Timeline。只有“开启语义增强”的确认框等真正需要决定的操作使用现有模态对话框。关闭按钮和 Esc 复用已有 panel-close；不重置 Zoom/Canvas。Deploy 使用现有 releaseWrite tray add，真实问题和回答保持原样，可勾选/取消。

## 14. 时间与空间复杂度

令 N 为卡数，T 为分词总量，F 为单卡稀疏特征，D=512。TF-IDF 约 O(T)，稀疏存储约 O(T)；词汇两两比较约 O(N²F)，语义约 O(N²D)。Complete-link leader 在每卡至多检查所有既有成员，总体 O(N²)；矩阵存储 Lexical 8N² 字节，Semantic/Hybrid 12N² 字节。不是可无限扩展的向量数据库方案。

首版单次限制 2000 张。1000 张 Hybrid 矩阵实际 12 MB；这不是浏览器总内存。提取为每卡的候选排序/MMR，超长段落保守跳过。性能测试发现重复做向量有限性/范数校验会放大两两比较开销，已改成每向量验证一次后进行内积。

## 15. 实测性能

真实 Chrome 152.0.7977.65，Windows，本机 WASM。`dist/KNOWLEDGE_BGE_PERFORMANCE.json` 为最终词组逻辑和已缓存向量的测量；有并发测试负载，不是严格实验室基准。单位 ms；算法总计不包含向量缓存读取。

| Q/A | Lexical 总计 | Hybrid 算法总计 | Hybrid 向量缓存 | Hybrid 两两比较 | Hybrid 聚类 |
|---:|---:|---:|---:|---:|---:|
|100|178.1|183.9|41.0|19.5|1.6|
|300|519.6|596.1|99.9|114.9|5.6|
|1000|2032.9|3150.9|307.4|1280.9|15.5|

首次导入权重后的三句独立验证：模型初始化 570 ms、推理 79 ms、第二遍 3/3 缓存约 2.8 ms。100 张真实导入合成 Q/A 首遍编码约 2.3 s，模型初始化约 .57 s，含持久化约 3.0 s；期间真实鼠标缩放和节点坐标变化通过。递增批次的首次推理报告另存 `KNOWLEDGE_BGE_PERFORMANCE_BEFORE.json`：300 批新增 200 条约 4.50 s，1000 批新增 700 条约 16.18 s；该报告的相似度部分是优化前数据，不能与最终表混用。

Node 100/300/1000 的完整数据在 `KNOWLEDGE_PERFORMANCE.json`。heapDelta 仅为 Node 前后堆差，不是峰值；没有可靠的浏览器总内存/主线程延迟分位数，不虚构。

## 16. 质量、样例与人工评估

`evaluate-knowledge.mjs` 在 100 张合成卡片上输出 200 个片段，200/200 通过 exactText/原始版本偏移机械核验。这是**原文引用一致性**，不是人工知识正确率。

| 原问题（合成） | 实际候选标签示例 | 实际主题 |
|---|---|---|
|IndexedDB 缓存事务如何保持原子性与版本一致性？|IndexedDB、版本、事务、一致性、原子性|IndexedDB · 版本|
|Canvas 图形节点拖动与坐标缩放如何同步？|Canvas、节点、同步、图形、坐标|Canvas · 节点|
|Python C++ 数组内存管理与对象生命周期如何配合？|Python、C++、对象、管理、内存|Python · C++|

实际摘录：“IndexedDB 的读取、版本比较和写入必须放在同一个事务中，避免并发覆盖其他窗口的修改。”它逐字来自 fixture 的回答，带真实合成来源版本/偏移，不是生成摘要。

三个模式的同一相关样例原始分数：Lexical .0496，BGE .6255，Hybrid .3951；无关的蛋糕问题 BGE .2681，低于显示下限。只说明这个小样例可解释，不说明普遍优于词汇检索。

`dist/KNOWLEDGE_HUMAN_REVIEW.tsv` 提供独立人工栏：相关 Card IDs、认可标签、认可片段偏移、主题可读性和应移动主题。目前均 pending。**Precision@5、Recall@5、人工认可率、噪声率、人工移动量没有测量，全部不报告为数值。**

## 17. 浏览器回归证据与剩余工作

- `KNOWLEDGE_CP0_BROWSER.json`：开发前真实独立 Workspace 12 项稳定性基线。
- `KNOWLEDGE_CP6_P0_BROWSER.json`：接入后 A/B/C/A、实际缩放范围和节点坐标、Reader、按住指针时 ResizeObserver、独立窗口/恢复，12 项通过。
- `KNOWLEDGE_NATIVE_SIDEPANEL.json`：真实 `chrome.sidePanel.open()` 停靠侧栏、双 Project 跨页并发/缩放、真实 BGE Hybrid 和关闭后继续点击；24 项通过，原始资料/Canvas/持久视图哈希保持一致。
- `KNOWLEDGE_FLOW_MV3.json`：100 张/3 Conversation 全流程、人工标注保护、主题调整、Deploy、三 Project、重新导入、取消、损坏向量重算、受控 WASM fetch 失败与显式降级；实际页面关闭、扩展重载后的来源/模型缓存/真实推理；空语义输入降级和超 512 Token 的真实 float32 [1,512] 输出验证。最终状态以该文件的 ok 为准。
- 正常测试门禁为既有 23 组 + knowledge，共 24 组，另有静态链接检查。构建通过不代替上述浏览器证据。

尚未解决：在线首次下载的网络可靠性；独立人工质量标注与阈值校准；知识库加入原备份/ID 重映射协议；特别长问题/超大项目的质量和峰值内存测量。WebGPU 不使用、不要求；本轮不声称已验证 GPU 加速。用户的日常 Profile/私人数据没有现场操作。

热重载测试曾因新 Profile 未启用开发者模式失败：CDP 允许初次临时加载，但重载时 Chrome 把旧稳定版也标记 unsupportedDeveloperExtension。读取隔离扩展管理页后，在该测试 Profile 中按普通解压安装方式开启开发者模式，等待新的真实后台 Worker，随后实际重载和模型缓存验证通过。没有改动用户的浏览器设置，也没有把页面重新打开冒充扩展热重载。

已另外保存与 CP0 六个核心文件 SHA-256 一致的开发前目录 `dist/knowledge-stable-baseline-20261023` 和原安装包 `dist/OPC-PRE-KNOWLEDGE-1.6.3.zip`，包 SHA-256 为 `7899497f932b9af0e9c0694d30744a5befaeb6c99ce49072694565cd9602e764`。这保护代码，不替代用户 IndexedDB 备份。

复跑命令（扩展目录下）：`node scripts/validate-all.mjs`、`node scripts/test-knowledge-mv3.mjs`、`node scripts/test-bge-mv3.mjs --offline-file=dist/knowledge-deps/model-verified.onnx`、`node scripts/benchmark-bge-mv3.mjs`、`node scripts/test-workspace-runtime-mv3.mjs --report=dist/KNOWLEDGE_CP6_P0_BROWSER.json`。原生侧栏：设置 OPC_TEST_BROWSER 为 Chrome 路径后执行 `node scripts/test-workspace-sync-mv3.mjs --cdp-load --knowledge --report=dist/KNOWLEDGE_NATIVE_SIDEPANEL.json`。测试使用独立 Profile；ONNX 文件需预先从固定公开版本取得并校验。

## 18. 面试技术追问

1. 为什么 BM25 搜索与 TF-IDF 聚类共用 Tokenization，却不共用分数？
2. 字符 n-gram 为什么适合中文召回，却不宜直接展示为标签？如何评价词组完整性？
3. 为什么将问题、人工标题、标签和长回答分开加权？标题重复会怎样影响向量？
4. 为什么 BGE 要 CLS 而不是直接照搬 mean pooling？中文 small 为什么是 512 维？
5. Token 限制、pooling、量化和模型 revision 如何参与缓存失效？
6. 为什么模型原始缓存与 Embedding 缓存分开？如何处理损坏、配额与多 Workspace 复用？
7. UTF-16、NFKC 和 Markdown 渲染如何导致错误来源高亮？当前验证怎样避免？
8. MMR 如何权衡相关性和冗余？为什么摘录不等于最终决定或事实验证？
9. Complete-link leader 如何阻止相似性链？与 average-linkage 有何区别和代价？
10. 如何设计独立标注、P@5/R@5 与人工接受率，避免用同一规则自产自评？
11. MV3 如何区分模型数据下载与远程代码执行？为什么不用后台持有推理会话？
12. IndexedDB 的同事务 revision 检查与应用层“先读后写”有什么并发区别？
13. 为什么保存 Git 检查点不能替代扩展资料备份？跨 Profile 恢复时如何重映射 Card ID？
14. O(N²D) 何时需要近邻索引？为什么当前版本先用矩阵和明确规模上限？
15. 如何通过真实坐标变化、按住指针事件和跨页写入验证 P0，而不只检查 handler 被调用？
