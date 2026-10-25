from pathlib import Path
import json, re, html
from datetime import datetime
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image, Flowable, KeepTogether
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / 'apps' / 'navigator-extension'
OUT = ROOT / 'output' / 'pdf'
TMP = ROOT / 'tmp' / 'pdfs' / 'opc-summary'
OUT.mkdir(parents=True, exist_ok=True)
TMP.mkdir(parents=True, exist_ok=True)
PDF = OUT / 'OPC_Timeline_Project_Summary_2026-10-13.pdf'
pdfmetrics.registerFont(TTFont('CN', 'C:/Windows/Fonts/simsun.ttc', subfontIndex=0))
pdfmetrics.registerFont(TTFont('CNBold', 'C:/Windows/Fonts/simhei.ttf'))
pdfmetrics.registerFontFamily('CN', normal='CN', bold='CNBold', italic='CN', boldItalic='CNBold')
INK = colors.HexColor('#223447')
BLUE = colors.HexColor('#426b88')
MUTED = colors.HexColor('#627282')
LIGHT = colors.HexColor('#edf3f7')
BORDER = colors.HexColor('#dce5eb')
W, H = A4
CW = W - 96
styles = {
    'title': ParagraphStyle('title', fontName='CNBold', fontSize=31, leading=40, textColor=INK, wordWrap='CJK', spaceAfter=15),
    'h1': ParagraphStyle('h1', fontName='CNBold', fontSize=20, leading=28, textColor=INK, wordWrap='CJK', spaceAfter=14),
    'h2': ParagraphStyle('h2', fontName='CNBold', fontSize=12.5, leading=19, textColor=BLUE, wordWrap='CJK', spaceBefore=12, spaceAfter=7),
    'body': ParagraphStyle('body', fontName='CN', fontSize=10.5, leading=18, textColor=INK, wordWrap='CJK', spaceAfter=9),
    'small': ParagraphStyle('small', fontName='CN', fontSize=8.8, leading=14, textColor=MUTED, wordWrap='CJK', spaceAfter=6),
    'cell': ParagraphStyle('cell', fontName='CN', fontSize=9.2, leading=15, textColor=INK, wordWrap='CJK'),
    'headcell': ParagraphStyle('headcell', fontName='CNBold', fontSize=9.2, leading=15, textColor=colors.white, wordWrap='CJK'),
    'kpi': ParagraphStyle('kpi', fontName='CNBold', fontSize=24, leading=32, textColor=BLUE, alignment=1),
    'kpilabel': ParagraphStyle('kpilabel', fontName='CN', fontSize=9.5, leading=16, textColor=MUTED, alignment=1),
}

SKIP = {'dist','node_modules','vendor','.git','__pycache__','tmp','output','.venv','.pytest_cache','.codex','.agents'}
def files(base):
    return [p for p in base.rglob('*') if p.is_file() and not any(x in SKIP for x in p.relative_to(base).parts)]
def stats(paths):
    total = {'files':len(paths),'lines':0,'nonblank':0,'bytes':0}
    for p in paths:
        text=p.read_bytes().decode('utf-8'); rows=text.splitlines()
        total['lines']+=len(rows);total['nonblank']+=sum(bool(r.strip()) for r in rows);total['bytes']+=len(text.encode('utf-8'))
    return total
source = files(EXT)
runtime = [p for p in source if p.suffix in {'.js','.mjs','.css','.html'} and p.relative_to(EXT).parts[0] not in {'validation','scripts'}]
testfiles = [p for p in source if p.suffix in {'.js','.mjs','.css','.html'} and p.relative_to(EXT).parts[0] in {'validation','scripts'}]
legacy = [p for p in files(ROOT) if p.suffix in {'.py','.sql'} and not p.is_relative_to(EXT) and p.relative_to(ROOT).parts[0] not in {'tests','tools'}]
oldtests = [p for p in files(ROOT/'tests') if p.suffix=='.py']
S={'runtime':stats(runtime),'tests':stats(testfiles),'docs':stats([p for p in source if p.suffix=='.md']),'legacy':stats(legacy),'oldtests':stats(oldtests)}
S['language']={ext:stats([p for p in runtime if p.suffix==ext]) for ext in ['.js','.css','.html']}
S['folders']={d:stats([p for p in runtime if p.relative_to(EXT).parts[0]==d]) for d in ['domain','storage','ui','adapters','exports','importers','analysis']}
(TMP/'source_statistics.json').write_text(json.dumps(S,ensure_ascii=False,indent=2),encoding='utf-8')
assert S['runtime']['lines']==8483 and S['tests']['lines']==7665, 'Source snapshot changed; update document facts.'
baseline=json.loads((EXT/'dist/OPC_NODE_REPORT.json').read_text(encoding='utf-8'))
current=json.loads((EXT/'dist/UX_BROWSER_REPORT.json').read_text(encoding='utf-8'))

