import { useEffect, useState } from 'react';
import { useGraphNavigation, useGraphTags } from '../api/hooks';
import { categoryLabel } from '../lib/types';

/** Entity-scoped screens must not load the full-library body index for controls. */
export function useResearchFacets(_entityScoped: boolean) {
  const navigation = useGraphNavigation(true);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(draft), 250);
    return () => clearTimeout(timer);
  }, [draft]);
  const lightTags = useGraphTags(query, true);
  return {
    tags: lightTags.data?.tags,
    types: Object.entries(navigation.data?.counts ?? {}).map(([type, n]) => ({ type, n, label: categoryLabel(type), dir: null })),
    onTagSearch: setDraft,
  };
}
