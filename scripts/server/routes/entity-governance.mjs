import { withRead } from '../../query/store.mjs';
import { reviewQueue,reviewDetail,saveReview } from '../../query/entity-governance.mjs';
import { readJson } from '../security.mjs';
import { getSql } from '../db.mjs';
export function registerEntityGovernanceRoutes(router) {
  router.route('GET','/api/entity-governance',({url})=>withRead(run=>reviewQueue(run,{q:url.searchParams.get('q')??'',offset:Number(url.searchParams.get('offset')??0),status:url.searchParams.get('status')??'pending'})));
  router.route('GET','/api/entity-governance/detail',({url})=>withRead(run=>reviewDetail(run,Object.fromEntries(url.searchParams))));
  router.route('POST','/api/entity-governance/review',async ({req})=>saveReview(await getSql(),await readJson(req,32768)));
}
