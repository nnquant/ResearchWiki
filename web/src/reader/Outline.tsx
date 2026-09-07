import { useMemo } from 'react';
import { parseHeadings, sectionPrefix, type PdfSection, type OutlineItem } from '../lib/outline';

interface Props {
  markdown: string;
  sections: PdfSection[] | null;
  activeId: string | null;
  onNavigate: (id: string) => void;
}

const MAX_ITEMS = 400;

interface Group {
  page: number | null;
  items: OutlineItem[];
}

export function Outline({ markdown, sections, activeId, onNavigate }: Props) {
  const groups = useMemo<Group[]>(() => {
    if (!sections) return [{ page: null, items: parseHeadings(markdown).filter(h => h.level <= 4) }];
    let budget = MAX_ITEMS;
    return sections.map(section => {
      const items = budget > 0 ? parseHeadings(section.markdown, sectionPrefix(section.page)).filter(h => h.level <= 3) : [];
      budget -= items.length;
      return { page: section.page, items };
    });
  }, [markdown, sections]);

  const scrollTo = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
    onNavigate(id);
  };

  const empty = groups.every(g => g.items.length === 0);
  if (empty) return <div className="rail-empty">正文没有标题。</div>;

  return (
    <>
      <div className="rail-section">
        <h4>大纲</h4>
        <ul className="outline">
          {groups.flatMap(group => group.items).map(item => (
            <li key={item.id}>
              <a href={`#${item.id}`} className={activeId === item.id ? 'active' : ''} style={{ ['--depth' as string]: item.level }} onClick={scrollTo(item.id)} title={item.text}>
                {item.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
