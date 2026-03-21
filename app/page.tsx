import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { UpdateLogBadge } from "@/components/home/update-log-badge";
import { changelogEntries } from "@/content/changelog";

const moduleCards = [
  { title: "股票分析", icon: "📈", href: "/analysis", desc: "股息率锚定、PE/PB 百分位、估值对比" },
  { title: "清一文章库", icon: "📚", href: "/articles", desc: "按专题、标签、行业、个股检索与阅读" },
  { title: "AI问答助手", icon: "💬", href: "/assistant", desc: "基于文章语料的投资问答" },
  { title: "价格预警", icon: "🔔", href: "/alerts", desc: "价格、估值、股息率触发预警" },
  { title: "财务仪表盘", icon: "📊", href: "/dashboard", desc: "财报可视化与关键指标跟踪" },
  { title: "选股器", icon: "🧮", href: "/stocks", desc: "多条件筛选与候选池管理" }
];

export default function HomePage() {
  return (
    <>
      <SiteHeader active="home" />

      <main>
        <section className="hero-section">
          <div className="hero-deco left" aria-hidden="true">
            <div className="stock-index-ornament trend">
              <span className="stock-index-badge">涨</span>
              <span className="stock-index-bars">
                <i />
                <i />
                <i />
              </span>
              <span className="stock-index-line">
                <svg viewBox="0 0 84 84" aria-hidden="true">
                  <path d="M15 56 L31 47 L43 52 L59 34 L69 25" />
                  <path d="M61 25 H69 V33" />
                </svg>
              </span>
              <span className="ornament-tassel" />
            </div>
          </div>

          <div className="hero-content container">
            <h1>清一山长投资研究平台</h1>
            <p className="hero-subtitle">
              核心模块已规划完成，当前优先落地「清一文章库」，其余模块保留框架并按优先级递进开发。
            </p>

            <div className="hero-actions">
              <Link href="/articles" className="primary-btn">
                进入清一文章库
              </Link>
              <Link href="/analysis" className="secondary-btn">
                查看模块规划
              </Link>
            </div>

            <p className="hero-note">当前技术栈：Next.js + TypeScript + Tailwind，保持原有视觉风格。</p>

            <UpdateLogBadge entries={changelogEntries} />
          </div>

          <div className="hero-deco right" aria-hidden="true">
            <div className="stock-index-ornament breakout">
              <span className="stock-index-badge">牛</span>
              <span className="stock-index-candles">
                <i />
                <i />
                <i />
              </span>
              <span className="stock-index-line">
                <svg viewBox="0 0 84 84" aria-hidden="true">
                  <path d="M13 54 L28 54 L28 47 L43 47 L43 37 L59 37 L59 24 L71 24" />
                  <path d="M63 24 H71 V32" />
                </svg>
              </span>
              <span className="ornament-tassel" />
            </div>
          </div>
        </section>

        <section className="section-block" id="features">
          <div className="container">
            <div className="section-title">
              <h2>核心功能</h2>
              <p>六大模块并行规划，先把文章库做深做稳。</p>
            </div>

            <div className="feature-grid">
              {moduleCards.map((item) => (
                <Link key={item.title} href={item.href} className="feature-card-link" aria-label={`进入${item.title}`}>
                  <article className={`feature-card clickable-card ${item.title === "清一文章库" ? "featured" : ""}`}>
                    <div className={`icon-box ${item.title === "清一文章库" ? "dark" : ""}`}>{item.icon}</div>
                    <h3>{item.title}</h3>
                    <p>{item.desc}</p>
                  </article>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
