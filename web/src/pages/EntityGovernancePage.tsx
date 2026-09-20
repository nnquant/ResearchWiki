import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, pageUrl } from '../api/client';
import { useCrumbs } from '../app/UiContext';
import { ErrorBlock, Loading } from '../app/ui';

type Mention={document_id:string;revision_id:string;mention_key:string;entity_type:string;normalized_name:string;raw_value:string;title:string;slug:string;status:string;review_action?:string};
type Entity={entity_id:string;name:string;source:string};
type Block={block_id:string;ordinal:number;pdf_page:number|null;text:string};
type Detail={mention:Mention;candidates:Entity[];blocks:Block[];review_id:string;history:{review_id:string;action:string;reason:string;created_at:string}[]};
const labels:Record<string,string>={company:'公司',security:'证券',industry:'行业',subfield:'领域',topic:'主题',observed:'待核验',ambiguous:'有歧义',curated:'已确认',confirm:'确认',split:'拆分',reject:'拒绝',defer:'暂缓',revoke:'撤销'};
export function EntityGovernancePage() {
  useCrumbs([{label:'图谱',to:'/graph'},{label:'实体治理'}]);
  const client=useQueryClient();
  const [q,setQ]=useState(''),[search,setSearch]=useState(''),[status,setStatus]=useState('pending'),[offset,setOffset]=useState(0);
  const [selected,setSelected]=useState<Mention|null>(null),[candidateQ,setCandidateQ]=useState(''),[candidateSearch,setCandidateSearch]=useState('');
  const [ids,setIds]=useState<string[]>([]),[quotes,setQuotes]=useState<Record<string,{block_id:string;quote:string}>>({}),[reason,setReason]=useState('');
  const [saving,setSaving]=useState(false),[message,setMessage]=useState(''),[actionError,setActionError]=useState<Error|null>(null);
  const queue=useQuery({queryKey:['entity-governance',search,status,offset],queryFn:({signal})=>api<{results:Mention[];next_offset:number|null}>(`/api/entity-governance?${new URLSearchParams({q:search,status,offset:String(offset)})}`,{signal})});
  const detail=useQuery({queryKey:['entity-governance-detail',selected?.document_id,selected?.mention_key,candidateSearch],enabled:!!selected,queryFn:({signal})=>api<Detail>(`/api/entity-governance/detail?${new URLSearchParams({document_id:selected!.document_id,mention_key:selected!.mention_key,q:candidateSearch})}`,{signal})});
  const choose=(row:Mention)=>{setSelected(row);setIds([]);setQuotes({});setReason('');setCandidateQ('');setCandidateSearch('');setMessage('');setActionError(null);};
  const save=async(action:string)=>{
    const d=detail.data;if(!d)return;setSaving(true);setActionError(null);setMessage('');
    try {
      const entityIds=['defer','revoke'].includes(action)?[]:ids;
      const evidence=['confirm','split'].includes(action)?entityIds.map(entity_id=>({entity_id,...(quotes[entity_id]??{block_id:'',quote:''})})):[];
      const result=await api<{index_pending:boolean}>('/api/entity-governance/review',{method:'POST',body:{document_id:d.mention.document_id,revision_id:d.mention.revision_id,
        entity_type:d.mention.entity_type,normalized_name:d.mention.normalized_name,action,entity_ids:entityIds,evidence,reason,expected_review_id:d.review_id}});
      setMessage(result.index_pending?'操作已保存，图谱正在等待增量更新。':'操作已保存，材料图谱已更新。');
      await client.invalidateQueries({queryKey:['entity-governance']});await detail.refetch();
    } catch(e) {setActionError(e as Error);} finally{setSaving(false);}
  };
  return <div className="content-inner entity-governance">
    <div className="row"><h1>实体与别名治理</h1><Link className="btn" to="/graph">返回图谱</Link></div>
    <p className="muted">按材料版本核验名称。确认与拆分只影响当前材料；原始标签保留，新版本会重新核验。</p>
    <form className="row" onSubmit={e=>{e.preventDefault();setSearch(q);setOffset(0);}}>
      <input aria-label="筛选待核验名称" placeholder="名称或缩写" value={q} onChange={e=>setQ(e.target.value)}/>
      <select aria-label="治理状态" value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);}}><option value="pending">待核验</option><option value="reviewed">已处理（含暂缓、拒绝）</option><option value="all">全部</option></select><button className="btn">筛选</button>
    </form>
    <div className="entity-governance-columns">
      <section aria-label="待核验队列">
        {queue.isLoading&&<Loading/>}{queue.error&&<ErrorBlock error={queue.error}/>}
        {queue.data?.results.length===0&&<p className="muted">当前条件下没有记录。</p>}
        {queue.data?.results.map(m=><button key={`${m.document_id}:${m.mention_key}`} className={`entity-review-item ${selected?.document_id===m.document_id&&selected?.mention_key===m.mention_key?'active':''}`} onClick={()=>choose(m)}>
          <strong>{m.raw_value}</strong><span className="small muted">{labels[m.entity_type]??m.entity_type} · {labels[m.review_action??m.status]??m.status}</span><span className="entity-review-title">{m.title}</span>
        </button>)}
        <div className="row"><button className="btn" disabled={!offset||queue.isFetching} onClick={()=>setOffset(Math.max(0,offset-50))}>上一页</button><span>{offset/50+1}</span><button className="btn" disabled={queue.data?.next_offset==null||queue.isFetching} onClick={()=>setOffset(queue.data!.next_offset!)}>下一页</button></div>
      </section>
      <section aria-label="核验证据与操作">
        {!selected&&<p className="muted">选择左侧名称，查看候选实体和原文。</p>}{detail.isLoading&&selected&&<Loading/>}{detail.error&&<ErrorBlock error={detail.error}/>}
        {detail.data&&<>
          <h2>{detail.data.mention.raw_value}</h2><Link to={pageUrl(detail.data.mention.slug)} target="_blank">{detail.data.mention.title}</Link>
          <p className="small muted">影响：1 份材料中同类型、同名称的所有元数据字段。版本 {detail.data.mention.revision_id.slice(0,12)}</p>
          <h3>原文证据</h3><p className="small muted">优先展示包含名称的片段；未找到不代表全文不存在。可打开材料继续核验。</p>
          {detail.data.blocks.map(b=><details key={b.block_id}><summary>段落 {b.ordinal+1} · {b.pdf_page?`第 ${b.pdf_page} 页`:'无页码'}</summary><pre style={{whiteSpace:'pre-wrap'}}>{b.text}</pre></details>)}
          <h3>候选实体</h3><form className="row" onSubmit={e=>{e.preventDefault();setCandidateSearch(candidateQ);setIds([]);setQuotes({});}}><input aria-label="查询候选实体" value={candidateQ} onChange={e=>setCandidateQ(e.target.value)} placeholder="用完整名称寻找实体"/><button className="btn">查找</button></form>
          {detail.data.candidates.length===0&&<p className="muted">没有已确认候选。可补充完整名称，或暂缓处理。</p>}
          {detail.data.candidates.map(c=><div key={c.entity_id} className="entity-candidate"><label><input type="checkbox" checked={ids.includes(c.entity_id)} onChange={e=>setIds(e.target.checked?[...ids,c.entity_id]:ids.filter(id=>id!==c.entity_id))}/> {c.name}</label><div className="small muted">{c.entity_id}</div><div className="small">来源：{c.source}</div>
            {ids.includes(c.entity_id)&&<><select aria-label={`${c.name} 证据块`} value={quotes[c.entity_id]?.block_id??''} onChange={e=>setQuotes({...quotes,[c.entity_id]:{block_id:e.target.value,quote:quotes[c.entity_id]?.quote??''}})}><option value="">选择原文块</option>{detail.data!.blocks.map(b=><option key={b.block_id} value={b.block_id}>段落 {b.ordinal+1} · {b.pdf_page?`第 ${b.pdf_page} 页`:'无页码'}</option>)}</select><textarea aria-label={`${c.name} 原文引文`} placeholder="粘贴能够确认身份的原文；拆分时每个实体分别提供证据" value={quotes[c.entity_id]?.quote??''} onChange={e=>setQuotes({...quotes,[c.entity_id]:{block_id:quotes[c.entity_id]?.block_id??'',quote:e.target.value}})}/></>}
          </div>)}
          <label>处理理由<textarea value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)} placeholder="说明判断依据，所有操作都保留记录"/></label>
          <div className="row"><button className="btn" disabled={saving||ids.length!==1||!reason.trim()} onClick={()=>save('confirm')}>确认所选实体</button><button className="btn" disabled={saving||ids.length<2||!reason.trim()} onClick={()=>save('split')}>拆分为多个实体</button><button className="btn" disabled={saving||!ids.length||!reason.trim()} onClick={()=>save('reject')}>拒绝所选候选</button><button className="btn" disabled={saving||!reason.trim()} onClick={()=>save('defer')}>暂缓</button><button className="btn" disabled={saving||!detail.data.history.length||!reason.trim()} onClick={()=>save('revoke')}>撤销人工判断</button></div>
          {message&&<p role="status">{message}</p>}{actionError&&<ErrorBlock error={actionError}/>}
          <h3>操作记录</h3>{detail.data.history.map(h=><p className="small" key={h.review_id}>{h.created_at} · {labels[h.action]??h.action} · {h.reason}</p>)}
        </>}
      </section>
    </div>
  </div>;
}
