// Bounded reading projection over P1 objects. No facts are inferred from layout.
import { contracts } from './prd-model.mjs';
const htmlEscape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const mdEscape=s=>String(s).replaceAll('\\','\\\\').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('|','\\|').replace(/\r?\n/g,'<br>').replace(/([\[\]`*_])/g,'\\$1');
const label=k=>k.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,x=>x.toUpperCase());
const present=x=>x===undefined||x===null?'Not modeled':String(x);

export function componentRenderer(objects, anchor, overflow, {html=true,referenced=false}={}) {
  const map=new Map(objects.map(o=>[o.id,o])), activitiesByVariant=new Map();let projectedBytes=0;
  for(const o of objects) if(o.type==='activity') for(const r of o.refs||[]) if(r.relation==='variant'&&r.target){if(!activitiesByVariant.has(r.target))activitiesByVariant.set(r.target,[]);activitiesByVariant.get(r.target).push(o);}
  const name=id=>map.get(id)?.title||String(id);
  const refs=(o,relation)=> (o.refs||[]).filter(r=>r.relation===relation&&r.target).map(r=>map.get(r.target)).filter(Boolean);
  const source=(o)=>{
    const anchors=(o.refs||[]).filter(r=>r.relation==='derivedFrom');
    if(!anchors.length)return 'Source not disclosed or not modeled.';
    return anchors.map(r=>{const s=map.get(r.target);return referenced ? `${s?.title||'Source'}${r.locator?`, ${r.locator}`:''} (see full facts)` : `${s?.title||'Source'}${s?.source?.version?` (version ${s.source.version}; SHA-256 ${s.source.sha256})`:''}${r.locator?`, ${r.locator}`:''}${r.quote?`; quote: “${r.quote}”`:''}${r.interpretation?`; interpretation: ${r.interpretation}`:''}`;}).join('\n');
  };
  const predicate=p=>{
    if(!p)return 'Not modeled';
    if(p.question)return `TBC — question ${p.question}: ${name(p.question)}`;
    if(Object.hasOwn(p,'constant'))return p.constant?'Always':'Never';
    if(p.field){const operators={eq:'equals',ne:'is not equal to',lt:'is less than',le:'is at most',gt:'is greater than',ge:'is at least'};return `${name(p.field)} ${operators[p.op]||p.op} ${JSON.stringify(p.value)}`;}
    if(p.all)return `All of (${p.all.map(predicate).join('; ')})`;
    if(p.any)return `Any of (${p.any.map(predicate).join('; ')})`;
    if(p.not)return `Not (${predicate(p.not)})`;
    return 'Not modeled';
  };
  function detail(value,key=''){
    if(value===null)return 'null';
    if(Array.isArray(value))return value.length?value.map(v=>detail(v,key)).join('; '):'None authored';
    if(typeof value==='object'){
      if(['question','constant','field','all','any','not'].some(k=>Object.hasOwn(value,k)))return predicate(value);
      if(Object.hasOwn(value,'value')&&Object.keys(value).length===1)return value.value;
      if(Object.hasOwn(value,'gap')&&Object.keys(value).length===1)return `Gap: ${value.gap}`;
      return Object.entries(value).map(([k,v])=>`${label(k)}: ${detail(v,k)}`).join('; ')||'None authored';
    }
    if(key==='scope'&&typeof value==='string')return name(value);
    return String(value);
  }
  const refSummary=o=>(o.refs||[]).filter(r=>r.type!=='source').map(r=>r.target?`${label(r.relation)}: ${name(r.target)}`:r.explanation||'').filter(Boolean).join('\n')||'No modeled relationships';
  const detailSummary=o=>{
    const parts=Object.entries(o.detail||{}).map(([k,v])=>`${label(k)}: ${detail(v,k)}`);
    if(referenced&&o.rule)parts.push(ruleText(o,o));
    if(['action','api','integration'].includes(o.type)&&o.detail?.contracts) for(const key of contracts) if(!Object.hasOwn(o.detail.contracts,key)) parts.push(`${label(key)}: Not modeled`);
    if(o.gap) parts.push(`Gap: ${o.gap}`);
    for(const gap of o.disclosureGaps||[]) parts.push(`Disclosure gap: ${gap}`);
    return parts.join('\n')||'No additional facts modeled';
  };
  function rulesFor(o){
    const definitions=refs(o,'field'), variants=[...refs(o,'variant'),...(map.get(o.parent)?.type==='variant'?[map.get(o.parent)]:[])];
    const rules=[...refs(o,'rule'),...definitions.flatMap(f=>refs(f,'rule')),...variants.flatMap(v=>refs(v,'rule'))];
    return [...new Map(rules.map(r=>[r.id,r])).values()];
  }
  function ruleText(rule,context){
    if(!rule.rule)return `${rule.title}: rule details not disclosed.`;
    const r=rule.rule, scope=(r.scope||[]).map(name).join(', ');
    const contexts=new Set(), queue=[context], ancestors=new Set();let ancestor=context,explicitActivity=false;
    while(ancestor&&!ancestors.has(ancestor.id)){ancestors.add(ancestor.id);if(ancestor.type==='activity')explicitActivity=true;ancestor=map.get(ancestor.parent);}
    for(let i=0;i<queue.length;i++){const current=queue[i];if(!current||contexts.has(current.id))continue;contexts.add(current.id);if(current.parent)queue.push(map.get(current.parent));for(const ref of current.refs||[])if(['variant','field','actor'].includes(ref.relation)&&ref.target)queue.push(map.get(ref.target));if(current.type==='variant'&&!explicitActivity)queue.push(...(activitiesByVariant.get(current.id)||[]));}
    const inScope=(r.scope||[]).some(id=>contexts.has(id));
    const exceptions=(r.exceptions||[]).filter(e=>!inScope||e.scope.some(id=>contexts.has(id)));
    const clauses=[`${rule.title}: ${predicate(r.condition)} → ${r.effect}`,`Scope: ${scope}`,`Unit: ${present(r.unit)}; precision: ${present(r.precision)}; time: ${present(r.time)}`];
    if(!inScope&&context.id!==rule.id) clauses.push('Applicability to this context is not established by the authored scope.');
    for(const e of exceptions) clauses.push(`Exception for ${e.scope.map(name).join(', ')}: ${predicate(e.condition)} → ${e.effect}`);
    return clauses.join('\n');
  }
  function ruleList(o){const rules=rulesFor(o);return rules.length?rules.map(r=>ruleText(r,o)).join('\n'):'No linked rule modeled';}
  function context(o){
    const parents=[],seen=new Set();let p=map.get(o.parent);
    while(p&&!seen.has(p.id)){seen.add(p.id);parents.push(`${label(p.type)}: ${p.title}`);p=map.get(p.parent);}
    for(const v of refs(o,'variant'))parents.push(`Variant: ${v.title}`);
    const variants=[...refs(o,'variant'),...(map.get(o.parent)?.type==='variant'?[map.get(o.parent)]:[])];
    const direct=map.get(o.parent)?.type==='activity'?map.get(o.parent):null;
    const activities=(direct?[direct]:variants.flatMap(v=>activitiesByVariant.get(v.id)||[])).filter(x=>x?.type==='activity');
    for(const activity of new Map(activities.map(a=>[a.id,a])).values()){if(activity.id!==o.parent)parents.push(`Activity: ${activity.title}`);for(const actor of refs(activity,'actor'))parents.push(`Role: ${actor.title}`);}
    return parents.join('\n')||'No contextual parent modeled';
  }
  function table(headers, rows) {
    if(!rows.length)return {html:'',markdown:''};
    let h=html?`<table${headers.length>4?' class="wide"':''}><thead><tr>${headers.map(x=>`<th>${htmlEscape(x)}</th>`).join('')}</tr></thead><tbody>`:'',m=`| ${headers.map(mdEscape).join(' | ')} |\n| ${headers.map(()=> '---').join(' | ')} |\n`;
    for(const row of rows){const a=row.id?anchor(row.id):null;if(html)h+='<tr>'+row.cells.map((v,i)=>`<td>${i===0&&a?`<span id="${htmlEscape(a)}"></span>`:''}${htmlEscape(v).replaceAll('\n','<br>')}</td>`).join('')+'</tr>';m+=`| ${row.cells.map((v,i)=>`${i===0&&a?`<a id="${a}"></a>`:''}${mdEscape(v)}`).join(' | ')} |\n`;}
    return {html:html?h+'</tbody></table>':'',markdown:m+'\n'};
  }
  function narrative(headers, rows, type) {
    let h='',m='';
    // The compact index only contains short field names and type traits. Longer
    // authored values stay intact in the full-width prose below.
    const compact=type==='data-fields'?rows.filter(r=>r.cells[0].length<=160&&r.cells[2].length<=240):[];
    if(compact.length){
      m+='| Field / binding | Type, unit and precision |\n| --- | --- |\n';
      if(html)h+='<table><thead><tr><th>Field / binding</th><th>Type, unit and precision</th></tr></thead><tbody>';
      for(const row of compact){m+=`| ${mdEscape(row.cells[0])} | ${mdEscape(row.cells[2])} |\n`;if(html)h+=`<tr><td>${htmlEscape(row.cells[0]).replaceAll('\n','<br>')}</td><td>${htmlEscape(row.cells[2]).replaceAll('\n','<br>')}</td></tr>`;}
      m+='\n';if(html)h+='</tbody></table>';
    }
    for(const row of rows){
      const a=row.id?anchor(row.id):null, target=`fact-${row.id}`;
      m+=`### ${mdEscape(row.cells[0])}\n\n${a?`<a id="${a}"></a>\n\n`:''}`;
      if(html)h+=`<h3${a?` id="${htmlEscape(a)}"`:''}>${htmlEscape(row.cells[0]).replaceAll('\n','<br>')}</h3>`;
      if(row.qualifications){m+=`**Qualifications:** ${mdEscape(row.qualifications)}\n\n`;if(html)h+=`<p><strong>Qualifications:</strong> ${htmlEscape(row.qualifications).replaceAll('\n','<br>')}</p>`;}
      // Keep long values full-width instead of spreading them across columns.
      for(let i=1;i<headers.length;i++){
        m+=`**${mdEscape(headers[i])}:** ${mdEscape(row.cells[i])}\n\n`;
        if(html)h+=`<p><strong>${htmlEscape(headers[i])}:</strong> ${htmlEscape(row.cells[i]).replaceAll('\n','<br>')}</p>`;
      }
      m+=`[Full authored facts](appendix.md#${target})\n\n`;
      if(html)h+=`<p><a href="appendix.html#${htmlEscape(target)}">Full authored facts</a></p>`;
      for(const citation of row.citations){
        m+=`Source evidence: [${mdEscape(citation.title)}](appendix.md#fact-${citation.id})\n\n`;
        if(html)h+=`<p>Source evidence: <a href="appendix.html#fact-${htmlEscape(citation.id)}">${htmlEscape(citation.title)}</a></p>`;
      }
    }
    return {html:h,markdown:m};
  }
  function render(c){
    const rows=[];let headers;
    switch(c.type){
      case 'control': headers=['Document / record','Purpose and authority','Document facts','Lineage'];break;
      case 'overview': headers=['Scope item','Purpose and authority','Scope and boundaries','Relationships'];break;
      case 'capability-index': headers=['Capability','Purpose and status','Classification and priority','Relationships'];break;
      case 'role-journey': headers=['Journey / activity','Goal and status','Role, entry and conditions','Related activities and interfaces'];break;
      case 'process-view': headers=['Activity','Purpose and status','Actor and context','Related actions and flow'];break;
      case 'interface': headers=['Interface / section / variant','Purpose and status','Kind and state','Context and relationships'];break;
      case 'element-behavior': headers=['Element / binding / rule','Context','Kind and behavior','Rules and exceptions'];break;
      case 'data-fields': headers=['Field / contextual binding','Definition and context','Type, unit and precision','Visibility / editable / required','Rules and applicable exceptions','Source'];break;
      case 'scenario': headers=['Scenario / action','Purpose and authority','Scenario, outcome and expectation','Related actions and acceptance'];break;
      case 'lifecycle': headers=['Entity / state / transition','Purpose and authority','Lifecycle or runtime facts','Related states'];break;
      case 'integration': case 'development-appendix': headers=['Contract / requirement','Purpose and authority','Contract and facts','Relationships and evidence'];break;
      case 'evidence': headers=['Evidence / decision / question','Purpose and authority','Scope, interpretation and decision facts','Source and lineage'];break;
      default: headers=['Item','Purpose and authority','Authored facts','Relationships'];
    }
    for(const o of c.objects){
      let cells;const summary=`${o.purpose}\nStatus: ${o.status}${o.priority?`\nPriority: ${o.priority}`:''}`;
      switch(c.type){
        case 'element-behavior': cells=[`${o.title} (${o.type})`,context(o),`${detailSummary(o)}\n${refSummary(o)}`,o.type==='rule'?ruleText(o,o):ruleList(o)];break;
        case 'data-fields': {
          const field=o.type==='binding'?refs(o,'field')[0]:o.type==='field'?o:undefined;
          const traits=field?['dataType','unit','precision'].map(k=>`${label(k)}: ${present(field.detail?.[k])}`).join('\n'):'Not modeled';
          const states=o.type==='binding'?['visibility','editable','required'].map(k=>`${label(k)}: ${predicate(o.detail?.[k])}${o.detail?.[k]?.question?` (binding ${o.id}, detail/${k})`:''}`).join('\n'):'Not a contextual binding';
          cells=[`${o.title} (${o.type})`,`${field?`${field.title}: ${field.purpose}`:o.purpose}\n${context(o)}`,traits,states,o.type==='rule'?ruleText(o,o):ruleList(o),source(field||o)];break;
        }
        case 'evidence': cells=[`${o.title} (${o.type})`,summary,`${detailSummary(o)}${o.content?`\nUnsupported content: ${o.content}`:''}`,`${source(o)}\n${refSummary(o)}${o.source&&!referenced?`\nVersion: ${o.source.version}\nSHA-256: ${o.source.sha256}\nLocator: ${o.source.locator}\nOriginal: ${o.source.text}`:''}`];break;
        case 'integration': case 'development-appendix': cells=[`${o.title} (${o.type})`,summary,detailSummary(o),`${refSummary(o)}\n${source(o)}`];break;
        case 'role-journey': case 'process-view': cells=[`${o.title} (${o.type})`,summary,`${context(o)}\n${detailSummary(o)}`,refSummary(o)];break;
        case 'interface': cells=[`${o.title} (${o.type})`,summary,detailSummary(o),`${context(o)}\n${refSummary(o)}`];break;
        default: cells=[`${o.title} (${o.type})`,summary,`${detailSummary(o)}${o.content?`\nUnsupported content: ${o.content}`:''}`,refSummary(o)];
      }
      if(o.reviewNeeded||o.review?.causes?.length||o.review?.summaryCauses?.length)cells[0]+='\nTechnical review needed; this flag does not establish customer confirmation or business approval.';
      projectedBytes+=cells.reduce((total,cell)=>total+Buffer.byteLength(cell),0);if(projectedBytes>16*1024*1024)overflow();
      const citationOwners=[o,...(o.type==='binding'?refs(o,'field'):[])],citations=[...new Map(citationOwners.filter(x=>(x.refs||[]).some(r=>r.relation==='derivedFrom')).map(x=>[x.id,{id:x.id,title:x.title}])).values()];
      const qualifications=referenced&&c.type==='data-fields'?citationOwners.map(item=>`${item===o?'This item':'Field definition'} — ${item.title}: ${item.purpose}\nAuthority: ${item.status}${item.priority?`\nPriority: ${item.priority}`:''}${item.gap?`\nGap: ${item.gap}`:''}${(item.disclosureGaps||[]).map(g=>`\nDisclosure gap: ${g}`).join('')}`).join('\n'):'';
      projectedBytes+=Buffer.byteLength(qualifications);if(projectedBytes>16*1024*1024)overflow();
      rows.push({id:o.id,cells,citations,qualifications});
    }
    return referenced?narrative(headers,rows,c.type):table(headers,rows);
  }
  return {render};
}
