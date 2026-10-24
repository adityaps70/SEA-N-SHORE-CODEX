import { CSP_REPORT_PATH } from './content-security-policy'

/**
 * Round P3: the page's own CSP reporter, inlined (with the request nonce) as the first script in
 * <head>. Browsers fire `securitypolicyviolation` for every blocked load, so instead of a native
 * `report-uri` request per violation, each unique (directive, blocked origin) is sent once per page
 * load, in batches of up to 20 a couple of seconds after the first one and when the page is
 * hidden. Only the directive and the blocked origin (or a keyword such as `inline`) leave the
 * browser: never paths, query strings or samples. The endpoint reduces them again server-side.
 */
export const CSP_REPORTER_BATCH_SIZE = 20
export const CSP_REPORTER_DELAY_MS = 2_000
/** Unique violations one page load reports at most. */
export const CSP_REPORTER_MAX_UNIQUE = 100

export const CSP_REPORTER_SCRIPT = `(function(){
var seen={},unique=0,queue=[],timer=0,endpoint=${JSON.stringify(CSP_REPORT_PATH)};
function blocked(uri){if(!uri)return'none';try{var u=new URL(uri);return /^(https?|wss?):$/.test(u.protocol)?u.origin:u.protocol.slice(0,-1)}catch(e){return String(uri).slice(0,40)}}
function send(body){try{if(navigator.sendBeacon&&navigator.sendBeacon(endpoint,new Blob([body],{type:'application/json'})))return}catch(e){}try{fetch(endpoint,{method:'POST',body:body,keepalive:true,credentials:'same-origin',headers:{'content-type':'application/json'}}).catch(function(){})}catch(e){}}
function flush(){if(timer){clearTimeout(timer);timer=0}while(queue.length)send(JSON.stringify({violations:queue.splice(0,${CSP_REPORTER_BATCH_SIZE})}))}
document.addEventListener('securitypolicyviolation',function(e){var v={directive:String(e.effectiveDirective||e.violatedDirective||''),blocked:blocked(e.blockedURI)},key=v.directive+' '+v.blocked;if(seen[key]||unique>=${CSP_REPORTER_MAX_UNIQUE})return;seen[key]=1;unique++;queue.push(v);if(queue.length>=${CSP_REPORTER_BATCH_SIZE})flush();else if(!timer)timer=setTimeout(flush,${CSP_REPORTER_DELAY_MS})});
addEventListener('pagehide',flush);
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flush()});
})();`

/** The nonce in a page policy (`'nonce-…'`), or null. */
export function nonceFromContentSecurityPolicy(policy: string | null | undefined): string | null {
  const match = /'nonce-([A-Za-z0-9+/=_-]{8,200})'/.exec(policy ?? '')
  return match?.[1] ?? null
}
