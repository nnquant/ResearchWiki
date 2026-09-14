import { articleCategory } from '../article-category.mjs';
import { withEntityTags } from '../article-entities.mjs';

// Investment-specific enrichment stays outside the shared query/index implementation.
export function decorateMetadata(metadata, pageType) {
  return { ...metadata, research_category: articleCategory(metadata, pageType), tags: withEntityTags(metadata).tags,
    tickers: [...new Set([...(Array.isArray(metadata.tickers) ? metadata.tickers : []), ...(metadata.analyst_expectations ?? []).flatMap(x => x.ticker ? [x.ticker] : [])])] };
}
