// A scope selects existing identities; it never moves or copies source cards.
export function timelineScope(projectId, conversationId = '') {
  return {kind:conversationId?'conversation':'project',projectId,workspace:String(projectId).startsWith('workspace_'),...(conversationId?{conversationId}:{})};
}
export function selectTimeline(data,preferences){
  const order=preferences.trackOrder??preferences.selectedTimelineIds;
  const tracks=data.timelines.filter(t=>preferences.selectedTimelineIds.includes(t.id)&&!t.hidden&&!t.archived).sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id)),chosen=new Set(tracks.map(t=>t.id));
  const ids=new Set(data.memberships.filter(m=>chosen.has(m.timelineId)).map(m=>m.cardId));
  const cards=data.cards.filter(c=>ids.has(c.id)&&c.validity?.state==='ACTIVE'),conversations=[...new Set([...tracks.filter(t=>t.kind==='source').map(t=>t.conversationId),...cards.map(c=>c.conversationId)])];
  return {tracks,cards,scope:timelineScope(data.scope?.projectId??data.cards[0]?.projectId,conversations.length===1?conversations[0]:'')};
}
export function scopeLanes(cards, tracks) {
  const lanes=new Map();
  for(const track of tracks)if(track.kind==='source')lanes.set(track.conversationId,{id:track.conversationId,name:track.name,trackId:track.id,cards:[]});
  for(const card of cards){
    if(!lanes.has(card.conversationId))lanes.set(card.conversationId,{id:card.conversationId,name:card.sourceTitle,trackId:null,cards:[]});
    lanes.get(card.conversationId).cards.push(card);
  }
  return [...lanes.values()];
}
