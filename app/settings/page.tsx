import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SettingsCenter } from "@/components/settings/settings-center";

export default function SettingsPage() {
  return (
    <>
      <SiteHeader active="settings" />
      <main className="settings-page">
        <div className="container">
          <SettingsCenter />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
