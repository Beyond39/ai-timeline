// Browser CSS/geometry checks against the actual application and loaded data.
// Validation only; never packaged and never connected to a real ChatGPT tab.
const visible = node => Boolean(node && node.getClientRects().length && !node.closest('[hidden]') && getComputedStyle(node).visibility !== 'hidden');
const luminance = color => {
  const values = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!values || values.length < 3) throw new Error('无法读取浏览器颜色。');
  const linear = values.map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
};
const background = node => {
  for (let current = node; current; current = current.parentElement) {
    const color = getComputedStyle(current).backgroundColor;
    if (color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color;
  }
  return 'rgb(255, 255, 255)';
};
const contrast = node => {
  const values = [luminance(getComputedStyle(node).color), luminance(background(node))].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
};

export async function runV1UIChecks() {
  const checks = [], failures = [], viewport = { width: innerWidth, height: innerHeight, mode: document.body.dataset.mode };
  const scope = 'Actual V1 application CSS and loaded synthetic conversation DOM on localhost with isolated v04-v1-* or v04-v07-* validationDb. Read-only geometry/contrast checks; no business writes, download, browser resize or real account interaction.';
  const report = () => ({ passed: checks.length, failed: failures.length, checks, failures, viewport, scope });
  const expect = (condition, message) => { if (!condition) throw new Error(message); };
  const check = (name, run) => { try { run(); checks.push(name); } catch (error) { failures.push({ name, error: error.message }); } };
  check('实际页面与明确隔离的本地验证环境', () => {
    expect(['localhost', '127.0.0.1', '[::1]'].includes(location.hostname), '仅在本地验证服务器运行。');
    expect(/^v04-(?:v1|v07)-[a-z0-9-]+$/.test(new URLSearchParams(location.search).get('validationDb') ?? ''), '需要显式 V1/V0.7 隔离资料库。');
    expect(document.querySelector('link[href="ui/v1-workspace.css"]')?.sheet, 'V1 样式未实际加载。');
    expect(!document.querySelector('dialog[open]') && !document.body.classList.contains('reading-focused'), '请在普通工作台且无弹窗时运行。');
  });
  if (failures.length) return report();

  check('实际 UI hooks 唯一，资料库与记忆关联资料包入口齐全', () => {
    const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
    expect(new Set(ids).size === ids.length, '应用中出现重复 ID。');
    for (const id of ['project-overview', 'memory-button', 'connections-button', 'saved-bundles-button', 'capture-source-button']) {
      const control = document.getElementById(id); expect(visible(control) && control.tagName === 'BUTTON', `${id} 入口不可见。`);
    }
  });
  check('导出、资料包、整理与搜索在主阅读区直接可用', () => {
    for (const id of ['document-export-button', 'document-bundle-button', 'organize-button', 'search-input']) {
      const control = document.getElementById(id); expect(visible(control) && !control.closest('details'), `${id} 仍藏在折叠工具内。`);
    }
  });
  check('实际完整正文采用至少16px字体与舒适行距', () => {
    const bodies = [...document.querySelectorAll('#conversation-map .cm-message .message-rich, #conversation-map .cm-message .message-text')].filter(visible);
    expect(bodies.length > 0, '需先打开明确合成 conversation 并展开正文。');
    for (const body of bodies) {
      const style = getComputedStyle(body), size = parseFloat(style.fontSize);
      expect(size >= 16, '中心正文仍使用小于16px的字体。');
      expect(parseFloat(style.lineHeight) >= size * 1.75, '正文行距过密。');
      expect(contrast(body) >= 7, '正文与背景的明暗对比不足。');
    }
  });
  check('问题与回答保持不同表面，标题及主操作可辨认', () => {
    const question = document.querySelector('#conversation-map .cm-question'), answer = document.querySelector('#conversation-map .cm-answer');
    if (question && answer) expect(background(question) !== background(answer), '问题与回答未形成视觉区别。');
    for (const node of [document.querySelector('#map-title'), document.querySelector('#document-export-button')]) expect(contrast(node) >= 4.5, '标题或主操作对比不足。');
  });
  check('项目管理与底部 Conversation 保持清楚归属，四统计框隐藏', () => {
    expect(document.querySelector('#project-library #project-select') && !document.querySelector('#project-library #conversation-list'), '左侧混入 Conversation 列表。');
    expect(document.querySelector('.navigator #conversation-library #conversation-list'), '中部 Conversation 列表丢失。');
    expect(getComputedStyle(document.querySelector('#project-metrics')).display === 'none', '四统计框重新占据主视觉。');
  });
  check('Q/A、树状、蛇形三个模式状态清楚且文字未溢出', () => {
    const controls = ['qa-view-button', 'tree-view-button', 'snake-view-button', 'timeline-view-button'].map(id => document.getElementById(id));
    expect(controls.every(visible), '模式切换入口不可见。');
    expect(controls.filter(node => node.getAttribute('aria-pressed') === 'true').length === 1, '模式选中状态不唯一。');
    expect(controls.every(node => node.scrollWidth <= node.clientWidth + 1), '模式按钮文字溢出。');
  });
  check('窄窗口没有页面横向溢出，阅读区保留全部操作', () => {
    expect(document.documentElement.scrollWidth <= innerWidth + 1, '页面产生横向溢出。');
    const map = document.querySelector('#conversation-map'); expect(map.scrollWidth <= map.clientWidth + 1, '主阅读区产生横向溢出。');
    for (const node of document.querySelectorAll('.header-actions button, .reading-primary-actions button')) expect(node.scrollWidth <= node.clientWidth + 1, '工具按钮文字被裁切。');
  });
  check('足够宽时目录与正文并排，窄窗口恢复纵向阅读', () => {
    const map = document.querySelector('#conversation-map'), root = map.querySelector(':scope > .conversation-map'), directory = root?.querySelector(':scope > .cm-directory');
    expect(root && directory, '需要已载入的 conversation 目录。');
    if (map.clientWidth >= 860) expect(getComputedStyle(root).display === 'grid' && getComputedStyle(directory).position === 'sticky', '宽阅读区没有显示侧边目录。');
    else expect(getComputedStyle(root).display !== 'grid', '窄侧栏仍被分成目录与正文双列。');
  });
  return report();
}
