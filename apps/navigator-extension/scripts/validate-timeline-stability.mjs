import assert from 'node:assert/strict';
import { horizontalLayout, defaultTrackPreferences } from '../domain/timeline-tracks.js';
import { zoomViewport } from '../domain/timeline-viewport.js';
import { HorizontalTimeline } from '../ui/horizontal-timeline.js';
const data={timelines:[{id:'t',kind:'source'}],memberships:[{timelineId:'t',cardId:'a'},{timelineId:'t',cardId:'b'}],cards:[{id:'a',ordinal:1,questionTime:{value:'2020-01-01'},validity:{state:'ACTIVE'}},{id:'b',ordinal:2,questionTime:{value:'2026-10-21'},validity:{state:'ACTIVE'}}]};
const pref={selectedTimelineIds:['t'],axisVersion:1,axisSpanMs:0};
for(const width of [240,1000,1600]){
 let layout=horizontalLayout(data,pref,width);
 for(let i=0;i<45;i++){
  const view=zoomViewport(layout,1/1.5,0,width),next=horizontalLayout(data,{...pref,axisSpanMs:view.visibleSpan},width);
  if(layout.visibleSpan>layout.minSpan)assert(next.pxPerMs>layout.pxPerMs,'enabled + must change coordinates');
  assert.equal(next.visibleSpan,view.visibleSpan);assert(next.width<=1000049);layout=next;
 }
 const out=horizontalLayout(data,{...pref,axisSpanMs:zoomViewport(layout,1.5,0,width).visibleSpan},width);
 assert(out.pxPerMs<layout.pxPerMs,'first − at zoom bound must immediately move coordinates');
}
console.log('PASS effective zoom across six years, narrow/wide viewports and upper bound');
const writes=[],owner={projectId:'A',api:async(type,args)=>{writes.push(args);return {revision:(args.expectedRevision??0)+1};}};
const renderer=new HorizontalTimeline(owner);renderer.projectId='A';renderer.preferences={revision:0,selectedTimelineIds:['t']};
const first=renderer.save();owner.projectId='B';renderer.preferences.selectedTimelineIds.push('later');await first;
assert.equal(writes[0].projectId,'A');assert.deepEqual(writes[0].selectedTimelineIds,['t']);
await Promise.all([renderer.save(),renderer.save()]);assert.deepEqual(writes.map(w=>w.expectedRevision),[0,1,2]);
console.log('PASS immutable preference writes retain rendered scope and serialize revisions');
const parallel={timelines:[{id:'x',kind:'source',conversationId:'x',name:'X'},{id:'y',kind:'source',conversationId:'y',name:'Y'}],memberships:[{timelineId:'x',cardId:'x1'},{timelineId:'x',cardId:'x2'},{timelineId:'y',cardId:'y1'},{timelineId:'y',cardId:'u1'}],cards:[...['x1','x2','y1'].map(id=>({id,conversationId:id[0],ordinal:1,questionTime:{value:'2026-10-21T00:00:00Z'},validity:{state:'ACTIVE'}})),{id:'u1',conversationId:'y',ordinal:2,questionTime:{value:null},validity:{state:'ACTIVE'}}]};
const lanes=horizontalLayout(parallel,{selectedTimelineIds:['x','y'],trackOrder:['y','x']},900);
assert.equal(lanes.scope.kind,'project');assert.equal(horizontalLayout(parallel,{selectedTimelineIds:['x']},900).scope.kind,'conversation');
assert.equal(lanes.lanes.length,2);assert.equal(lanes.lanes[0].id,'y');assert.equal(lanes.points.length,2);assert.equal(lanes.points[0].x,lanes.points[1].x);assert.notEqual(lanes.points[0].y,lanes.points[1].y);assert(lanes.points.every(p=>new Set(p.cards.map(c=>c.conversationId)).size===1));assert.deepEqual(lanes.unknown.map(c=>c.id),['u1']);
assert.deepEqual(parallel.cards.map(c=>c.id),['x1','x2','y1','u1']);
console.log('PASS shared timestamp maps to same X, separate lanes/bins, unknown remains unpositioned');
const restored=defaultTrackPreferences({...parallel,preferences:{selectedTimelineIds:['x','removed'],trackOrder:['x','removed'],collapsedTimelineIds:[],knownTimelineIds:['x'],revision:2}});
assert.deepEqual(restored.selectedTimelineIds,['x','y']);
const hidden=defaultTrackPreferences({...parallel,preferences:{selectedTimelineIds:[],trackOrder:[],collapsedTimelineIds:[],knownTimelineIds:['x','y']}});assert.deepEqual(hidden.selectedTimelineIds,[]);
console.log('PASS new associations appear, detached tracks pruned, explicitly hidden lanes remain hidden');
