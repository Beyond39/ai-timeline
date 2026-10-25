/* Tiny DOM model used only by Node adapter regressions. It implements the
 * adapter's existing selector subset. Actual browser DOM has a separate harness. */
function parts(selector) {
  const output = []; let text = '', brackets = 0, quoted = false;
  for (const character of selector.trim()) {
    if (character === '"') quoted = !quoted;
    if (!quoted && character === '[') brackets++;
    if (!quoted && character === ']') brackets--;
    if (/\s/.test(character) && !brackets && !quoted) { if (text) { output.push(text); text = ''; } }
    else text += character;
  }
  if (text) output.push(text); return output;
}
function simple(node, selector) {
  if (node.nodeType !== 1) return false;
  const tag = selector.match(/^[a-z0-9]+/i)?.[0]; if (tag && node.tagName !== tag.toUpperCase()) return false;
  const attributes = [...selector.matchAll(/\[([\w-]+)(?:(\^=|\*=|=)"([^"]*)")?\]/g)];
  for (const [, name, operator, expected] of attributes) {
    const actual = node.getAttribute(name); if (actual === null) return false;
    if (operator === '=' && actual !== expected || operator === '^=' && !actual.startsWith(expected) || operator === '*=' && !actual.includes(expected)) return false;
  }
  const withoutAttributes = selector.replace(/\[[^\]]*\]/g, '');
  for (const [, name] of withoutAttributes.matchAll(/#([\w-]+)/g)) if (node.getAttribute('id') !== name) return false;
  for (const [, name] of withoutAttributes.matchAll(/\.([\w-]+)/g)) if (!node.classList.includes(name)) return false;
  return true;
}
function matches(node, selector) {
  return selector.split(',').some(part => {
    const sequence = parts(part); if (!simple(node, sequence.at(-1))) return false;
    let parent = node.parentElement;
    for (let position = sequence.length - 2; position >= 0; position--) {
      while (parent && !simple(parent, sequence[position])) parent = parent.parentElement;
      if (!parent) return false; parent = parent.parentElement;
    }
    return true;
  });
}
class Text {
  nodeType = 3; parentElement = null;
  constructor(text) { this.textContent = text; }
  cloneNode() { return new Text(this.textContent); }
}
class Element {
  nodeType = 1; parentElement = null; childNodes = [];
  constructor(tag, attrs = {}) { this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; }
  get classList() { return (this.attrs.class ?? '').split(/\s+/).filter(Boolean); }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get textContent() { return this.childNodes.map(child => child.textContent).join(''); }
  set textContent(value) { this.childNodes = [new Text(value)]; this.childNodes[0].parentElement = this; }
  getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }
  matches(selector) { return matches(this, selector); }
  closest(selector) { let node = this; while (node) { if (matches(node, selector)) return node; node = node.parentElement; } return null; }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.childNodes.push(node); } }
  remove() { if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter(node => node !== this); this.parentElement = null; }
  cloneNode(deep = false) { const clone = new Element(this.tagName, this.attrs); if (deep) this.childNodes.forEach(child => clone.append(child.cloneNode(true))); return clone; }
  querySelectorAll(selector) {
    const found = []; function visit(node) { for (const child of node.children) { if (matches(child, selector)) found.push(child); visit(child); } } visit(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
export function domModel(fixture) {
  function build(definition) {
    if (typeof definition === 'string') return new Text(definition);
    const node = new Element(definition.tag, definition.attrs); definition.children.forEach(child => node.append(build(child))); return node;
  }
  const document = new Element('document'); document.append(build(fixture.tree)); document.readyState = 'complete'; document.title = `${fixture.label} - ChatGPT`;
  if (fixture.scrollSimulation) {
    const { selector, ...dimensions } = fixture.scrollSimulation;
    Object.assign(document.querySelector(selector), dimensions);
  }
  return { document, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 }, getComputedStyle: element => ({ display: /display\s*:\s*none/.test(element.attrs.style ?? '') ? 'none' : 'block', visibility: /visibility\s*:\s*hidden/.test(element.attrs.style ?? '') ? 'hidden' : 'visible', overflowY: element.attrs.style?.match(/overflow(?:-y)?\s*:\s*(auto|scroll)/)?.[1] ?? 'visible' }) };
}
