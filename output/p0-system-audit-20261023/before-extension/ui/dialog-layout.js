import { PanelCloseButton } from './panel-close.js';
/**
 * Give a modal one scrolling content region while retaining its existing nodes
 * and listeners. Call after building/rebuilding it, before showModal().
 */
export function prepareDialogLayout(dialog) {
  if (!dialog) return null;
  const header = [...dialog.children].find(node => node.classList.contains('dialog-header'));
  if (!header) return null;
  const globalNotice = dialog.ownerDocument.querySelector('#notice');
  if (globalNotice) globalNotice.hidden = true;
  const footer = [...dialog.children].find(node => node.classList.contains('preview-footer'));
  let scroll = [...dialog.children].find(node => node.classList.contains('dialog-scroll'));
  if (!scroll) {
    scroll = dialog.ownerDocument.createElement('div');
    scroll.className = 'dialog-scroll';
  }
  for (const node of [...dialog.childNodes]) {
    if (node !== header && node !== footer && node !== scroll && !node.classList?.contains('dialog-notice')) scroll.append(node);
  }
  let status = [...dialog.children].find(node => node.classList.contains('dialog-notice'));
  if (!status) {
    status = dialog.ownerDocument.createElement('div');
    status.className = 'dialog-notice notice';
    status.hidden = true;
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
  }
  // Footer explanations can scroll when enlarged text or a short viewport
  // leaves little space. The actions remain outside that scrolling region.
  if (footer) {
    let info = [...footer.children].find(node => node.classList.contains('dialog-footer-info'));
    if (!info) {
      info = dialog.ownerDocument.createElement('div');
      info.className = 'dialog-footer-info';
    }
    for (const node of [...footer.childNodes]) {
      if (node !== info && !node.classList?.contains('actions')) info.append(node);
    }
    if (info.childNodes.length && info.parentNode !== footer) footer.prepend(info);
  }
  dialog.classList.add('dialog-layout');
  dialog.append(header, status, scroll);
  if (footer) dialog.append(footer);
  return scroll;
}

/** Return true when a notice was handled inside an open modal. */
export function routeDialogNotice(dialog, text, error = false) {
  if (!dialog?.open) return false;
  if (!dialog.classList.contains('dialog-layout')) prepareDialogLayout(dialog);
  const host = [...dialog.children].find(node => node.classList.contains('dialog-notice'));
  if (!host) return false;
  host.replaceChildren();
  host.hidden = !text;
  host.classList.toggle('error', Boolean(error));
  host.setAttribute('role', error ? 'alert' : 'status');
  host.setAttribute('aria-live', error ? 'assertive' : 'polite');
  if (text) {
    const copy = dialog.ownerDocument.createElement('span');
    copy.textContent = text;
    const close=PanelCloseButton(()=>{host.hidden=true;},{document:dialog.ownerDocument,title:'关闭提示',className:'notice-close'});
    host.append(copy, close);
    host.scrollTop = 0;
  }
  return true;
}
