// Test-only controlled failure, never packaged. Network routing cannot block
// chrome-extension:// resources, so fail the actual WASM fetch in this Worker.
const originalFetch=self.fetch.bind(self),queued=[];
self.fetch=(url,options)=>String(url).includes('.wasm')?Promise.reject(Error('Controlled test: packaged WASM resource unavailable')):originalFetch(url,options);
self.onmessage=event=>queued.push(event);
await import('../analysis/knowledge-worker.js');
for(const event of queued)self.onmessage(event);
