import { useEffect, useState } from 'react';
import { useGraphNavigation, useGraphTags, useTags, useTypes } from '../api/hooks';
import { categoryLabel } from '../lib/types';

/** Entity-scoped screens must not load the full-library body index for controls. */
export function useResearchFacets(entityScoped: boolean) {
  const fullTags = useTags(!entityScoped);
  const fullTypes = useTypes(!entityScoped);
  const navigation = useGraphNavigation(entityScoped);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(draft), 250);
    return () => clearTimeout(timer);
  }, [draft]);
  const lightTags = useGraphTags(query, entityScoped);
  return {
    tags: entityScoped ? lightTags.data?.tags : fullTags.data,
    types: entityScoped ? Object.entries(navigation.data?.counts ?? {}).map(([type, n]) => ({ type, n, label: categoryLabel(type), dir: null })) : fullTypes.data,
    onTagSearch: entityScoped ? setDraft : undefined,
  };
}
