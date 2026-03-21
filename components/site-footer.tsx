import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <p className="footer-brand">清一山长投资库</p>
          <p>文章驱动 + 数据驱动的投资研究平台（当前优先：文章库）</p>
        </div>

        <div>
          <h6>快速入口</h6>
          <Link href="/articles">清一文章库</Link>
          <Link href="/analysis">股票分析（规划中）</Link>
          <Link href="/assistant">AI问答助手（规划中）</Link>
        </div>

        <div>
          <h6>内容管理</h6>
          <a href="https://github.com" target="_blank" rel="noreferrer">
            GitHub 仓库
          </a>
          <span className="page-note">Markdown 导入 + 自动索引</span>
        </div>

        <div>
          <h6>部署</h6>
          <span className="page-note">Git push 后 GitHub Actions 自动发布</span>
        </div>
      </div>
    </footer>
  );
}
