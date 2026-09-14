// Bun entry point: native, atomic title-context reindex after a persistent shared-service 502.
import {loadConfig,toEngineConfig} from '../vendor/gbrain/src/core/config.ts';
import {createEngine} from '../vendor/gbrain/src/core/engine-factory.ts';
import {configureGateway} from '../vendor/gbrain/src/core/ai/gateway.ts';
import {buildGatewayConfig} from '../vendor/gbrain/src/core/ai/build-gateway-config.ts';
import {loadSourceRow,reembedPageWithContextualRetrieval} from '../vendor/gbrain/src/core/contextual-retrieval-service.ts';
import {resolveContextualRetrievalMode} from '../vendor/gbrain/src/core/contextual-retrieval-resolver.ts';

const slug=process.argv[2],sourceId=process.env.GBRAIN_SOURCE;
if(!slug||!sourceId)throw new Error('Explicit page slug and source required');
const config=loadConfig();if(!config)throw new Error('Missing GBrain configuration');
configureGateway(buildGatewayConfig(config));
const engine=await createEngine(toEngineConfig(config));
try {
  await engine.connect(toEngineConfig(config));
  const page=await engine.getPage(slug,{sourceId});
  if(!page?.title?.trim())throw new Error('A real document title is required');
  const source=await loadSourceRow(engine,sourceId);
  const resolution=resolveContextualRetrievalMode({pageFrontmatter:page.frontmatter??{},source,globalMode:'title'});
  if(resolution.mode!=='title')throw new Error('Title fallback conflicts with contextual retrieval override');
  const result=await reembedPageWithContextualRetrieval({engine,pageSlug:slug,sourceId,globalMode:'title'});
  if(result.kind!=='success')throw new Error('Title-context indexing failed: '+JSON.stringify(result));
  console.log(JSON.stringify(result));
} finally {await engine.disconnect();}
