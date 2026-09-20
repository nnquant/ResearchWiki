import fs from 'node:fs/promises';
import path from 'node:path';
import {deepseekOffPeakWindow} from './deepseek-off-peak.mjs';
import {articleConcurrency} from './article-concurrency.mjs';

function validate(cfg) {
  if(!cfg?.model||!cfg.baseUrl||(cfg.transport==='codebuddy-cli'?!cfg.cliPath:!cfg.apiKey))throw new Error('缺少 LLM 配置');
  return cfg;
}
export async function loadArticleRuntime(file) {
  const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
  const cfg=await read(file);
  if(!cfg.schedule)return {single:validate(cfg),watchReports:Boolean(cfg.watchReports)};
  if(cfg.schedule.type!=='deepseek-peak-switch')throw new Error('未知模型时段调度类型');
  const official=validate(await read(path.resolve(path.dirname(file),cfg.schedule.officialConfig)));
  const local=validate(await read(path.resolve(path.dirname(file),cfg.schedule.localConfig)));
  if(new URL(official.baseUrl).hostname!=='api.deepseek.com')throw new Error('闲时配置必须指向 DeepSeek 官方接口');
  if(new URL(local.baseUrl).hostname==='api.deepseek.com')throw new Error('高峰配置不能指向官方接口');
  return {official:{...official,concurrency:16,offPeakOnly:true},local:{...local,concurrency:1,offPeakOnly:false},watchReports:cfg.watchReports??true};
}
export function selectArticleRuntime(settings,at=Date.now()) {
  if(settings.single)return {name:'single',cfg:settings.single,concurrency:articleConcurrency(settings.single.concurrency??1)};
  const window=deepseekOffPeakWindow(at,settings.official.requestTimeoutMs??600000);
  const name=window.allowed?'official_off_peak':'local_peak';
  return {name,cfg:window.allowed?settings.official:settings.local,concurrency:window.allowed?16:1,window};
}
