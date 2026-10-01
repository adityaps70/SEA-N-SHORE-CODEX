#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const TABLES=['table_address','table_seafearer','table_consultant','table_shore_staff','table_company','table_seafearer_experience','table_seafearer_certificate','table_consultant_qualification']
const SOURCE='beaufortmarine', CONFIRM='I_APPROVE_LEGACY_PROFILE_IMPORT'
const SYSTEM='00000000-0000-4000-8000-000000000058'
const clean=(v,n=4000)=>v==null?null:(String(v).replace(/\s+/g,' ').trim().slice(0,n)||null)
export const normalizeEmail=v=>{const e=clean(v,320)?.toLowerCase();return e&&/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)?e:null}
const d=v=>{const s=clean(v,32);return !s||s.startsWith('0000-00-00')?null:s.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]??null}
const yrs=v=>{const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=70?n:null}
const uniq=(a,n=20,m=120)=>{const s=new Set,r=[];for(const v of a){const x=clean(v,m),k=x?.toLowerCase();if(x&&k&&!s.has(k)&&r.length<n){s.add(k);r.push(x)}}return r}
const test=r=>/\btest\b/i.test(clean(r.name,250)||'')||/^test[+._-]?/i.test(clean(r.email,320)||'')||(clean(r.email,320)||'').toLowerCase().endsWith('@example.com')
const loc=r=>r?(uniq([r.city,r.state,r.country],3,120).join(', ').slice(0,120)||null):null
const slug=(n,id)=>`${String(n||'').normalize('NFKD').replace(/[^\x00-\x7F]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,55)||'legacy-organization'}-${id}`.slice(0,80).replace(/-+$/g,'')

