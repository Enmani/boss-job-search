# 直聘求职 · BOSS Job Search

在 Codex 中搜索 BOSS 直聘岗位，对照自己的简历筛选，并保存求职进度。

**Windows 预览版 · v0.1.3 · MIT**。非 BOSS 直聘官方项目。

你在 Codex 下指令，插件在普通 Chrome 中打开岗位页面、读取可见内容，并把结果保存到本机。Chrome 扩展自动连接；日常无需点击扩展图标或下载 JSON。当前没有独立搜索面板或定时搜岗位功能。

## 功能

- 按关键词和城市搜索当前页岗位，读取完整详情。
- 导入 PDF、DOCX、TXT、Markdown 简历，可附已确认事实文件。
- 由 Codex 对照岗位与简历原文，保存匹配依据、缺口和待核实问题。
- 记录收藏、沟通、投递、面试、Offer 等进度及历史。
- SQLite 本机存储、资料隔离、岗位去重、版本检测与数据库备份。

岗位和简历更新后需要重新筛选。进度工具只记账，实际沟通和投递由本人完成。

## 安装

需要 Windows、Node.js 24+、普通 Google Chrome，以及支持本机插件的 Codex。安装源码和本机通信使用的路径须为 ASCII 路径，例如 `C:/dev/boss-job-search`。发布包不包含 Node.js 或 npm 依赖。

### 1. 下载源码并安装依赖

从 [Releases](https://github.com/Enmani/boss-job-search/releases) 下载源码包并解压，或克隆仓库：

```powershell
git clone https://github.com/Enmani/boss-job-search.git C:/dev/boss-job-search
cd C:/dev/boss-job-search
npm ci --prefix ./plugin --no-fund --no-audit
```

### 2. 安装 Codex 插件

在仓库根目录执行：

```powershell
codex plugin marketplace add .
codex plugin add boss-job-search@boss-job-search-local
```

重新打开 Codex，在插件页确认“直聘求职”已启用，并在新聊天中使用。插件安装会复制 `plugin/`，因此要先安装 npm 依赖。

### 3. 加载 Chrome 扩展

打开 `chrome://extensions`，开启开发者模式，选择“加载已解压的扩展程序”，加载仓库中的 `plugin/chrome-extension`。复制 Chrome 显示的扩展 ID。

单独的 Chrome 扩展 ZIP 也可解压后加载，但它仍需要上述 MCP 源码和本机通信程序。

### 4. 安装本机通信

在仓库根目录执行以下命令，将示例 ID 换成实际 ID：

```powershell
./plugin/scripts/install-native.ps1 -ExtensionId YOUR_EXTENSION_ID
```

这一步在当前 Windows 用户下注册 `com.boss_job_search.bridge`。刷新 Chrome 扩展，保持普通 Chrome 打开，并本人登录 BOSS。

完整恢复与卸载说明见 [运行说明](docs/operations.md)。插件格式参考 [OpenAI 官方文档](https://developers.openai.com/plugins/build/plugins)。

## 使用

在 Codex 中说：

- “导入这份简历，搜索 AI 产品岗位，按我的经历筛选。”
- “读取这个岗位的完整详情，把缺口和待核实条件保存下来。”
- “把这个岗位记为收藏，备注需要确认远程范围。”
- “我已提交申请，把这个岗位记为已投递。”
- “查看求职进度和需要跟进的岗位。”

首次使用会询问简历路径、目标岗位和必要偏好。未确认的薪资、搬迁或工作许可条件保持未知。16 个 MCP 工具见 [工具列表](docs/tools.md)。

## 数据和权限

Chrome 扩展只声明 `scripting`、`nativeMessaging` 和 `https://www.zhipin.com/*`。它使用 ISOLATED 脚本读取可见岗位内容，登录状态由普通 Chrome 管理。

本机通信使用 Native Messaging 和当前用户的 Windows 命名管道，不开网络监听端口。主机只授权安装时指定的扩展 ID。只管理当前 MCP 会话创建的岗位标签。

默认资料目录为 `%LOCALAPPDATA%/boss-job-search/<profile>`。简历、岗位、筛选和进度保存在本机；Codex 执行筛选时会读取这些文字，应按所使用的 Codex 环境管理资料权限。插件不导出 Chrome 登录凭据。

## 当前限制

- 搜索只覆盖当前页，最多读取 30 条。
- 列表薪资特殊字体无法可靠读取时保持未知；需要读详情获取正常金额。
- 登录和验证码由本人完成。登录遮挡、验证、空白页和布局变化会返回状态。
- 跟进日期只是一条记录，没有自动提醒。
- Windows 安装入口已经验证；macOS、Linux 尚未提供本机安装器。
- 网站页面结构可能变化，异常结果不能当作空搜索。

## 开发与验证

```powershell
npm ci --prefix ./plugin --no-fund --no-audit
npm run precheck
./scripts/package-release.ps1
```

15 项检查覆盖持久化、回滚、引用校验、MCP、本机通信与 DOM 样例。网页样例拦截全部网络，不能替代登录后的真实网站检查。v0.1.3 已在一台 Windows 机器的普通 Chrome 完成两轮真实 MCP 搜索，每轮 15 条，并验证完整详情、自动保存和服务重启后的记录。

[架构](docs/architecture.md) · [运行说明](docs/operations.md) · [后续工作](TODO.md) · [MIT 许可证](LICENSE)
