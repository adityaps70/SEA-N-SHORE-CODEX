const TYPES=['SMS Coverage Gap','Procedure-to-Evidence Gap','Procedure-to-Practice Gap','Procedure-to-Human Gap','Evidence / Interview Contradiction','Revision Gap','Repeat / Historical Gap','Unverified High-Risk Area'];
const allowed=new Set(TYPES);

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(req.method==='GET') return res.status(200).json({ok:true,service:'AuditOS Gap Analysis',aiConfigured:Boolean(process.env.AI_GATEWAY_API_KEY||process.env.VERCEL_OIDC_TOKEN)});
  if(req.method!=='POST') return res.status(405).json({message:'Method not allowed'});

  const body=req.body||{};
  const c=body.context||{};
  const deterministic=body.deterministic||{readiness:0,readinessLabel:'Evidence coverage',gaps:[]};
  const token=process.env.AI_GATEWAY_API_KEY||process.env.VERCEL_OIDC_TOKEN;
  if(!token) return res.status(200).json({...deterministic,aiUsed:false,aiMessage:'AI deep review is unavailable; deterministic gap analysis retained.'});

  try{
    const schema={type:'object',additionalProperties:false,properties:{overview:{type:'string'},gaps:{type:'array',items:{type:'object',additionalProperties:false,properties:{id:{type:'string'},type:{type:'string',enum:TYPES},title:{type:'string'},priority:{type:'string',enum:['Critical','High','Medium','Low']},why:{type:'string'},missingProof:{type:'string'},nextActions:{type:'array',items:{type:'string'}},sources:{type:'array',items:{type:'string'}}},required:['id','type','title','priority','why','missingProof','nextActions','sources']}}},required:['overview','gaps']};
    const prompt=`Perform a professional maritime audit GAP ANALYSIS only. A gap is an item requiring further verification, not a finding or compliance conclusion.\n\nCompany: ${c.company||'Not provided'}\nVessel: ${c.vessel||'Not provided'}\nAudit type: ${c.auditType||'Not provided'}\nArea/topic: ${c.topic||'Not provided'}\nRequirement/inspection expectation: ${c.requirement||'Not provided'}\nCompany SMS/procedure: ${c.companyControl||'Not provided'}\nDocumentary/record evidence: ${c.documentaryEvidence||'Not provided'}\nCrew interview evidence: ${c.interviewEvidence||'Not provided'}\nPhysical/practical verification: ${c.physicalEvidence||'Not provided'}\nHistory/previous finding/revision context: ${c.history||'Not provided'}\n\nDeterministic flags already identified:\n${(deterministic.gaps||[]).map(g=>'- '+g.type+': '+g.title).join('\n')||'None'}\n\nIdentify only evidence-supported investigation gaps. State exactly what remains unproved and what the auditor should verify next. Highlight contradictions, revision mismatch, repeat-risk and gaps between procedure, records, crew understanding and actual practice. Preserve uncertainty.`;

    const gateway=await fetch('https://ai-gateway.vercel.sh/v1/responses',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
      body:JSON.stringify({
        model:'openai/gpt-5.6-sol',
        reasoning:{effort:'medium'},
        max_output_tokens:2600,
        providerOptions:{gateway:{disallowPromptTraining:true}},
        instructions:'You are AuditOS Gap Analysis for professional maritime auditors. AI suggests; auditor decides. Never declare compliance/non-compliance. Never create or approve findings. Missing evidence is not proof of non-compliance. Distinguish supplied evidence from inference and recommend objective verification.',
        input:[{type:'message',role:'user',content:[{type:'input_text',text:prompt}]}],
        text:{format:{type:'json_schema',name:'auditos_gap_analysis',strict:true,schema}}
      })
    });
    if(!gateway.ok) throw new Error('AI Gateway '+gateway.status);
    const raw=await gateway.json();
    let output=raw.output_text||'';
    if(!output) for(const item of raw.output||[]) for(const part of item.content||[]) if(part.type==='output_text'&&part.text) output=part.text;
    if(!output) throw new Error('No AI output');
    const ai=JSON.parse(output);
    const gaps=(ai.gaps||[]).filter(g=>allowed.has(g.type)).map((g,i)=>({...g,id:g.id||`ai_${Date.now()}_${i}`,status:'open'}));
    return res.status(200).json({overview:ai.overview||'',gaps,readiness:deterministic.readiness,readinessLabel:deterministic.readinessLabel,aiUsed:true});
  }catch(error){
    return res.status(200).json({...deterministic,aiUsed:false,aiMessage:'AI deep review is temporarily unavailable; deterministic gap analysis retained.'});
  }
};
