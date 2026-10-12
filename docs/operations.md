# 运行说明

## 安装与连接

先按照仓库 README 安装依赖和 Codex 插件，再加载 Chrome 扩展，以实际扩展 ID 运行 `plugin/scripts/install-native.ps1`。安装程序要求 Node.js 24+。运行时、源码和数据路径须为 ASCII，且不含双引号、百分号或感叹号。

默认数据根目录为 `%LOCALAPPDATA%/boss-job-search`。本机通信位于 `bridge/`，求职资料位于 `<profile>/`，默认 profile 为 personal。主机使用当前 Windows 用户注册表，不需要管理员权限。

Chrome 扩展启动、更新和浏览器启动时自动连接。`get_status.browser.state=connected` 表示本机通信连通，不能据此判断网站已登录。图标上的 OK 表示已连接；图标点击只用于尝试重连。

## 连接失败

`EXTENSION_NOT_CONNECTED` 时确认普通 Chrome 打开、扩展启用、ID 与 `bridge/host.json` 的 `allowed_origins` 一致。重新加载到另一目录可能改变扩展 ID，需要用新 ID 重新安装本机通信。

扩展在错误列表保留 Chrome 原始连接错误，前缀为“本机连接失败”。`host-state.json` 和 `get_status` 只显示有限启动状态、时间和错误代码，不记录通信正文或凭据。

若 Chrome 提示 `Specified native messaging host not found`，检查注册表默认值、主机 JSON 和启动脚本是否存在。核对无误后本人退出并重开普通 Chrome；首次真实安装曾用此步骤恢复。连接中断只进行两次有限重连，恢复条件后可刷新扩展或点击图标。

## 搜索与详情

`search_jobs.platform` 默认为 boss。Greenhouse 先用 `set_greenhouse_boards` 保存公司招聘页，再以 platform=greenhouse、query、location 搜索。无需 Chrome 或 API 密钥。不同公司的读取结果独立记录；partial 需检查失败公司，不能宣称覆盖完整。`get_job_detail` 根据已保存的平台自动选择读取方式。

`search_jobs` 接受关键词、九位城市代码和 1–30 条当前页数量；全国代码为 `100010000`。成功结果直接保存到 SQLite。

`get_job_detail` 接受已保存岗位的 jobId，读到所选岗位完整正文后更新记录。列表返回的已保存 description 可能来自此前读取，筛选前刷新详情。

`login_required`、`verification_required`、`layout_unrecognized`、`outside_boss` 和身份/范围变化各有独立状态。只有网页明确没有结果才返回 empty。`open_login` 打开普通 Chrome 登录页，登录与验证由本人完成。

`close_browser` 及 MCP 服务退出只清理当前会话创建的标签。profile 隔离本机求职资料；网页账号仍来自同一个已连接 Chrome 配置。

## 备份与恢复

首次打开 v0.1.3 的资料时，v0.2 会在该 profile 的 `backups/pre-v0.2-*.sqlite` 中创建原版本备份，并升级数据库结构。简历、岗位 ID、筛选和进度历史保持原样。降回 v0.1.3 前须停止所有服务并恢复这份 v1 备份；旧程序不能直接读取 v2 数据库。

`backup_records` 创建 SQLite 快照，包含简历、岗位、筛选和进度，不含浏览器登录状态。恢复前停止该 profile 的全部 MCP 服务，保存原 profile 副本；将选中快照复制为 `jobs.sqlite`，移开旧 `jobs.sqlite-wal` 和 `jobs.sqlite-shm`。重新启动后核对简历、岗位和进度历史。

可用 `BOSS_DATA_DIR` 指定资料根目录，安装器的 `-DataRoot` 需与其一致。`BOSS_BRIDGE_CONFIG` 可单独指定通信配置位置。不要公开 `bridge/config.json` 中的随机凭据。

## 更新与卸载

更新源码后重新执行 npm ci，并重新安装 Codex 插件。保持原 Chrome 扩展目录可以保留 ID；更新后刷新扩展。源码位置或 Node.js 路径变化时重新运行本机安装器。

卸载时，在 Codex 插件页卸载“直聘求职”，在 Chrome 移除对应扩展，然后删除当前用户的 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.boss_job_search.bridge` 注册项。桥接文件和求职资料位于数据根目录，按自己的保留需求处理；插件更新不会删除资料。

## 命令行

```powershell
node plugin/src/cli.mjs tools
node plugin/src/cli.mjs call get_status
node plugin/src/cli.mjs call search_jobs path/to/search-arguments.json
node plugin/src/cli.mjs panel personal --open
```

参数文件示例：

```json
{"profile":"personal","query":"AI产品","cityCode":"100010000","limit":15}
```

Greenhouse 参数示例：

```json
{"profile":"personal","platform":"greenhouse","query":"Product Manager","boardTokens":["anthropic"],"location":"","limit":15}
```

`panel` 保持运行，在 Windows 打开默认浏览器。命令行 `call` 完成后会退出；不要用 `call open_dashboard` 启动需要持续使用的面板。在 Codex 中使用 `open_dashboard` 时，面板跟随该 MCP 服务的生命周期；服务停止后重新打开。浏览器访问失败时确认进程仍在运行，并从新的访问链接进入。
