# 直聘求职 · BOSS Job Search

在 Codex 或本机求职面板中搜索 BOSS 直聘、Greenhouse 岗位，对照自己的简历筛选，并保存求职进度。

**Windows 预览版 · v0.2.0 · MIT**。非 BOSS 直聘或 Greenhouse 官方项目。

你可以在 Codex 下指令，也可以打开求职面板点击搜索、查看详情和记录进度。BOSS 使用普通 Chrome 的原生扩展；Greenhouse 使用公开岗位接口。两种入口共用本机 SQLite 资料。

## 功能

- 按关键词和城市搜索当前页岗位，读取完整详情。
- 添加 Greenhouse 公司招聘页，按关键词和地点搜索公开岗位，读取完整正文和薪资范围。
- 求职面板支持平台、状态、关键词和简历版本筛选，以及列表、进度看板、备注和历史。
- 导入 PDF、DOCX、TXT、Markdown 简历，可附已确认事实文件。
- 由 Codex 对照岗位与简历原文，保存匹配依据、缺口和待核实问题。
- 记录收藏、沟通、投递、面试、Offer 等进度及历史。
- 统一岗位结构保留平台、原始岗位编号、链接、币种和计薪周期；按平台内的岗位身份去重。
- SQLite 本机存储、资料隔离、版本检测与数据库备份；v0.1.3 数据自动升级，升级前保留备份。

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

只使用 Greenhouse 和求职面板时，可跳过 Chrome 扩展与本机通信安装。

## 使用

在 Codex 中说：

- “导入这份简历，搜索 AI 产品岗位，按我的经历筛选。”
- “读取这个岗位的完整详情，把缺口和待核实条件保存下来。”
- “把这个岗位记为收藏，备注需要确认远程范围。”
- “我已提交申请，把这个岗位记为已投递。”
- “查看求职进度和需要跟进的岗位。”
- “打开求职面板。”
- “添加 https://job-boards.greenhouse.io/anthropic，搜索 Product Manager 岗位。”

首次使用会询问简历路径、目标岗位和必要偏好。未确认的薪资、搬迁或工作许可条件保持未知。19 个 MCP 工具见 [工具列表](docs/tools.md)。

### 求职面板

在 Codex 中说“打开求职面板”，打开插件返回的本机链接。也可在仓库根目录执行：

```powershell
npm run panel --prefix ./plugin
```

命令会保持面板服务运行，并在 Windows 默认浏览器打开页面；关闭命令进程后面板停止。面板支持搜索、查看正文、刷新完整详情、收藏和记录进度。选择简历版本可查看 Codex 已保存的筛选依据；新的简历导入与语义筛选仍在 Codex 中完成。

Greenhouse 搜索前，在“目标公司”中填写公司招聘页，每行一个，最多十家。关键词匹配标题、公司和正文，地点匹配地点文字；每次最多保存 30 条，可收窄关键词继续搜索。它只覆盖已添加的公司。[公开接口说明](https://docs.greenhouse.io/job-board.html)

## 数据和权限

Chrome 扩展只声明 `scripting`、`nativeMessaging` 和 `https://www.zhipin.com/*`。它使用 ISOLATED 脚本读取可见岗位内容，登录状态由普通 Chrome 管理。

BOSS 通信使用 Native Messaging 和当前用户的 Windows 命名管道。主机只授权安装时指定的扩展 ID，只管理当前会话创建的岗位标签。Greenhouse 只对官方公开接口发起 GET 请求。

面板按需监听 `127.0.0.1` 的随机端口，使用临时访问凭据和同源检查。访问链接仅供本机使用，不要分享；服务退出后链接失效。面板不开放简历文件读取或任意系统命令。

默认资料目录为 `%LOCALAPPDATA%/boss-job-search/<profile>`。简历、岗位、筛选和进度保存在本机；Codex 执行筛选时会读取这些文字，应按所使用的 Codex 环境管理资料权限。插件不导出 Chrome 登录凭据。

## 当前限制

- BOSS 搜索只覆盖当前页，最多读取 30 条。
- Greenhouse 仅搜索添加的公司，部分公司失败会分别显示原因；不支持全站搜索。
- 不同平台的相似岗位不会自动合并。薪资周期未明确时保留未知，不进行汇率换算。
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

自动检查覆盖持久化、回滚、引用校验、MCP、本机通信、Greenhouse 接口样例、旧数据迁移，以及真实浏览器中的面板按钮和响应式布局。接口样例使用模拟数据，不能替代真实网站验证。实际网站检查使用独立的临时资料目录：

```powershell
node scripts/live-check.mjs
# 已安装并连接 BOSS 扩展时，同时检查 BOSS：
node scripts/live-check.mjs --boss
```

真实接口检查结果见 [版本记录](CHANGELOG.md)。

[架构](docs/architecture.md) · [运行说明](docs/operations.md) · [后续工作](TODO.md) · [MIT 许可证](LICENSE)