def p(text,style='body'): return Paragraph(text,styles[style])
story=[]
def add(text,style='body'): story.append(p(text,style))
def heading(num,title): add(f'{num:02d} / {title}','h1')
def table(rows,widths,header=True):
    parsed=[[p(str(c),'headcell' if header and i==0 else 'cell') for c in row] for i,row in enumerate(rows)]
    t=Table(parsed,colWidths=widths,hAlign='LEFT',repeatRows=1 if header else 0)
    commands=[('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LINEBELOW',(0,0),(-1,-1),.4,BORDER)]
    if header:commands += [('BACKGROUND',(0,0),(-1,0),BLUE),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f6f9fb')])]
    t.setStyle(TableStyle(commands));story.append(t);story.append(Spacer(1,10));return t
def note(text):
    t=Table([[p(text,'small')]],colWidths=[CW]);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),LIGHT),('BOX',(0,0),(-1,-1),.5,BORDER),('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),7)]));story.append(t);story.append(Spacer(1,10))
class Pipeline(Flowable):
    def __init__(self):super().__init__();self.width=CW;self.height=79
    def draw(self):
        c=self.canv;bw=(CW-36)/4
        for i,(a,b) in enumerate([('Capture','提取对话'),('Structure','形成 Q/A'),('Reflect','记录判断'),('Deploy','部署上下文')]):
            x=i*(bw+12);c.setFillColor(LIGHT);c.setStrokeColor(BORDER);c.roundRect(x,9,bw,59,7,fill=1,stroke=1)
            c.setFillColor(BLUE);c.setFont('Helvetica-Bold',11);c.drawCentredString(x+bw/2,46,a);c.setFont('CN',10);c.drawCentredString(x+bw/2,27,b)
            if i<3:c.setStrokeColor(BLUE);c.line(x+bw+2,39,x+bw+10,39);c.line(x+bw+7,42,x+bw+10,39);c.line(x+bw+7,36,x+bw+10,39)

# Page 1 - project definition and verdict.
add('PROJECT SUMMARY  /  2026.10.13','small')
add('OPC Timeline<br/>项目整体总结','title')
add('从历史 AI 对话，到可以追溯、连接、判断并重新使用的个人上下文资产。','body')
add('工程构建 1.5.1  |  产品定位 v1.0 First Release  |  本地优先 Chrome 扩展','small')
story.append(Spacer(1,12))
kpis=Table([[[p('8,483','kpi'),p('扩展自有运行代码行','kpilabel')],[p('66','kpi'),p('自有 JavaScript 模块','kpilabel')],[p('4','kpi'),p('离线上下文编译模式','kpilabel')],[p('300','kpi'),p('本地浏览器长对话样例','kpilabel')]]],colWidths=[CW/4]*4)
kpis.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),LIGHT),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('TOPPADDING',(0,0),(-1,-1),16),('BOTTOMPADDING',(0,0),(-1,-1),16)]));story.append(kpis);story.append(Spacer(1,17))
add('这个项目究竟做了什么','h2')
add('OPC Timeline 把分散在 ChatGPT 对话里的完整问答转为稳定的 Q/A 卡片。用户可以按真实时间回顾、在自由画布里连接相关讨论，写下自己的批注、决定和未解决问题，再将选中的历史内容编译成可复制的 Context Pack，继续新的 AI 任务。')
story.append(Pipeline())
add('目前是什么阶段','h2')
add('当前已经有可构建、可加载的工程和本地端到端证据，主要价值闭环具备基础实现。最新一轮进一步修复了时间线浏览、画布初始视口、导航拥挤和 Deploy 空状态。它处于发布候选与真实环境验收阶段，不能仅凭本地样例宣布公开发布已经完成。')
note('本总结依据当前仓库、源码统计和已保存的测试报告。它说明现有工程资产，不代表本轮新增了全部代码，也不把功能数量、代码行数当成质量或完成率。')
story.append(PageBreak())

