import { Link } from 'react-router';
import { pdfPageId } from '../lib/outline';

type Proof = { quote: string; page: number | null };
type Note = { text: string; evidence: Proof[] };
type Rating = { label?: string | null; previous_label?: string | null; change?: string | null; stance?: string | null; stance_basis?: string | null; rationale?: string | null; evidence: Proof[] };
type Target = { value: string; currency?: string | null; previous_value?: string | null; horizon?: string | null; implied_upside?: string | null; valuation_basis?: string | null; evidence: Proof[] };
type Forecast = { period: string; metric: string; metric_label: string; value: string; unit?: string | null; currency?: string | null; basis?: string | null; source: string; previous_value?: string | null; evidence: Proof[] };
type Expectation = { company: string; ticker?: string | null; rating?: Rating | null; target_price?: Target | null; forecasts?: Forecast[] | null; key_assumptions?: Note[] | null; catalysts?: Note[] | null; risks?: Note[] | null; evidence: Proof[] };
const stances: Record<string, string> = { bullish: '看多', neutral: '中性', bearish: '看空', mixed: '观点分歧', not_rated: '未评级' };
const changes: Record<string, string> = { upgraded: '上调评级', downgraded: '下调评级', maintained: '维持评级', initiated: '首次覆盖', suspended: '暂停评级' };
const metrics: Record<string, string> = { revenue: '营业收入', net_profit: '净利润', adjusted_net_profit: '调整后净利润', eps: 'EPS', adjusted_eps: '调整后 EPS', ebitda: 'EBITDA', ebit: 'EBIT', operating_profit: '营业利润', gross_margin: '毛利率', operating_margin: '营业利润率' };
const sources: Record<string, string> = { analyst: '券商预测', consensus: '一致预期', company_guidance: '公司指引' };

function Evidence({ items }: { items: Proof[] }) {
  if (!Array.isArray(items) || !items.length) return null;
  const pages = [...new Set(items.map(p => p.page).filter((p): p is number => typeof p === 'number'))];
  return <details className="expectation-evidence">
    <summary>原文证据{pages.length ? ` · 第 ${pages.join('、')} 页` : ''}</summary>
    {items.map((item, i) => <blockquote key={i}>{item.quote}{item.page != null && <Link to={`#${pdfPageId(item.page)}`}>查看第 {item.page} 页</Link>}</blockquote>)}
  </details>;
}

export function AnalystExpectations({ value }: { value: unknown }) {
  if (!Array.isArray(value)) return null;
  const entries = value.filter((item): item is Expectation => item && typeof item.company === 'string');
  if (!entries.length) return null;
  return <section className="analyst-expectations" aria-label="分析师预期">
    <h2>分析师预期</h2>
    {entries.map((entry, index) => <section className="expectation-company" key={`${entry.company}-${index}`} aria-label={`${entry.company} 分析师预期`}>
      <h3>{entry.company}{entry.ticker && <span className="expectation-ticker">{entry.ticker}</span>}</h3>
      <div className="expectation-summary">
        {entry.rating && <div className="expectation-card">
          <h4>评级与观点</h4>
          <div className="expectation-main-value">{entry.rating.stance && <span className="chip">{stances[entry.rating.stance] ?? entry.rating.stance}</span>}{entry.rating.label}</div>
          {entry.rating.stance_basis === 'rating_mapping' && <p className="expectation-detail">方向按原始评级归类</p>}
          {(entry.rating.change || entry.rating.previous_label) && <p>{entry.rating.change && changes[entry.rating.change]}{entry.rating.previous_label && ` · 原评级 ${entry.rating.previous_label}`}</p>}
          {entry.rating.rationale && <p>{entry.rating.rationale}</p>}
          <Evidence items={entry.rating.evidence} />
        </div>}
        {entry.target_price && <div className="expectation-card">
          <h4>目标价{entry.target_price.horizon && ` · ${entry.target_price.horizon}`}</h4>
          <div className="expectation-main-value">{entry.target_price.value}<span className="expectation-detail">{entry.target_price.currency ?? '原文未明确币种'}</span></div>
          {entry.target_price.previous_value && <p>原目标价 {entry.target_price.previous_value}</p>}
          {entry.target_price.implied_upside && <p>报告给出的潜在空间 {entry.target_price.implied_upside}</p>}
          {entry.target_price.valuation_basis && <p>{entry.target_price.valuation_basis}</p>}
          <Evidence items={entry.target_price.evidence} />
        </div>}
      </div>
      {!!entry.forecasts?.length && <div className="expectation-forecasts">
        <h4>盈利与财务预测</h4>
        <div className="expectation-table-scroll" tabIndex={0} role="region" aria-label={`${entry.company} 盈利预测表`}>
          <table><thead><tr><th scope="col">预测期间</th><th scope="col">指标与口径</th><th scope="col">预测值</th><th scope="col">来源与证据</th></tr></thead>
            <tbody>{entry.forecasts.map((forecast, i) => <tr key={i}>
              <td>{forecast.period}</td>
              <td>{metrics[forecast.metric] ?? forecast.metric_label}<small>{forecast.metric_label}{forecast.basis && ` · ${forecast.basis}`}</small></td>
              <td><strong>{forecast.value}</strong><small>{[forecast.currency, forecast.unit].filter(Boolean).join(' · ')}</small>{forecast.previous_value && <small>原预测 {forecast.previous_value}</small>}</td>
              <td>{sources[forecast.source] ?? forecast.source}<Evidence items={forecast.evidence} /></td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>}
      {(['key_assumptions', 'catalysts', 'risks'] as const).map(key => !!entry[key]?.length && <details className="expectation-notes" key={key}>
        <summary>{{ key_assumptions: '关键假设', catalysts: '潜在催化剂', risks: '主要风险' }[key]}</summary>
        <ul>{entry[key]!.map((note, i) => <li key={i}>{note.text}<Evidence items={note.evidence} /></li>)}</ul>
      </details>)}
    </section>)}
  </section>;
}
