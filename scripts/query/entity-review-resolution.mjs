// Reviews are scoped to an immutable material revision. A new revision is reviewed anew.
export function applyEntityReview(resolved, review, registry) {
  const blocked=review?.rejected_ids??[];
  if(blocked.length)resolved={...resolved,candidates:resolved.candidates.filter(id=>!blocked.includes(id)),
    ...(blocked.includes(resolved.entity?.entity_id)?{entity:null,status:'ambiguous'}:{})};
  if(!review||review.action==='revoke') return [resolved];
  if(['defer','reject'].includes(review.action)) {
    const rejected=review.action==='reject'&&review.entity_ids.includes(resolved.entity?.entity_id);
    return [{...resolved,...(rejected?{entity:null,status:'ambiguous'}:{}),review_action:review.action,
      candidates:review.action==='reject'?resolved.candidates.filter(id=>!review.entity_ids.includes(id)):resolved.candidates}];
  }
  const entities=review.entity_ids.map(id=>registry.entities.get(id));
  if(!entities.length||entities.some(e=>!e||e.type!==resolved.type)) return [{...resolved,context_status:'review_target_unavailable'}];
  return entities.map(entity=>({...resolved,status:'curated',entity,candidates:review.entity_ids,matching:'document_review',
    evidence:review.evidence,review_id:review.review_id}));
}
