import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ArticlesListClient } from "@/components/articles/articles-list-client";
import { getAllArticleListItems } from "@/lib/articles";
import { Suspense } from "react";

export default async function ArticlesPage() {
  const articles = await getAllArticleListItems();

  return (
    <>
      <SiteHeader active="articles" />
      <main className="article-page">
        <div className="container">
          <Suspense
            fallback={
              <section className="article-overview">
                <div>
                  <h1>专题文章库</h1>
                  <p>正在加载筛选参数...</p>
                </div>
              </section>
            }
          >
            <ArticlesListClient articles={articles} />
          </Suspense>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
