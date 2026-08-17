import type { Metadata } from "next";
import { MobileBuildApp } from "./MobileBuildApp";
import { requireChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mobile Build",
  description: "用一句话，在手机上完成项目规格、构建与交付。",
};

export default async function Home() {
  await requireChatGPTUser("/");
  return <MobileBuildApp />;
}