function columns(sql,t){const a=`CREATE TABLE \`${t}\` (`,i=sql.indexOf(a);if(i<0)return[];const b=i+a.length,j=sql.indexOf(') ENGINE=',b);return j<0?[]:sql.slice(b,j).split(/\r?\n/).map(x=>x.trim().match(/^`([^`]+)`\s+/)?.[1]).filter(Boolean)}
function tuples(s){const r=[];let st=-1,dep=0,q=false,e=false;for(let i=0;i<s.length;i++){const c=s[i];if(q){if(e)e=false;else if(c==='\\')e=true;else if(c==="'")q=false;continue}if(c==="'")q=true;else if(c==='('){if(!dep)st=i+1;dep++}else if(c===')'){dep--;if(!dep&&st>=0){r.push(s.slice(st,i));st=-1}}}return r}
function fields(s){const r=[];let b='',q=false,e=false;for(const c of s){if(q){b+=c;if(e)e=false;else if(c==='\\')e=true;else if(c==="'")q=false}else if(c==="'"){q=true;b+=c}else if(c===','){r.push(b.trim());b=''}else b+=c}r.push(b.trim());return r}
function val(v){if(/^NULL$/i.test(v))return null;if(v.startsWith("'")&&v.endsWith("'")){const s=v.slice(1,-1),mp={n:'\n',r:'\r',t:'\t',b:'\b',Z:'\x1a','\\':'\\',"'":"'"};let o='';for(let i=0;i<s.length;i++)o+=s[i]==='\\'&&i+1<s.length?(mp[s[++i]]??s[i]):s[i];return o}if(/^-?\d+$/.test(v))return Number(v);if(/^-?(?:\d+\.\d*|\d*\.\d+)$/.test(v))return Number(v);return v}
export function parseLegacyDump(sql){const out=Object.fromEntries(TABLES.map(t=>[t,[]])),re=/INSERT INTO `([^`]+)` VALUES\s*([\s\S]*?);\r?\n/g;for(const m of sql.matchAll(re)){if(!TABLES.includes(m[1]))continue;const c=columns(sql,m[1]);for(const t of tuples(m[2])){const vs=fields(t).map(val);if(vs.length!==c.length)throw Error(`shape:${m[1]}`);out[m[1]].push(Object.fromEntries(c.map((k,i)=>[k,vs[i]])))}}return out}

export function buildImportPlan(t){
 const addr=new Map(t.table_address.map(r=>[Number(r.tlid),r])), exp=new Map, cert=new Map, qual=new Map
 for(const r of t.table_seafearer_experience){if(Number(r.status)!==1||!Number(r.seafearerid)||!clean(r.rank))continue;const id=Number(r.seafearerid);if(!exp.has(id))exp.set(id,[]);exp.get(id).push(r)}
 for(const r of t.table_seafearer_certificate){if(Number(r.status)!==1||!Number(r.seafearerid))continue;const id=Number(r.seafearerid);if(!cert.has(id))cert.set(id,[]);cert.get(id).push(r)}
 for(const r of t.table_consultant_qualification){if(Number(r.status)!==1||!Number(r.consultantid))continue;const id=Number(r.consultantid);if(!qual.has(id))qual.set(id,[]);qual.get(id).push(r)}
 const g=new Map;let invalid=0,tests=0
 const add=(kind,r)=>{if(Number(r.status)!==1)return;const e=normalizeEmail(r.email);if(!e){invalid++;return}if(test(r)){tests++;return}if(!g.has(e))g.set(e,[]);g.get(e).push({kind,r})}
 t.table_seafearer.forEach(r=>add('SeaFearer',r));t.table_consultant.forEach(r=>add('Consultant',r));t.table_shore_staff.forEach(r=>add('Shore_Staff',r))
 const people=[]
 for(const [email,rs] of g){rs.sort((a,b)=>({SeaFearer:0,Consultant:1,Shore_Staff:2}[a.kind]-({SeaFearer:0,Consultant:1,Shore_Staff:2}[b.kind])));const p=rs[0].r,sea=rs.filter(x=>x.kind==='SeaFearer').map(x=>x.r),con=rs.filter(x=>x.kind==='Consultant').map(x=>x.r),shore=rs.filter(x=>x.kind==='Shore_Staff').map(x=>x.r),ex=sea.flatMap(r=>exp.get(Number(r.tlid))||[]).sort((a,b)=>String(b.joining_date||'').localeCompare(String(a.joining_date||'')))
  const skills=uniq(con.flatMap(r=>(qual.get(Number(r.tlid))||[]).flatMap(q=>Object.entries({internal_audit:'Internal Auditor',lead_auditor:'Lead Auditor',nav_assessor:'Navigation Assessor',sire_inspector:'SIRE Inspector',cdi_inspector:'CDI Inspector',rightship_inspector:'RightShip Inspector',flagstate_inspector:'Flag State Inspector'}).filter(([f])=>/^(yes|1|true)$/i.test(clean(q[f],20)||'')).map(([,x])=>x))),20,80)
  const credentials=sea.flatMap(r=>(cert.get(Number(r.tlid))||[]).flatMap(c=>{const name=clean([c.certificate_type,c.type||c.lavel].filter(Boolean).join(' - '),180),issuer=clean(c.authority,180);if(!name||!issuer)return[];const expires=d(c.expiry);return[{name,issuer,number:clean(c.certificate_no,180),expires,noExpiry:!expires}]})).slice(0,100)
  people.push({email,fullName:clean(p.name,160)||email,profileType:sea.length?'seafarer':'maritime_professional',persona:sea.length?'seafarer':'shore_professional',location:sea.map(r=>loc(addr.get(Number(r.com_addressid)))||loc(addr.get(Number(r.per_addressid)))).find(Boolean)??con.map(r=>loc(addr.get(Number(r.addressid)))).find(Boolean)??null,headline:clean(sea.find(r=>clean(r.rank))?.rank??con.find(r=>clean(r.designation))?.designation??shore.find(r=>clean(r.designation))?.designation,160),summary:clean(sea.find(r=>clean(r.summery))?.summery??con.find(r=>clean(r.summery))?.summery,2000),rank:clean(sea.find(r=>clean(r.rank))?.rank,100),company:clean(ex.find(r=>clean(r.company))?.company,160),experienceYears:yrs(sea.map(r=>yrs(r.total_experience)).find(x=>x!=null)??con.map(r=>yrs(r.total_experience)).find(x=>x!=null)),vesselTypes:uniq(ex.map(r=>r.type_of_ship),20,120),skills,experiences:ex.slice(0,100).map(r=>({title:clean(r.rank,160),organization:clean(r.company,180),vesselType:clean(r.type_of_ship,120),start:d(r.joining_date),end:d(r.leaving_date)})),credentials,legacy:rs.map(x=>({object:x.kind,id:Number(x.r.tlid)}))})
 }
 const seen=new Set,organizations=t.table_company.flatMap(r=>{if(Number(r.status)!==1||test(r))return[];const name=clean(r.name,160),k=name?.toLowerCase();if(!name||!k||seen.has(k))return[];seen.add(k);return[{name,slug:slug(name,Number(r.tlid)),location:uniq([r.city,r.state,r.country],3,120).join(', ').slice(0,240)||null}]})
 return{people,organizations,audit:{people:people.length,duplicateEmailGroups:[...g.values()].filter(x=>x.length>1).length,invalidEmailRows:invalid,testRows:tests,organizations:organizations.length}}
}

async function importPerson(pool,p){
 const c=await pool.connect()
 try{await c.query('begin');await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`legacy:${p.email}`])
  const found=await c.query("select distinct profile_id from public.identity_accounts where email_verified=true and lower(email)=lower($1) order by profile_id limit 2",[p.email]);if(found.rows.length>1)throw Error('identity_conflict');let id=found.rows[0]?.profile_id
  if(!id){const x=await c.query("insert into public.profiles(id,profile_type,persona,full_name,location,headline,summary,contact_visibility,account_status) values(gen_random_uuid(),$1::public.profile_type,$2,$3,$4,$5,$6,'private','restricted') returning id",[p.profileType,p.persona,p.fullName,p.location,p.headline,p.summary]);id=x.rows[0]?.id}
  await c.query("update public.profiles set profile_type=coalesce(profile_type,$2::public.profile_type),persona=coalesce(persona,$3),location=coalesce(nullif(btrim(location),''),$4),headline=coalesce(nullif(btrim(headline),''),$5),summary=coalesce(nullif(btrim(summary),''),$6),updated_at=now() where id=$1",[id,p.profileType,p.persona,p.location,p.headline,p.summary])
  await c.query("insert into public.maritime_profiles(user_id,rank,current_company,sailing_experience_years,vessel_types,trading_areas,shore_career_preference) values($1,$2,$3,$4,$5::text[],'{}'::text[],false) on conflict(user_id) do update set rank=coalesce(nullif(btrim(public.maritime_profiles.rank),''),excluded.rank),current_company=coalesce(nullif(btrim(public.maritime_profiles.current_company),''),excluded.current_company),sailing_experience_years=coalesce(public.maritime_profiles.sailing_experience_years,excluded.sailing_experience_years),vessel_types=case when cardinality(public.maritime_profiles.vessel_types)=0 then excluded.vessel_types else public.maritime_profiles.vessel_types end,updated_at=now()",[id,p.rank,p.company,p.experienceYears,p.vesselTypes])
  for(const s of p.skills)await c.query('insert into public.profile_skills(user_id,skill) values($1,$2) on conflict do nothing',[id,s])
  for(const x of p.experiences)await c.query("insert into public.profile_experiences(profile_id,track,title,organization,vessel_type,started_on,ended_on,is_current) select $1,'sea_service',$2,$3,$4,$5::date,$6::date,$6::date is null where not exists(select 1 from public.profile_experiences e where e.profile_id=$1 and e.track='sea_service' and lower(e.title)=lower($2) and coalesce(lower(e.organization),'')=coalesce(lower($3),'') and e.started_on is not distinct from $5::date and e.ended_on is not distinct from $6::date)",[id,x.title,x.organization,x.vesselType,x.start,x.end])
  for(const x of p.credentials)await c.query("insert into public.profile_credentials(profile_id,name,issuer,credential_number,expires_on,no_expiry,verification_state) select $1,$2,$3,$4,$5::date,$6,'self_reported' where not exists(select 1 from public.profile_credentials q where q.profile_id=$1 and lower(q.name)=lower($2) and lower(q.issuer)=lower($3) and coalesce(lower(q.credential_number),'')=coalesce(lower($4),''))",[id,x.name,x.issuer,x.number,x.expires,x.noExpiry])
  for(const x of p.legacy)await c.query("insert into public.legacy_profile_claims(source_system,legacy_object,legacy_id,profile_id,email,claimed_at) values($1,$2,$3,$4,$5,case when $6 then now() else null end) on conflict(source_system,legacy_object,legacy_id) do update set profile_id=excluded.profile_id,email=excluded.email,claimed_at=case when public.legacy_profile_claims.claimed_at is not null then public.legacy_profile_claims.claimed_at when $6 then now() else null end,updated_at=now()",[SOURCE,x.object,x.id,id,p.email,Boolean(found.rows[0])])
  await c.query('commit');return found.rows[0]?'merged':'created'
 }catch(e){await c.query('rollback');throw e}finally{c.release()}
}
async function apply(plan){
 if(process.env.LEGACY_IMPORT_CONFIRM!==CONFIRM)throw Error(`Set LEGACY_IMPORT_CONFIRM=${CONFIRM}.`)
 const {Pool}=await import('pg');for(const k of['AURORA_HOST','AURORA_DATABASE','AURORA_USER','AURORA_PASSWORD'])if(!process.env[k])throw Error(`${k} required`)
 const pool=new Pool({host:process.env.AURORA_HOST,port:Number(process.env.AURORA_PORT||5432),database:process.env.AURORA_DATABASE,user:process.env.AURORA_USER,password:process.env.AURORA_PASSWORD,ssl:process.env.AURORA_SSL!=='false',max:2}),r={merged:0,createdRestricted:0,failed:0,organizations:0}
 try{if(!(await pool.query("select to_regclass('public.legacy_profile_claims') name")).rows[0]?.name)throw Error('Apply migration 0058 first.')
  for(const p of plan.people)try{
   const action=await importPerson(pool,p)
   if(action==='merged')r.merged++
   else r.createdRestricted++
  }catch(e){r.failed++;console.error('[legacy_import_failed]',Buffer.from(p.email).toString('base64url').slice(0,12),e instanceof Error?e.message:e)}
  await pool.query("insert into public.profiles(id,full_name,contact_visibility,account_status) values($1,'Sea N Shore Legacy Import','private','restricted') on conflict(id) do nothing",[SYSTEM])
  for(const o of plan.organizations){await pool.query("insert into public.companies(slug,name,company_type,office_locations,created_by,claim_status) select $1,$2,'Maritime Organization',$3::text[],$4,'unclaimed' where not exists(select 1 from public.companies c where lower(btrim(c.name))=lower(btrim($2))) on conflict(slug) do nothing",[o.slug,o.name,o.location?[o.location]:[],SYSTEM]);r.organizations++}return r
 }finally{await pool.end()}
}
async function main(){const path=process.argv[2]||process.env.LEGACY_SQL_DUMP;if(!path)throw Error('Pass legacy SQL dump path.');const plan=buildImportPlan(parseLegacyDump(await readFile(path,'utf8'))),result=(process.env.LEGACY_IMPORT_MODE||'plan')==='apply'?await apply(plan):null;console.log(JSON.stringify({sourceSystem:SOURCE,peopleEligibleForAutomaticImport:plan.audit.people,duplicateLegacyIdentityGroupsMergedByEmail:plan.audit.duplicateEmailGroups,invalidEmailRowsHeldForManualReview:plan.audit.invalidEmailRows,obviousTestRowsExcluded:plan.audit.testRows,organizationsEligibleForUnclaimedPages:plan.audit.organizations,oldPasswordsImported:false,oldMembershipsImported:false,oldJobApplicationsImported:false,oldPaymentHistoryImported:false,applyResult:result},null,2))}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exitCode=1})
