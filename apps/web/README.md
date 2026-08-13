# Mobile Build Web

Mobile Build 的移动端 Web MVP。提供账号登录、完整需求保存、执行目标偏好和项目记录。

页面不再根据关键词生成方案，也不展示虚构的文件、日志、阶段和站内预览。只有控制面收到真实 Mobile Spec、执行器与 DeploymentProvider 事件后，才展示构建和独立 URL。完整边界见 [MVP 产品说明](../../docs/mvp-product-spec.md)。

## Prerequisites

- Node.js `>=22.13.0`

## 本地启动

```bash
npm ci
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## 技术形态

- Next.js App Router 风格页面与 Route Handlers
- vinext / Vite 构建 Cloudflare Workers 兼容产物
- Cloudflare D1 + Drizzle schema 和 migration
- `.openai/hosting.json` 声明 Sites 项目和 D1 binding
- `vite.config.ts` 在本地模拟 binding

## Sites 身份 Header

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## 常用命令

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: 构建并检查“无模板、无内置预览”契约
- `npm run db:generate`: generate Drizzle migrations after schema changes

## 配套文档

- [文档中心](../../docs/README.md)
- [总体技术方案](../../docs/technical-architecture.md)
- [开发、验证与部署手册](../../docs/development-deployment-guide.md)
