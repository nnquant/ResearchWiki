import { ENTITY_FIELDS } from './article-entities.mjs';

/** Formatting normalization only: retain words, digits, signs and their order. */
export function evidenceText(value) {
  return String(value)
    .replace(/<\/?(?:sup|sub|em|strong|b|i|span)\b[^>]*>/gi, '')
    .replace(/<\/?(?:table|thead|tbody|tfoot|tr|td|th|div|p|br|li|ul|ol|h[1-6])\b[^>]*>/gi, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (match, entity) => {
      if (!entity.startsWith('#')) return {nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[entity.toLowerCase()];
      const code = entity[1].toLowerCase()==='x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
      return code>0 && code<=0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~\\])/g, '$1')
    .normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ').trim();
}

/** Escape literal JSON control characters without guessing missing punctuation. */
export function parseArticleJson(content) {
  if (typeof content !== 'string') throw new Error('模型没有返回文本');
  const text = content.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'');
  try { return { value: JSON.parse(text), repairedControls: false }; }
  catch (originalError) {
    let quoted=false,escaped=false,fixed='';
    for (const char of text) {
      if (quoted && !escaped && char.charCodeAt(0)<32) {
        fixed += '\\u'+char.charCodeAt(0).toString(16).padStart(4,'0');
        continue;
      }
      fixed += char;
      if (escaped) {escaped=false;continue;}
      if (quoted && char==='\\') {escaped=true;continue;}
      if (char==='"') quoted=!quoted;
    }
    if (fixed===text) throw originalError;
    return { value: JSON.parse(fixed), repairedControls: true };
  }
}

/** Keep each entity attached to its own source proof on the wire. */
export function normalizeArticleResponse(result) {
  if (!result?.metadata || typeof result.metadata!=='object' || Array.isArray(result.metadata)) return result;
  const metadata={...result.metadata},evidence=Array.isArray(result.evidence)?[...result.evidence]:[];
  for(const field of ENTITY_FIELDS) {
    // A misplaced top-level array can be relocated without inventing content.
    // An explicit metadata value always wins; never merge conflicting versions.
    if(!Object.hasOwn(metadata,field)&&Array.isArray(result[field]))metadata[field]=result[field];
    if(!Array.isArray(metadata[field]))continue;
    metadata[field]=metadata[field].map(entry=>{
      if(typeof entry==='string')return entry; // Previously saved extraction format.
      if(!entry || typeof entry.name!=='string')return entry;
      const name=entry.name.trim();
      evidence.push({field,item:name,quote:entry.quote,page:entry.page});
      return name;
    });
  }
  return {...result,metadata,evidence};
}
