# MCP 工具

profile 默认 personal，用于隔离本机资料。Chrome 连接来自本人已经加载扩展的配置。

| 工具 | 用途 |
| --- | --- |
| get_status | 连接、简历元数据、偏好和最近搜索 |
| open_login | 打开本人 Chrome 的登录页 |
| close_browser | 清理当前会话创建的标签 |
| open_dashboard | 启动本机求职面板，返回带临时访问凭据的链接 |
| set_greenhouse_boards | 添加最多十个公司招聘页或 board token |
| search_jobs | platform=boss 读取当前页；platform=greenhouse 搜索添加的公司 |
| get_job_detail | 按 jobId 与所属平台读取完整详情并更新记录 |
| get_saved_job | 查看已保存正文和进度历史，不访问网站 |
| import_visible_jobs | 导入本人实际读取的岗位材料 |
| import_resume | 导入简历，可附 contextPath 事实文件 |
| list_resumes | 已导入简历的路线和版本 |
| get_resume | 指定版本的简历及事实正文 |
| set_preferences | 保存已确认的目标、城市、月薪和办公范围 |
| screening_context | 取得简历、岗位和偏好，供 Codex 对照 |
| save_assessment | 保存原文依据、推荐或待核实结论 |
| list_jobs | 岗位、进度和指定简历的筛选结果 |
| update_progress | 记录已发生的求职动作和历史 |
| get_progress_history | 查看一个岗位的进度历史 |
| backup_records | 备份本机数据库 |

BOSS 搜索使用 query、cityCode、limit。Greenhouse 使用 query、location、limit，可用 boardTokens 限定本次公司；未提供时使用已保存的目标公司。关键词匹配标题、公司和正文，location 匹配地点文字。Greenhouse 返回 ready、empty、partial 或 failed；search.boards 记录各公司覆盖数量或失败原因。

list_jobs 支持 platform、status、query、resumeId、limit 与 offset。query 匹配标题、公司和地点。Greenhouse 与 BOSS 共用简历筛选、收藏和进度工具。

筛选写入时同时校验 jobRevision 与引用原文。岗位变更会令旧结论失效。更新进度使用 UUID requestId，重复提交同一操作不会生成重复事件。
