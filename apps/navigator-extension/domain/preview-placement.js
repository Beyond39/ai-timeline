// Screen coordinates, outside the transformed/clipped Canvas world. If no
// side has room, keep the original card unobstructed and use its Reader entry.
export function previewPlacement(anchor, size, viewport, gap = 12, margin = 8, avoid = []) {
  const width=Math.min(size.width,viewport.width-margin*2),height=size.height;
  const clamp=(n,low,high)=>Math.max(low,Math.min(high,n));
  if(width<=0||height>viewport.height-margin*2)return null;
  const left=clamp(anchor.left,margin,viewport.width-width-margin),top=clamp(anchor.top,margin,viewport.height-height-margin);
  const candidates=[{left:anchor.right+gap,top},{left:anchor.left-width-gap,top},{left,top:anchor.bottom+gap},{left,top:anchor.top-height-gap},
    {left:viewport.width-width-margin,top},{left:margin,top},{left,top:margin},{left,top:viewport.height-height-margin}];
  const overlaps=(p,rect)=>p.left<rect.right&&p.left+width>rect.left&&p.top<rect.bottom&&p.top+height>rect.top;
  return candidates.find(p=>p.left>=margin&&p.top>=margin&&p.left+width<=viewport.width-margin&&p.top+height<=viewport.height-margin&&!overlaps(p,anchor)&&!avoid.some(rect=>overlaps(p,rect)))??null;
}