# Page 2 - auditable quantities.
heading(2,'代码规模与统计口径')
add('主体是 apps/navigator-extension。自有代码排除第三方 vendor、dist 安装目录、ZIP、node_modules、缓存、图标与生成报告；文档和早期 Python 引擎另外统计。')
table([['类别','文件数','物理行数','非空行数'],['当前扩展运行源码','76','8,483','8,363'],['扩展验证 / 构建代码','91','7,665','7,515'],['扩展 Markdown 文档','39','2,546','1,669'],['早期 Python / SQL 工程','32','4,195','3,834'],['根目录 Python 测试','8','1,040','934']],[220,65,105,CW-390])
add('发布主体的语言构成','h2')
table([['语言','文件','物理行数','主要职责'],['JavaScript','66','7,477','采集、解析、存储、UI、编译与导出'],['CSS','7','900','工作台、卡片、正文、弹窗及响应式'],['HTML','3','106','工作台、侧边栏、打印页']],[105,55,75,CW-235])
add('这些数字该如何理解','h2')
add('扩展运行代码与验证 / 构建代码合计 <b>16,148 行</b>。如果将另存的早期 Python / SQL 工程及根目录 Python 测试也计算在内，本次明确口径下合计 <b>21,383 行、207 个代码文件</b>。这些数字不是整个目录所有文本文件的总和。')
add('物理行数包含注释；非空行只排除空白行，不等于严格的 SLOC。部分 JavaScript 和 CSS 较紧凑，一行可能包含多个逻辑语句，因此不能凭行数推断复杂度或工时。测试文件数也不等于测试用例数。','small')
note('当前 1.5.1 ZIP 大小为 567,428 字节，约 554 KiB。可加载包包含 116 个文件，含必要的第三方数学渲染资源、图标和文档。包文件数与上表自有运行源码文件数属于不同口径。')
story.append(PageBreak())

# Page 3 - capability inventory.
heading(3,'现有功能已经覆盖什么')
table([['能力','当前实现与用户用途','验收边界'],['主动导入','由用户点击导入当前 ChatGPT 对话；保留来源、顺序、可取得的分支 / 时间 / 完成状态','真实页面变化仍需 Chrome 验收'],['Q/A 结构化','一轮一张稳定卡片；识别最终回答；合并有效片段；技术性去重与重复同步','已有解析回归报告'],['分支与同步','ACTIVE / PENDING / HIDDEN_INVALID；更新当前答案，保留人工编辑、关系和旧版本','部分读取保守处理'],['安全正文阅读','Markdown、代码、表格、链接、公式；静态组件转换与诊断；完整正文按需读取','不执行导入脚本'],['单轴 Timeline','多来源混合、真实时间点、自动刻度、Fit All、缩放、平移、密度展开、未知时间区','1.5.1 已有本地交互证据'],['阅读面板','完整 Q 在上、A 在下，独立标签区；独立滚动；小屏抽屉','已测桌面与375px节点阅读'],['自由 Canvas','节点拖动、锚点连接、缩放、适配、聚焦、布局恢复；有向 / 无向及自定义关系','实际拖动、连线、刷新恢复已测'],['用户判断','标签、标题、收藏、我的批注、采纳状态、决定、未解决事项、手动摘录','人工判断与原始回答分开'],['Context Pack','多卡托盘、排序、四种编译模式、预览编辑、复制、保存、来源版本与冲突提示','三卡部署流程本地实测'],['本地检索','中文关键词；问题、答案、标题、标签、批注、决定和问题事项；筛选与定位','离线可用，无外部API依赖'],['导出与恢复','Markdown / 通用 Prompt、文档与资料包、结构化备份、恢复点和引用映射','原始数据和编辑历史可恢复']],[91,256,CW-347])
note('当前主导航只有 Timeline / Canvas / Deploy。原始消息树的普通界面已移除，但消息父子关系与分支解析数据继续保留。现有实现不等于每个功能均已在真实用户环境完成最终验收。')
story.append(PageBreak())

