import { Link } from 'react-router';

export function NotFound() {
  return (
    <div className="content-inner">
      <div className="empty">
        <h3>页面不存在</h3>
        <p>这个地址没有对应的页面。</p>
        <Link className="btn" to="/">回到首页</Link>
      </div>
    </div>
  );
}
