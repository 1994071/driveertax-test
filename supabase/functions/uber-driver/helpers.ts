// Shared pure helpers: also exercised in the mocked provider tests.
export const UBER_REDIRECT = 'https://earnavik.com/?uber_callback=1';
export const UBER_SCOPES = 'partner.accounts partner.payments';
export function taxiProfile(profile: any): boolean {
 const roles=Array.isArray(profile?.profession_roles)&&profile.profession_roles.length
  ? profile.profession_roles.map((r:any)=>r.label)
  : Array.isArray(profile?.work_types)&&profile.work_types.length ? profile.work_types : [profile?.primary_work_type];
 return roles.some((label:any)=>['taxi private hire','taxi driver','private hire driver','taxi','private hire','uber driver'].includes(String(label||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()));
}
export function configured(env:(key:string)=>string|undefined):boolean {
 try {return env('UBER_DRIVER_APPROVED')==='true'&&!!env('UBER_CLIENT_ID')&&!!env('UBER_CLIENT_SECRET')&&atob(env('UBER_TOKEN_KEY')||'').length===32;}catch{return false;}
}
export async function stateHash(value:string):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function tokenKey(raw:string):Promise<CryptoKey>{const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));if(bytes.length!==32)throw Error('Invalid token key');return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);}
export async function sealToken(key:CryptoKey,user:string,value:object):Promise<string>{const iv=crypto.getRandomValues(new Uint8Array(12)),plain=new TextEncoder().encode(JSON.stringify(value)),encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(user)},key,plain));return btoa(String.fromCharCode(...iv,...encrypted));}
export async function openToken(key:CryptoKey,user:string,value:string):Promise<any>{const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:new TextEncoder().encode(user)},key,bytes.slice(12))));}
export function validateTokens(data:any){if(!data||typeof data.access_token!=='string'||!data.access_token||typeof data.refresh_token!=='string'||!data.refresh_token||!Number.isFinite(data.expires_in)||data.expires_in<=0||!UBER_SCOPES.split(' ').every(s=>String(data.scope||'').split(' ').includes(s)))throw Error('Uber did not grant the required access.');return data;}
export function paymentPreview(data:any){if(!Array.isArray(data?.payments))throw Error('Unexpected Uber response.');return {count:Number(data.count)||0,rows:data.payments.slice(0,50).map((p:any)=>({id:String(p.payment_id||'').slice(0,200),category:String(p.category||'other').slice(0,80),amount:typeof p.amount==='number'&&Number.isFinite(p.amount)?p.amount:null,currency:String(p.currency_code||'').slice(0,3),event_time:Number.isSafeInteger(p.event_time)?p.event_time:null,service_fee:typeof p.breakdown?.service_fee==='number'&&Number.isFinite(p.breakdown.service_fee)?p.breakdown.service_fee:null}))};}