# Page 4 - implementation architecture.
heading(4,'技术架构与数据资产')
add('当前扩展采用 Manifest V3、原生 JavaScript ES modules、HTML / CSS 和 IndexedDB。画布复用现有 SVG / DOM 实现，没有为重做界面引入 React 或重建一套 Q/A 数据。基础工作不要求 Python 服务、SQLite 服务器、外部 LLM 或云账户。')
table([['工程层','文件 / 行数','核心职责'],['domain','27 / 2,343','有效性、卡片身份、同步、用户判断、关系、上下文编译与备份'],['storage','8 / 990','IndexedDB读写、查询、事务与版本冲突保护'],['ui','27 / 3,812','工作台、阅读、画布、托盘、Deploy、整理与文档工具'],['adapters','3 / 572','ChatGPT页面 / 来源结构适配与真实字段边界'],['exports + importers','5 / 455','文件导入、文档来源、格式输出与配方'],['其余运行入口','6 / 311','background、analysis、3个HTML入口']],[123,99,CW-222])
add('数据模型为什么是重要成果','h2')
add('数据库当前为 <b>V8</b>，有 <b>32 个业务对象存储</b>，另有数据库元信息。逻辑边界包括原始消息 / 版本 / 快照 / 分支、稳定 QACard、卡片元信息、时间线归属、关系、画布布局、决定、OpenIssue、KnowledgeFragment、ContextPack 及条目、托盘和 ImportRecord。批注等数据复用既有元信息，未为了新界面重复建立模型。')
add('关键身份原则','h2')
add('关系和上下文包引用稳定卡片 ID；卡片更换当前答案时保留身份。加入不同主题时间线只是增加归属引用，不复制问答。隐藏无效卡片不会删除其关系、备注或决定，恢复有效答案时继续使用同一对象。')
note('仓库还保留早期 Project Memory Python 引擎：本地服务、CLI、SQLite及语义探索等历史资产。它们与当前浏览器扩展分开运行；不能将其所有能力算作 Chrome 产品已集成功能。')
story.append(PageBreak())

# Page 5 - differentiator.
heading(5,'Context Pack：项目的核心差异化')
add('上下文包把“回顾历史”推进到“继续工作”。用户从多个对话选择来源卡片，指定新任务，用自己的决定、批注和关系整理必要背景，预览并复制到新的 ChatGPT、Claude、Gemini、Codex 等文本对话中。当前不自动控制这些网站或发送消息。')
table([['模式','离线行为'],['FULL / 完整','保留选中完整 Q/A 和指定信息，适合需要历史细节的任务。'],['COMPACT / 精简','使用已有标题 / 摘录及确定性语义块压缩；标明省略，不依赖AI重新总结。'],['DECISIONS / 决策','围绕用户明确确认的决定；没有确认决定就明确提示，不编造结论。'],['CUSTOM / 自定义','人工选择每张来源包含的Q、A、批注、决定和问题，并调整顺序。']],[140,CW-140])
add('编译器已经处理的困难','h2')
add('<b>关系顺序：</b>依据已确认的依赖关系提供必要背景；循环或未选择的依赖产生提示，不无限递归。修正 / 推翻关系不能仅凭名称替用户判定真伪。')
add('<b>当前决定与历史方案：</b>用户明确采纳、推翻、待验证的决定分开输出。相互冲突的已确认决定保留来源并提示核对，不擅自挑较新的一条。')
add('<b>版本与人工编辑：</b>保存卡片引用和编译来源版本；来源更新时提示重新编译，已有输出不自动覆盖。明确重编译时，旧人工编辑进入可恢复历史。')
add('<b>规模与安全边界：</b>本地token估算明确标注不是模型tokenizer。预算不足会提示，不静默截断关键决定；历史回答用清晰的数据 / 引用边界，与当前用户任务和确认决定区分。')
note('Project Briefing 是同一编译器的项目继续工作模板，组合目标、确认决定、未解决事项、依赖、历史来源及用户下一步任务。缺少资料时显示没有确认记录，而不是自动补写事实。')
story.append(PageBreak())

