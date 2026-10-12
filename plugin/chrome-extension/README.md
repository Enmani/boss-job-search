# 直聘求职 Chrome 扩展

在 chrome://extensions 开启开发者模式，加载此目录，然后使用页面显示的真实 ID 安装本机通信。安装步骤见 [源码仓库](https://github.com/Enmani/boss-job-search#安装)。

扩展自动连接本机 MCP。日常在 Codex 发起搜索、读取详情和保存记录，不需要点击扩展或下载结果。图标点击仅用于尝试重连，OK 表示已连接。

权限仅为 scripting、nativeMessaging 和 https://www.zhipin.com/*。本人管理登录和验证。此扩展需要配套 Node.js MCP 和 Native Messaging 主机，不能单独运行。
