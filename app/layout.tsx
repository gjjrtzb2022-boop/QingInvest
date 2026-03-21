import type { Metadata } from "next";
import "./globals.css";
import "../styles.css";

export const metadata: Metadata = {
  title: "清一山长投资库",
  description: "清一文章库优先实现，逐步接入股票分析、AI问答、价格预警、财务仪表盘、选股器。"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
