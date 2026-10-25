export function nodeBounds(points,width=270,height=230){
  const valid=points.filter(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y));if(!valid.length)return null;
  const left=Math.min(...valid.map(p=>p.x)),top=Math.min(...valid.map(p=>p.y));
  return {left,top,width:Math.max(...valid.map(p=>p.x))+width-left,height:Math.max(...valid.map(p=>p.y))+height-top};
}
export function fitNodeViewport(points,width,height){
  const bounds=nodeBounds(points);if(!bounds)return {x:width/2,y:height/2,zoom:1};
  const zoom=Math.max(.05,Math.min(1.25,(width-48)/bounds.width,(height-48)/bounds.height));
  return {x:width/2-(bounds.left+bounds.width/2)*zoom,y:height/2-(bounds.top+bounds.height/2)*zoom,zoom};
}
export function visibleNodeViewport(points,view,width,height){
  return points.some(p=>p&&p.x*view.zoom+view.x<width&&(p.x+270)*view.zoom+view.x>0&&p.y*view.zoom+view.y<height&&(p.y+230)*view.zoom+view.y>0);
}
