import Ajv from 'ajv';
import {articleSchema} from './article-metadata.mjs';
import {ENTITY_FIELDS} from './article-entities.mjs';

export const OUTPUT_SCHEMA_VERSION='article-output-schema-v1';
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const normalFields=Object.keys(articleSchema.properties).filter(k=>!['personal_rating','review_status'].includes(k));
const ajv=new Ajv({strict:false,validateFormats:false,allErrors:false});
const compiled=new Map();
// Optional values retain their nullable types; property names and nesting are fixed.
function strictObjects(value) {
  if(Array.isArray(value))return value.map(strictObjects);
  if(!value||typeof value!=='object')return value;
  const out=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,strictObjects(v)]));
  if(out.properties){out.additionalProperties=false;out.required=Object.keys(out.properties);}
  return out;
}
export function articleOutputSchema({fields=normalFields,groupId}={}) {
  const properties={};
  for(const field of fields) {
    if(!Object.hasOwn(articleSchema.properties,field)||!normalFields.includes(field))throw new Error('未知抽取字段 '+field);
    properties[field]=structuredClone(articleSchema.properties[field]);
    if(ENTITY_FIELDS.includes(field))properties[field]={type:'array',maxItems:field==='industries'?15:30,items:object({name:{type:'string'},quote:{type:'string'},page:{type:['integer','null'],minimum:1}})};
  }
  const defs=structuredClone(articleSchema.$defs);
  let expectationFields;
  if(groupId?.startsWith('forecasts'))expectationFields=['company','ticker','evidence','forecasts'];
  else if(groupId==='ratings')expectationFields=['company','ticker','evidence','rating','target_price'];
  else if(groupId==='expectation-notes')expectationFields=['company','ticker','evidence','key_assumptions','catalysts','risks'];
  else if(groupId==='expectation-context')expectationFields=Object.keys(defs.expectation.properties).filter(k=>k!=='forecasts');
  if(expectationFields)defs.expectation.properties=Object.fromEntries(expectationFields.map(k=>[k,defs.expectation.properties[k]]));
  const evidence={type:'array',items:object({field:{type:'string',enum:fields},quote:{type:'string'},page:{type:['integer','null'],minimum:1},item:{type:['string','null']}})};
  return strictObjects({...object({metadata:object(properties),evidence}),$defs:defs});
}
export function schemaResponseFormat(schema) {
  return {type:'json_schema',json_schema:{name:'article_extraction',strict:true,schema}};
}
export function validateOutputSchema(value,schema) {
  const key=JSON.stringify(schema);let validate=compiled.get(key);
  if(!validate){validate=ajv.compile(schema);compiled.set(key,validate);}
  if(!validate(value))throw Object.assign(new Error('结构化输出不符合 schema：'+ajv.errorsText(validate.errors)),{code:'VALIDATION'});
  return value;
}