# Page 6 - visual evidence.
heading(6,'最近一轮 UI / UX 重做成果')
add('修复的是实际结构和事件：固定月级比例、多行巨型卡片、缺少滚轮处理、画布未首次适配、叠加旧导航与CSS，以及零卡片也显示复杂操作。新的视图继续复用可靠的数据与编译逻辑。','small')
def screenshot(name,width):
    im=Image(str(EXT/'dist/ux-evidence'/name));im.drawHeight=im.imageHeight*width/im.imageWidth;im.drawWidth=width;im.hAlign='CENTER';story.append(im)
screenshot('timeline-after.jpg',430)
add('单轴时间线：同日22轮按真实时间展开，15分钟刻度；小节点与完整阅读分离。','small')
table([['工作区','结构性变化'],['Timeline','一条真实时间轴，分钟到月份自适应；普通 / 水平滚轮、空白拖动、适配全部；密集圆点可逐条展开。'],['Canvas','首次按节点边界居中；保留人工坐标与关系；适配节点、100%和居中选中；50节点整体适配后可局部聚焦。'],['Deploy / 阅读','零卡片有明确指引；选择、编辑、预览复制连续进行；完整Q/A放入独立阅读面板，高级操作收起。']],[115,CW-115])
note('图中为本地 Chromium 运行真实产品 UI 的合成时间线样例，不是静态设计稿或真实 ChatGPT 页面截图。画布与部署变化以源码和结构化测试报告为依据。顶部导航约56px；高级选项移入设置；窄屏节点有24px点击范围与稳定滚动条空间。')
story.append(PageBreak())

# Page 7 - evidence vs claims.
heading(7,'测试证据与当前成熟度')
table([['证据层','仓库中已有结果','含义'],['1.5.0历史基线','17套Node测试 + 1次静态检查，记录295项；报告通过','证明当时基线，不能替代1.5.1全量验收'],['1.5.0发布场景','12组Node场景、12组本地浏览器场景报告通过','包括判断、四模式、版本、冲突 / 循环与恢复'],['1.5.1本轮重点','5组领域 / UI静态不变量；真实浏览器鼠标交互和持久化记录','按修复风险检测，没有反复跑全部历史套件'],['1.5.1安装包','构建通过，116文件；ZIP逐项解压与目录字节一致','说明产物完整，不等于安装后的真实页面验收']],[106,242,CW-348])
add('本轮浏览器里实际确认的结果','h2')
table([['样例 / 操作','可核实结果'],['22轮 / 四来源50轮','Fit 后22点可见；多来源仍只有一条时间轴，密集区可展开。'],['滚轮 / 拖动 / 阅读','普通滚轮661→985px；空白拖动回765px；阅读面板滚432px时背景不动。'],['2 / 50节点画布','真实拖动、锚点连接、关系与视口恢复；50节点Fit后全部在边界内。'],['三卡片 Deploy','选择→编译→复制→重开；复制与预览一致，已保存4622字符恢复。'],['300轮长对话','300个时间锚点、1条轴；正常初始化完整回答DOM为0。'],['响应式','请求375 / 768 / 1024 / 1440px；无横向溢出；375px抽屉打开与关闭成功。']],[120,CW-120])
add('仍没有完成的验收','h2')
add('用户原安装的 Chrome MV3、真实 ChatGPT 页面的最新抓取行为、物理触控板、真实按住 Shift 的滚轮、125%浏览器缩放，以及峰值内存与大规模真实资料质量，仍需验证。本地合成数据和已有截图不能替代这些项目。','small')
note('本次总结只重新检查仓库和已有报告，未重新运行产品全量测试。PDF自身会另做文本、页数和渲染检查。当前合理结论是“基础闭环已有实现和本地证据”，不输出没有依据的完成百分比。')
story.append(PageBreak())

