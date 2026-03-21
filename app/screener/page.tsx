import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StocksCenter } from "@/components/stocks/stocks-center";
import { Suspense } from "react";

export default function ScreenerPage() {
  return (
    <>
      <SiteHeader active="screener" />
      <main className="stocks-page">
        <section className="container">
          <Suspense
            fallback={
              <section className="article-overview">
                <div>
                  <h1>选股器</h1>
                  <p>正在加载筛选工作台...</p>
                </div>
              </section>
            }
          >
            <StocksCenter />
          </Suspense>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
