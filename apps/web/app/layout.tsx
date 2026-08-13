import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Mobile Build",
    template: "%s · Mobile Build",
  },
  description: "一句话生成、验证并交付 Next.js 项目。",
  applicationName: "Mobile Build",
  themeColor: "#0b0d10",
  openGraph: {
    title: "Mobile Build",
    description: "一句话生成、验证并交付 Next.js 项目。",
    type: "website",
    locale: "zh_CN",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
