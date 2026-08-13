import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import TopNav from "./components/TopNav";
import Footer from "./components/Footer";
import { studioInfo } from "@/lib/data";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: `${studioInfo.brand} | 唤醒每一天的原动力`,
  description:
    "源动 FITNESS 是一家以力量、有氧、柔韧、搏击为核心的高端健身俱乐部，提供专业私教、团课、营养咨询与 24H 全场馆服务。",
  keywords: [
    "健身",
    "健身房",
    "私教",
    "团课",
    "力量训练",
    "HIIT",
    "瑜伽",
    "搏击",
    "会员卡",
    studioInfo.brand,
  ],
  authors: [{ name: studioInfo.brand }],
  openGraph: {
    title: `${studioInfo.brand} | 唤醒每一天的原动力`,
    description:
      "力量、有氧、柔韧、搏击四大专区，38 位认证教练，120+ 月课程。立即预约免费体验课。",
    type: "website",
    locale: "zh_CN",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-zinc-950 text-zinc-100 flex flex-col">
        <TopNav />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