# Page 8 - appraisal and roadmap.
heading(8,'项目价值、限制与下一步')
add('已经积累的工程资产','h2')
add('一是可追溯的来源与稳定身份体系，避免分支切换、重复同步或界面重构破坏用户整理。二是同一批Q/A支撑时间浏览、关系整理、用户判断、全文搜索和上下文再部署，形成统一的数据闭环。三是本地存储、版本、备份、迁移归档和并发保护，减少历史内容与人工编辑丢失。四是实际可构建的包、验证工具和交付文档，而不只是页面展示。')
add('当前需要继续收敛的部分','h2')
add('ChatGPT页面结构和可取得的元数据是外部不稳定因素，真实时间或完成状态不能保证总能获取。UI仍保留较多历史样式和较大的入口模块，后续可以小步拆分。大量、跨度很大的画布适配后标题会缩小，需要100%聚焦。性能结论目前来自有限本地样例，不能推断无限量数据下的响应。')
table([['优先级','建议推进','具体完成标准'],['P0 / 发布验收','原Chrome安装 + 截图对应真实22轮对话','完成主动导入、当前分支、增量同步及完整阅读核对'],['P0 / 交互可靠性','Shift / 触控板 / 125%缩放与真实用户流程','从导入到复制上下文连续完成，记录失败点与复现步骤'],['P1 / 维护与性能','拆分大模块、收敛旧CSS、扩大真实长对话样本','不改稳定ID与数据边界；有响应时间和内存证据'],['后续可选','AI标签建议、语义检索、更多来源适配','人工控制、显式授权、本地回退；不阻塞现有闭环']],[105,196,CW-301])
add('资料依据与统计范围','h2')
add('当前依据：扩展 manifest / README、domain 与 storage / UI源码；docs/UI_UX_REPAIR.zh-CN.md；dist/UX_NODE_REPORT.json、UX_BROWSER_REPORT.json；历史 OPC_NODE_REPORT.json、OPC_FIRST_RELEASE_NODE_REPORT.json 与 OPC_FIRST_RELEASE_BROWSER_REPORT.json。截图来自 dist/ux-evidence。上述报告保留版本和验证环境，未将历史结果冒充本轮新运行结果。','small')
note('产品定位：Capture your conversations. Connect your thinking. Deploy your context.<br/>当前最值得完成的是原Chrome与真实会话的连续验收。云同步、订阅、完整RAG、MCP Server和多平台自动抓取，没有作为已经完成的Chrome功能列入本总结。')

class NumberedCanvas:
    pass
def footer(canvas,doc):
    canvas.saveState();canvas.setStrokeColor(BORDER);canvas.line(48,42,W-48,42)
    canvas.setFont('CN',8);canvas.setFillColor(MUTED);canvas.drawString(48,27,'OPC Timeline / 项目整体总结 / 2026-10-13')
    canvas.setFont('Helvetica',8);canvas.drawRightString(W-48,27,str(doc.page));canvas.restoreState()
doc=SimpleDocTemplate(str(PDF),pagesize=A4,rightMargin=48,leftMargin=48,topMargin=43,bottomMargin=57,title='OPC Timeline 项目整体总结',author='OPC Timeline Project',subject='代码规模、功能、工程架构、验证边界与下一步')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
reader=PdfReader(str(PDF));text='\n'.join(page.extract_text() or '' for page in reader.pages)
assert len(reader.pages)==8,f'Expected 8 designed pages, got {len(reader.pages)}'
for key in ['8,483','16,148','21,383','Context Pack','32','295','1.5.1','未重新运行','真实 ChatGPT']:
    assert key in text,f'Missing content: {key}'
assert '\ufffd' not in text
(TMP/'extracted_text.txt').write_text(text,encoding='utf-8')
print(json.dumps({'pdf':str(PDF),'pages':len(reader.pages),'bytes':PDF.stat().st_size,'statistics':S['runtime'],'textChecks':True},ensure_ascii=False))
