import test from 'node:test';
import assert from 'node:assert/strict';
import {graphEnabled, refreshGraphIndex, graphQuery} from '../scripts/query/graph-hooks.mjs';
import {queryProfile} from '../scripts/query/profile.mjs';
import {execute} from '../scripts/query/service.mjs';

test('graph capability follows the deployment adapter',async()=>{
  assert.equal(graphEnabled,Boolean(queryProfile.graphAdapter));
  if(queryProfile.name==='quant') {
    assert.equal(graphEnabled,false);
    assert.equal(await refreshGraphIndex(null),null);
    assert.throws(()=>graphQuery(null,{}),error=>error.data?.code==='UNSUPPORTED_CAPABILITY');
    await assert.rejects(execute('graph',{}),error=>error.data?.code==='UNKNOWN_OPERATION' && error.status===404);
  } else assert.equal(graphEnabled,true);
});
