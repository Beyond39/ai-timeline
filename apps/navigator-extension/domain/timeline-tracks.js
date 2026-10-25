import { timelineViewport } from './timeline-viewport.js';
import { scopeLanes, selectTimeline } from './timeline-scope.js';
const MINUTE = 60000, DAY = 86400000;
export function defaultTrackPreferences(data) {
  const visible=data.timelines.filter(t=>!t.hidden&&!t.archived),visibleIds=new Set(visible.map(t=>t.id));
  if (data.preferences) {
    const pref=structuredClone(data.preferences),known=new Set(pref.knownTimelineIds??data.timelines.map(t=>t.id));
    pref.selectedTimelineIds=pref.selectedTimelineIds.filter(id=>visibleIds.has(id));
    for(const t of visible.filter(t=>t.kind==='source'&&!known.has(t.id)))if(pref.selectedTimelineIds.length<4)pref.selectedTimelineIds.push(t.id);
    pref.trackOrder=[...new Set([...(pref.trackOrder??[]).filter(id=>visibleIds.has(id)),...pref.selectedTimelineIds])];
    pref.collapsedTimelineIds=(pref.collapsedTimelineIds??[]).filter(id=>visibleIds.has(id));
    return {...pref,knownTimelineIds:data.timelines.map(t=>t.id),fresh:false};
  }
  const activity = new Map(), cards = new Map(data.cards.map(c => [c.id,c]));
  for (const m of data.memberships) {
    const c=cards.get(m.cardId); if(c?.validity?.state!=='ACTIVE')continue;
    const time=Date.parse(c.questionTime?.value); activity.set(m.timelineId,Math.max(activity.get(m.timelineId)??-Infinity,Number.isFinite(time)?time:-Infinity));
  }
  const ids=data.timelines.filter(t=>t.kind==='source'&&!t.hidden&&!t.archived&&activity.has(t.id)).sort((a,b)=>(activity.get(b.id)-activity.get(a.id))||a.id.localeCompare(b.id)).slice(0,4).map(t=>t.id);
  return {selectedTimelineIds:ids,trackOrder:ids,collapsedTimelineIds:[],knownTimelineIds:data.timelines.map(t=>t.id),scale:'day',zoom:1,scrollLeft:0,scrollTop:0,fresh:true,initialNoActivity:!ids.length,revision:0};
}
// Each identity appears once, including cards referenced by several selected timelines.
export function horizontalLayout(data,preferences,viewportWidth=1000) {
  const {tracks,cards,scope}=selectTimeline(data,preferences);
  const timestamp=c=>Date.parse(c.questionTime?.value);
  const known=cards.filter(c=>Number.isFinite(timestamp(c))).sort((a,b)=>timestamp(a)-timestamp(b)||a.ordinal-b.ordinal||a.id.localeCompare(b.id));
  const unknown=cards.filter(c=>!Number.isFinite(timestamp(c))).sort((a,b)=>a.ordinal-b.ordinal||a.id.localeCompare(b.id));
  const first=known.length?timestamp(known[0]):0,last=known.length?timestamp(known.at(-1)):0;
  const rawSpan=last-first, span=Math.max(MINUTE,rawSpan),padding=span*.06;
  const min=first-padding-(rawSpan?0:span/2), max=last+padding+(rawSpan?0:span/2), fitSpan=max-min;
  const {width,visibleSpan,pxPerMs,minSpan,maxSpan}=timelineViewport(fitSpan,preferences.axisVersion===1?preferences.axisSpanMs:0,viewportWidth),boardWidth=Math.max(width,fitSpan*pxPerMs+48);
  const position=time=>24+(time-min)*pxPerMs;
  // Fixed screen bins avoid transitive grouping across a whole discussion. Tiny
  // evidence dots keep every real timestamp visible underneath dense markers.
  const lanes=scopeLanes(cards,tracks),laneIndex=new Map(lanes.map((lane,i)=>[lane.id,i]));
  const yFor=card=>lanes.length>1?64+laneIndex.get(card.conversationId)*100:130;
  const bins=new Map(); for(const card of known){const x=position(timestamp(card)),key=card.conversationId+':'+Math.floor(x/24);if(!bins.has(key))bins.set(key,[]);bins.get(key).push(card);}
  const points=[...bins.values()].map(group=>({cards:group,x:group.reduce((sum,c)=>sum+position(timestamp(c)),0)/group.length,y:yFor(group[0]),laneId:group[0].conversationId,aggregate:group.length>=2}));
  const steps=[MINUTE,5*MINUTE,15*MINUTE,30*MINUTE,60*MINUTE,3*60*MINUTE,6*60*MINUTE,12*60*MINUTE,DAY,3*DAY,7*DAY,14*DAY,30*DAY,90*DAY,365*DAY];
  const tickStep=steps.find(s=>s*pxPerMs>=90)??365*DAY*Math.ceil(90/(365*DAY*pxPerMs));
  return {scope,cards,known,unknown,tracks,lanes,yFor,height:lanes.length>1?lanes.length*100+36:260,points,first,last,min,max,fitSpan,visibleSpan,minSpan,maxSpan,width:boardWidth,pxPerMs,position,tickStep,latest:known.at(-1)??null};
}
