import katex from '../vendor/katex/katex.mjs';

const options = display => ({ displayMode: display, output: 'mathml', trust: false, strict: 'ignore', throwOnError: true, maxExpand: 200, maxSize: 20, macros: {} });

// Vendored and offline. Untrusted macros never create links, images or HTML.
export function mathMarkup(source, display = false) {
  if (String(source).length > 50000) throw new Error('Formula exceeds rendering budget');
  return katex.renderToString(source, options(display));
}
export function renderMath(source, display = false) {
  try {
    if (String(source).length > 50000) throw new Error('Formula exceeds rendering budget');
    const result = document.createElement('span'); katex.render(source, result, options(display));
    if (result.querySelector('script,iframe,img,a,[href],[src],[style]')) throw new Error('Unsafe math output');
    result.className = 'opc-math'; return result;
  } catch {
    const result = document.createElement('code'); result.className = 'math-source'; result.textContent = source;
    result.title = '公式无法排版，已保留原始表达式'; return result;
  }
}
