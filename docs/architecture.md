# 架构

Codex 的 stdio MCP 通过当前用户的 Windows 命名管道向 Chrome Native Messaging 主机发送请求。普通 Chrome 的求职扩展保持本机连接，打开正常岗位网址，以 ISOLATED 脚本读取可见文字，返回给 MCP 完成校验和 SQLite 保存。

数据流：Codex → stdio MCP → 命名管道 → Native Messaging → 原生扩展 → BOSS 页面；岗位结果沿原路返回。没有网络监听端口，不读取 Cookie、登录令牌或页面隐藏状态，不重放接口，不修改网站检测。Playwright 只用于拦截全部网络的本地 DOM 样例检查。

## 边界

扩展只声明 scripting、nativeMessaging 和 https://www.zhipin.com/*。主机注册在当前用户 HKCU 中，allowed_origins 只授权安装时指定的扩展 ID。MCP 的管道请求还需本机配置中的随机凭据；凭据不进入插件包、日志或工具响应。

本机主机和 MCP 共用 4 字节小端长度前缀及 UTF-8 JSON，每帧最多 512 KiB。主机只分派搜索、详情、登录、状态和会话标签清理，不接受 JavaScript、任意网址或系统命令。扩展再次检查命令参数与 BOSS 详情链接。

每个 MCP 实例使用独立 sessionId。扩展只导航和关闭该会话创建的标签，不接管本人已有标签。不同 profile 隔离本机数据库；网页使用已连接 Chrome 配置的同一 BOSS 账号，并不隔离网站登录身份。

浏览器操作一次只执行一项，其他请求明确返回忙状态。页面加载和读取有时限，连接中断、登录、验证码、布局变化、搜索范围变更及岗位身份不符不会被当作空结果。只有网站明确无结果才返回 empty；详情正文和规范岗位链接均通过验证后才保存。

## 岗位与筛选

岗位按规范化详情链接去重。列表不能覆盖已读取的完整正文、公司全称和地址；空薪资、经验和学历不清除已有值。列表明确提供新的标题、薪资、经验或学历时更新岗位版本，使旧筛选失效。search_jobs 返回保存后的记录，其中完整描述可能属于此前读取；筛选前用 get_job_detail 获取最新详情。

简历导入创建独立版本，保存前隐藏联系方式。Codex 读取简历、事实与实际岗位原文完成语义筛选。服务验证引用确实存在并校验岗位 revision；判断技能、经验、资格和办公范围仍由 Codex 完成，没有关键词评分。

进度独立存储，重新读取岗位不重置进度。状态和历史事件在同一事务内写入，requestId 处理重复请求；同一标识换内容会被拒绝。搜索先记 running，再记录实际状态；执行失败和异常退出保留为未完成，不自动伪造新结果。

数据库使用 WAL 和忙等待。user_version=1；高于支持版本时拒绝打开，不删除数据。VACUUM INTO 备份包含已提交的 WAL 内容。本机原文、数据库和备份不发送到外部服务。

## 本机恢复

Windows 启动器使用 Chrome 支持的 cmd 入口直接运行 Node 主机，不在中间转码二进制消息。源码决策依据见 [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) 和 [Chromium Windows 启动实现](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/api/messaging/launch_context_win.cc)。

host-state.json 只记录启动阶段、时间和有限错误代码；没有请求正文、登录信息或通信凭据。get_status 在连接失败时返回该诊断。自动检查使用明确的 Chrome 响应样例，真实网站验收另见 TODO。
