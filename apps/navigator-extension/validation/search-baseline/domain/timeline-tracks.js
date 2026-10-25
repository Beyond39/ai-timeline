const MINUTE = 60000, DAY = 86400000;
export function defaultTrackPreferences(data) {
  if (data.preferences) return { ...data.preferences, fresh: false };
  const activity = new Map(), cards = new Map(data.cards.map(c => [c.id,c]));
  for (const m of data.memberships) {
    const c=cards.get(m.cardId); if(c?.validity?.state!=='ACTIVE')continue;
    const time=Date.parse(c.questionTime?.value); activity.set(m.timelineId,Math.max(activity.get(m.timelineId)??-Infinity,Number.isFinite(time)?time:-Infinity));
  }
  const ids=data.timelines.filter(t=>t.kind==='source'&&!t.hidden&&!t.archived&&activity.has(t.id)).sort((a,b)=>(activity.get(b.id)-activity.get(a.id))||a.id.localeCompare(b.id)).slice(0,4).map(t=>t.id);
  return {selectedTimelineIds:ids,trackOrder:ids,collapsedTimelineIds:[],scale:'day',zoom:1,scrollLeft:0,scrollTop:0,fresh:true,initialNoActivity:!ids.length,revision:0};
}
// Each identity appears once, including cards referenced by several selected timelines.
export function horizontalLayout(data,preferences,viewportWidth=1000) {
  const tracks=data.timelines.filter(t=>preferences.selectedTimelineIds.includes(t.id)&&!t.hidden&&!t.archived), chosen=new Set(tracks.map(t=>t.id));
  const ids=new Set(data.memberships.filter(m=>chosen.has(m.timelineId)).map(m=>m.cardId));
  const cards=data.cards.filter(c=>ids.has(c.id)&&c.validity?.state==='ACTIVE');
  const timestamp=c=>Date.parse(c.questionTime?.value);
  const known=cards.filter(c=>Number.isFinite(timestamp(c))).sort((a,b)=>timestamp(a)-timestamp(b)||a.ordinal-b.ordinal||a.id.localeCompare(b.id));
  const unknown=cards.filter(c=>!Number.isFinite(timestamp(c))).sort((a,b)=>a.ordinal-b.ordinal||a.id.localeCompare(b.id));
  const first=known.length?timestamp(known[0]):0,last=known.length?timestamp(known.at(-1)):0;
  const rawSpan=last-first, span=Math.max(MINUTE,rawSpan),padding=span*.06;
  const min=first-padding-(rawSpan?0:span/2), max=last+padding+(rawSpan?0:span/2), fitSpan=max-min;
  const width=Math.max(240,viewportWidth),visibleSpan=preferences.axisVersion===1&&preferences.axisSpanMs>0?Math.max(1000,preferences.axisSpanMs):fitSpan;
  const pxPerMs=Math.min((width-48)/visibleSpan,1000000/fitSpan), boardWidth=Math.max(width,fitSpan*pxPerMs+48);
  const position=time=>24+(time-min)*pxPerMs;
  // Fixed screen bins avoid transitive grouping across a whole discussion. Tiny
  // evidence dots keep every real timestamp visible underneath dense markers.
  const bins=new Map(); for(const card of known){const x=position(timestamp(card)),key=Math.floor(x/24);if(!bins.has(key))bins.set(key,[]);bins.get(key).push(card);}
  const points=[...bins.values()].flatMap(group=>group.length>=2?[{cards:group,x:group.reduce((sum,c)=>sum+position(timestamp(c)),0)/group.length,aggregate:true}]:group.map(card=>({cards:[card],x:position(timestamp(card)),aggregate:false})));
  const steps=[MINUTE,5*MINUTE,15*MINUTE,30*MINUTE,60*MINUTE,3*60*MINUTE,6*60*MINUTE,12*60*MINUTE,DAY,3*DAY,7*DAY,14*DAY,30*DAY,90*DAY,365*DAY];
  const tickStep=steps.find(s=>s*pxPerMs>=90)??365*DAY*Math.ceil(90/(365*DAY*pxPerMs));
  return {cards,known,unknown,tracks,points,first,last,min,max,fitSpan,visibleSpan,width:boardWidth,pxPerMs,position,tickStep,latest:known.at(-1)??null};
}
