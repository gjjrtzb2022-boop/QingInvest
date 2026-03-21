import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StocksCenter } from "@/components/stocks/stocks-center";
import { getStockCatalogBootstrap } from "@/lib/server/stock-catalog";

type StocksPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export default async function StocksPage({ searchParams }: StocksPageProps) {
  const resolvedSearchParams = ((searchParams ? await searchParams : {}) || {}) as Record<
    string,
    string | string[] | undefined
  >;
  const code = firstParam(resolvedSearchParams.code);
  const industry = firstParam(resolvedSearchParams.scr_ind);
  const mode = firstParam(resolvedSearchParams.mode) === "screener" ? "screener" : "workbench";

  const bootstrap = await getStockCatalogBootstrap({
    code,
    industry,
    mode
  });

  return (
    <>
      <SiteHeader active="screener" />
      <main className="stocks-page">
        <section className="container">
          <StocksCenter
            initialCatalogStocks={bootstrap.stocks}
            initialCatalogTotal={bootstrap.total}
            initialCatalogComplete={bootstrap.complete}
          />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}
