import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export default function NotFoundPage() {
  return (
    <>
      <SiteHeader active="articles" />
      <main className="detail-page">
        <section className="container detail-wrap">
          <h1>页面不存在</h1>
          <p>请返回文章列表继续浏览。</p>
          <Link className="article-read-btn" href="/articles">
            返回文章列表
          </Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
