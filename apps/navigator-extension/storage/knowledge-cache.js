// Independent database: no upgrade, write, or deletion of the source database.
const DB='opc-knowledge-engine-v1';
let connection;
const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
export async function knowledgeDB() {
  if(!connection)connection=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB,1);
    req.onupgradeneeded=()=>{for(const name of ['embeddings','runs','reviews'])req.result.createObjectStore(name,{keyPath:'id'});};
    req.onsuccess=()=>{req.result.onversionchange=()=>{req.result.close();connection=null;};resolve(req.result);};req.onerror=()=>{connection=null;reject(req.error);};
  });
  return connection;
}
export async function cacheGet(store,id) {const db=await knowledgeDB();return request(db.transaction(store).objectStore(store).get(id));}
export async function cachePut(store,row) {
  const db=await knowledgeDB();await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(row);tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error);});return row;
}
export async function cacheRemove(store,id) {const db=await knowledgeDB();await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(id);tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error);});}
export async function pruneEmbeddings(limit=5000) {
  const db=await knowledgeDB(),rows=await request(db.transaction('embeddings').objectStore('embeddings').getAll());
  const remove=rows.sort((a,b)=>(b.usedAt??0)-(a.usedAt??0)).slice(limit);
  if(remove.length)await new Promise((resolve,reject)=>{const tx=db.transaction('embeddings','readwrite');for(const row of remove)tx.objectStore('embeddings').delete(row.id);tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error);});
}
// Read-modify-write occurs in ONE transaction so simultaneous per-item reviews
// cannot erase one another. Explicit revisions protect stale topic/review edits.
export async function updateReview(id,expectedRevision,update) {
  const db=await knowledgeDB();return new Promise((resolve,reject)=>{
    const tx=db.transaction('reviews','readwrite'),store=tx.objectStore('reviews'),req=store.get(id);let saved,error;
    req.onsuccess=()=>{try{const row=req.result??{id,revision:0,items:{}};if(expectedRevision!==row.revision)throw Error('审核已在另一页面修改，请重新打开核对。');saved=update(structuredClone(row));saved.revision=row.revision+1;store.put(saved);}catch(e){error=e;tx.abort();}};
    tx.oncomplete=()=>resolve(saved);tx.onabort=tx.onerror=()=>reject(error??tx.error);
  });
}
