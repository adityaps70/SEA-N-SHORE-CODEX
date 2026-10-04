/**
 * Round 14 (2.3): the SCORM runtime bridge injected at the top of every SCORM HTML document.
 *
 * Sandboxed without allow-same-origin, a package can no longer find the player's window.API by
 * walking window.parent. The bridge gives it a local, synchronous window.API (SCORM 1.2) and
 * window.API_1484_11 (SCORM 2004) backed by a value cache, and mirrors every write to the player
 * with postMessage. The player answers "hello" with the attempt's current values and saves on
 * commit/finish exactly as before.
 */
export const SCORM_BRIDGE_SOURCE = 'sns-scorm'
export const SCORM_HOST_SOURCE = 'sns-scorm-host'

export function scormBridgeScript(parentOrigin: string): string {
  const target = JSON.stringify(parentOrigin)
  return `<script>(function(){
var values={},target=${target};
function post(m){m.source=${JSON.stringify(SCORM_BRIDGE_SOURCE)};try{window.top.postMessage(m,target)}catch(e){}}
window.addEventListener('message',function(e){var d=e.data;if(e.source!==window.top||!d||d.source!==${JSON.stringify(SCORM_HOST_SOURCE)}||d.type!=='init'||typeof d.values!=='object'||d.values===null)return;for(var k in d.values){if(Object.prototype.hasOwnProperty.call(d.values,k)&&!Object.prototype.hasOwnProperty.call(values,k))values[k]=String(d.values[k])}});
function get(k){return Object.prototype.hasOwnProperty.call(values,k)?values[k]:''}
function set(k,v){k=String(k);v=String(v);values[k]=v;post({type:'set',key:k,value:v});return 'true'}
function save(type){post({type:type,values:values});return 'true'}
function ok(){return 'true'}function none(){return ''}function zero(){return '0'}
window.API={LMSInitialize:ok,LMSFinish:function(){return save('finish')},LMSGetValue:get,LMSSetValue:set,LMSCommit:function(){return save('commit')},LMSGetLastError:zero,LMSGetErrorString:none,LMSGetDiagnostic:none};
window.API_1484_11={Initialize:ok,Terminate:function(){return save('finish')},GetValue:get,SetValue:set,Commit:function(){return save('commit')},GetLastError:zero,GetErrorString:none,GetDiagnostic:none};
post({type:'hello'});
})();</script>`
}

/** Inserts the bridge right after <head> (or at the very start when there is no head tag). */
export function injectScormBridge(html: string, parentOrigin: string): string {
  const script = scormBridgeScript(parentOrigin)
  const head = /<head(\s[^>]*)?>/i.exec(html)
  if (head) {
    const end = head.index + head[0].length
    return html.slice(0, end) + script + html.slice(end)
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  if (doctype) return html.slice(0, doctype[0].length) + script + html.slice(doctype[0].length)
  return script + html
}
