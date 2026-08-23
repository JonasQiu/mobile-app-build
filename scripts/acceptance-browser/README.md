# 独立验收浏览器执行面

这里提供零新增 npm 依赖的 Chrome 151 / CDP 执行面。它只监听本机回环地址，使用全新临时
profile，不附着现有 Chrome，也不读取浏览器凭据、Cookie 或用户目录。

## 启动当前本地 production build

```bash
python3 scripts/acceptance-browser/surface.py start --local-production
node scripts/acceptance-browser/cdp-probe.mjs
python3 scripts/acceptance-browser/surface.py stop
```

## 启动线上 production 地址

```bash
python3 scripts/acceptance-browser/surface.py start
node scripts/acceptance-browser/cdp-probe.mjs
python3 scripts/acceptance-browser/surface.py stop
```

## 需要真实登录时

```bash
python3 scripts/acceptance-browser/surface.py start --headful
```

只允许所有者在弹出的临时 Chrome 窗口中自行完成登录。验收人员不得索取、查看、复制或记录密码、
验证码、Cookie、Token 或现有浏览器 profile。登录后验收人员可复用 `state.json` 中的回环 CDP
地址执行场景，完成后必须运行 `stop`；`stop` 会终止本次进程并删除整个临时 profile。

## 可用能力

- Chrome DevTools Protocol 1.3；
- 320×568、390×844 及自定义移动视口；
- 5 点触屏模拟与 coarse pointer；
- 键盘事件注入；
- Chromium Accessibility 全树读取；
- Network、Runtime、Page、Emulation、Input 等原生 CDP 域。

探测脚本只保存状态码、最终 URL、视口/触屏能力以及无障碍节点数量和角色直方图，不保存页面文本、
表单值、Cookie、Local Storage 或原始无障碍名称。
