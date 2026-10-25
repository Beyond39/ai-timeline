// Validation only. Run on the local bridge with an explicit isolated DB and
// the reported-zero-markers synthetic capture fixture; never packaged.
import { readState, STORES } from '../storage/database.js';

const settleLayout = async () => {
  await new Promise(resolve => requestAnimationFrame(resolve));
  await new Promise(resolve => requestAnimationFrame(resolve));
};
const waitFor = async (predicate, description, timeout = 10000) => {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeout) throw new Error(description);
    await new Promise(resolve => setTimeout(resolve, 40));
  }
};
const visible = node => Boolean(node && node.getClientRects().length && !node.closest('[hidden]'));
const inViewport = node => {
  if (!visible(node)) return false;
  const box = node.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
};
const snapshotBusiness = state => JSON.stringify(Object.fromEntries(STORES.filter(name => name !== 'drafts').map(name => [name, state[name]])));

export async function runModalLayoutChecks() {
  const checks = [], failures = [];
  const viewport = { width: innerWidth, height: innerHeight, devicePixelRatio, mode: document.body.dataset.mode ?? null };
  const scope = 'Local browser bridge and actual capture/preview UI; synthetic reported-zero-markers fixture in explicit isolated validationDb. Business records are read only; only a recoverable synthetic capture draft is created. No live ChatGPT, MV3 permissions, resize, download, or user data access.';
  const result = () => ({ passed: checks.length, failed: failures.length, checks, failures, viewport, scope });
  const expect = (condition, message) => { if (!condition) throw new Error(message); };
  const check = async (name, run) => {
    try { await run(); checks.push(name); }
    catch (error) { failures.push({ name, error: error.message }); }
  };
  const parameters = new URLSearchParams(location.search), namespace = parameters.get('validationDb');
  // Refuse to click the product capture button unless it is explicitly bound
  // to the validation-only synthetic adapter and database namespace.
  await check('明确隔离资料库与零角色标记合成采集环境', () => {
    expect(['localhost', '127.0.0.1', '[::1]'].includes(location.hostname), '必须在本地验证服务器运行。');
    expect(/^v0[346]-[a-z0-9-]+$/.test(namespace ?? ''), '必须指定有效的独立 validationDb。');
    expect(parameters.get('captureFixture') === 'reported-zero-markers', '必须使用 reported-zero-markers 合成样例。');
    expect(typeof globalThis.chrome?.runtime?.sendMessage === 'function', '本地浏览器桥接未就绪。');
    expect(!document.querySelector('dialog[open]'), '请先关闭其他弹窗再运行布局验证。');
  });
  if (failures.length) return result();

  let before, dialog;
  try {
    before = snapshotBusiness(await readState());
    await check('通过实际采集按钮打开带正文与诊断的预览', async () => {
      const capture = document.querySelector('#capture-button');
      expect(capture, '缺少实际采集按钮。');
      await waitFor(() => !capture.disabled, '采集按钮一直处于忙碌状态。');
      capture.click();
      await waitFor(() => document.querySelector('#preview-dialog[open] .preview-conversation'), '未能打开合成正文采集预览。');
      await waitFor(() => !capture.disabled, '采集流程未完成。');
      dialog = document.querySelector('#preview-dialog');
      await settleLayout();
      expect(dialog.querySelector('.capture-diagnostics'), '预览缺少本次采集诊断。');
      expect(dialog.textContent.includes('5 段正文'), '合成正文数量与用户报告同型样例不一致。');
    });
    if (!dialog) return result();

    const scroll = dialog.querySelector(':scope > .dialog-scroll');
    const header = dialog.querySelector(':scope > .dialog-header');
    const footer = dialog.querySelector(':scope > .preview-footer');
    const actions = () => [...(footer?.querySelectorAll('.actions button') ?? [])].filter(visible);
    const checkGeometry = (stage) => check(`${stage}：标题、三个操作按钮完整可见且互不覆盖`, () => {
      expect(inViewport(dialog), '整个弹窗超出可视区域。');
      expect(inViewport(header), '标题或关闭按钮超出可视区域。');
      expect(scroll && footer, '未建立独立内容滚动区与操作区。');
      expect(inViewport(footer), '底部操作区超出可视区域。');
      const buttons = actions();
      expect(buttons.length === 3, `应有三个底部操作按钮，实际 ${buttons.length}。`);
      const h = header.getBoundingClientRect(), s = scroll.getBoundingClientRect(), f = footer.getBoundingClientRect();
      expect(h.bottom <= s.top + 1 && s.bottom <= f.top + 1, '标题、正文和操作区出现重叠。');
      for (const button of buttons) {
        expect(inViewport(button), `按钮“${button.textContent}”未完整显示。`);
        const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        expect(hit && (button === hit || button.contains(hit)), `按钮“${button.textContent}”被其他元素覆盖。`);
      }
    });

    await checkGeometry('初次打开');
    await check('仅正文区域滚动，浮动诊断说明回到正常文档流', () => {
      expect(scroll && ['auto', 'scroll'].includes(getComputedStyle(scroll).overflowY), '正文区无法独立滚动。');
      expect(scroll.scrollHeight >= scroll.clientHeight, '正文区滚动尺寸无效。');
      expect(getComputedStyle(dialog).overflowY === 'hidden', '弹窗整体仍在滚动，可能带走底部按钮。');
      for (const node of dialog.querySelectorAll('.capture-diagnostics .notice')) {
        expect(getComputedStyle(node).position === 'static', '诊断说明仍是浮动元素，会覆盖底部按钮。');
      }
      expect(document.querySelector('#notice')?.hidden === true, '弹窗打开后全局浮动提示仍显示。');
    });
    await check('复选框尺寸固定且长标签能在窄预览中换行', () => {
      const inputs = [...dialog.querySelectorAll('input[type="checkbox"]')];
      expect(inputs.length >= 2, '缺少对话选择或诊断附加复选框。');
      for (const input of inputs) {
        const rect = input.getBoundingClientRect();
        expect(Math.abs(rect.width - 16) < 1 && Math.abs(rect.height - 16) < 1, '复选框被拉伸或挤压。');
      }
      const label = dialog.querySelector('.capture-diagnostics label.field');
      expect(label && getComputedStyle(label).display === 'grid', '诊断复选框标签未使用横向布局。');
      expect(dialog.scrollWidth <= dialog.clientWidth + 1 && scroll.scrollWidth <= scroll.clientWidth + 1, '窄预览存在横向溢出。');
    });

    if (scroll) {
      scroll.scrollTop = scroll.scrollHeight;
      await settleLayout();
    }
    await checkGeometry('滚到正文底部');
    await check('展开诊断后标题与操作区域继续保留', async () => {
      const detail = dialog.querySelector('.capture-diagnostics details');
      expect(detail, '缺少诊断详情展开入口。');
      detail.open = true;
      await settleLayout();
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
      await settleLayout();
      expect(detail.open && detail.querySelector('.diagnostic-report'), '诊断详情未展开。');
    });
    await checkGeometry('展开诊断并滚到底部');

    await check('空项目名保存失败时错误提示显示在弹窗内', async () => {
      const target = dialog.querySelector('.dialog-body > label.field select');
      const name = dialog.querySelector('input[placeholder="新项目名称"]');
      expect(target && name, '项目归属或名称输入框缺失。');
      target.value = '__new';
      target.dispatchEvent(new Event('change', { bubbles: true }));
      name.value = '';
      const save = footer?.querySelector('.actions .primary');
      expect(save && !save.disabled, '保存按钮缺失或尚未恢复。');
      save.click();
      await waitFor(() => !dialog.querySelector('.dialog-notice')?.hidden && dialog.querySelector('.dialog-notice')?.textContent.includes('请输入新项目名称'), '空名称验证错误没有显示在弹窗中。');
      await settleLayout();
      const error = dialog.querySelector(':scope > .dialog-notice.error');
      expect(inViewport(error), '验证错误提示位于可视区域之外。');
      expect(error.getAttribute('role') === 'alert', '验证错误没有可访问的 alert 提示。');
      expect(document.querySelector('#notice')?.hidden === true, '验证错误仍使用全局浮动提示。');
      expect(dialog.open, '验证失败错误关闭了预览。');
    });
    await checkGeometry('显示保存验证错误');
    await check('采集和失败验证不改变项目、正文、版本与人工整理', async () => {
      expect(snapshotBusiness(await readState()) === before, '业务资料在预览或失败保存期间被修改。');
    });
  } catch (error) {
    failures.push({ name: '布局验证执行', error: error.message });
  } finally {
    // Keep the synthetic draft recoverable, matching the product's 稍后处理
    // action. No saveDraft or business-record write is performed here.
    if (dialog?.open) {
      const later = [...dialog.querySelectorAll('.preview-footer .actions button')].find(node => node.textContent === '稍后处理');
      if (later && !later.disabled) later.click();
      else dialog.close();
    }
  }
  return result();
}
