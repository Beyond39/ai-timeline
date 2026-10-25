// A press stays a native click until it moves five screen pixels. Capture is
// delayed so a button inside a draggable node remains the click target.
export function bindPointerDrag(target, { canStart = () => true, onPress, onStart, onMove, onEnd, threshold = 5 }) {
  const document = target.ownerDocument;
  let active = null, suppressClick = false;
  const resetClick = () => { suppressClick=false;document.removeEventListener('pointerdown',resetClick,true); };
  const click = event => {
    if (suppressClick && event.detail > 0) {
      resetClick();event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  const stop = (event, cancelled = false) => {
    if (!active || event.pointerId != null && event.pointerId !== active.pointerId) return;
    const gesture = active; active = null;
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', cancel, true);
    document.removeEventListener('keydown', key, true);
    document.defaultView?.removeEventListener('blur', blur);
    target.removeEventListener('lostpointercapture', cancel);
    if (gesture.moved) {
      // Only the release-generated click is suppressed. A subsequent physical
      // press clears the flag; keyboard/programmatic activation has detail=0.
      suppressClick = true;
      document.addEventListener('pointerdown',resetClick,true);
      if (target.hasPointerCapture(gesture.pointerId)) target.releasePointerCapture(gesture.pointerId);
    }
    onEnd?.({ ...gesture, event, cancelled });
  };
  const move = event => {
    if (!active || event.pointerId !== active.pointerId) return;
    const dx = event.clientX - active.x, dy = event.clientY - active.y;
    if (!active.moved && Math.hypot(dx,dy) < threshold) return;
    if (!active.moved) {
      active.moved = true; target.setPointerCapture(active.pointerId); onStart?.(active);
    }
    if (event.cancelable) event.preventDefault();
    onMove?.({ ...active, event, dx, dy });
  };
  const up = event => stop(event);
  const cancel = event => stop(event,true);
  const blur = () => stop({},true);
  const key = event => { if(event.key==='Escape')stop(event,true); };
  const down = event => {
    resetClick();
    if (active || event.button !== 0 || event.isPrimary === false || !canStart(event)) return;
    active = { pointerId:event.pointerId, x:event.clientX, y:event.clientY, moved:false };
    onPress?.(event);
    document.addEventListener('pointermove',move,true);
    document.addEventListener('pointerup',up,true);
    document.addEventListener('pointercancel',cancel,true);
    document.addEventListener('keydown',key,true);
    document.defaultView?.addEventListener('blur',blur);
    target.addEventListener('lostpointercapture',cancel);
  };
  target.addEventListener('pointerdown',down);
  target.addEventListener('click',click,true);
  return { dispose(){stop({},true);resetClick();target.removeEventListener('pointerdown',down);target.removeEventListener('click',click,true);} };
}
