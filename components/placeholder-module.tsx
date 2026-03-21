import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

type PlaceholderModuleProps = {
  active: "analysis" | "assistant" | "alerts" | "dashboard" | "screener";
  title: string;
  description: string;
};

export function PlaceholderModule({ active, title, description }: PlaceholderModuleProps) {
  return (
    <>
      <SiteHeader active={active} />
      <main className="detail-page">
        <section className="container detail-wrap">
          <h1>{title}</h1>
          <p>{description}</p>
          <p className="page-note">当前开发优先级：清一文章库。该模块预留框架后续接入。</p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
