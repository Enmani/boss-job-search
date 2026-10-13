# MCP 工具

profile 默认 personal，用于隔离本机资料。Chrome 连接来自本人已经加载扩展的配置。

| 工具 | 用途 |
| --- | --- |
| get_status | 连接、简历元数据、偏好和最近搜索 |
| open_login | 打开本人 Chrome 的登录页 |
| close_browser | 清理当前会话创建的标签 |
| open_dashboard | 启动本机求职面板，返回带临时访问凭据的链接 |
| set_greenhouse_boards | 添加最多十个公司招聘页或 board token |
| set_platform_boards | 为 greenhouse、ashby、lever 保存目标公司 |
| check_platform | 检测 BOSS 本机连接或已配置公司的实际接口读取状态 |
| search_jobs | boss 读取当前页；greenhouse、ashby、lever 搜索添加的公司 |
| get_job_detail | 按 jobId 与所属平台读取完整详情并更新记录 |
| get_saved_job | 查看已保存正文和进度历史，不访问网站 |
| import_visible_jobs | 导入本人实际读取的岗位材料 |
| import_job | 保存链接、名称、正文及可选薪资字段，不抓取链接 |
| import_resume | 导入简历，可附 contextPath 事实文件 |
| list_resumes | 已导入简历的路线和版本 |
| get_resume | 指定版本的简历及事实正文 |
| set_preferences | 保存目标、地点、薪资单位、经验要求上限、办公范围和默认简历 |
| screening_context | 取得简历、最多30个岗位和偏好，供 Codex 对照 |
| save_assessment | 保存原文依据、推荐或待核实结论 |
| save_assessments | 事务内保存最多30条结论，任何一项无效则整批回滚 |
| rank_jobs | 条件与当前结论排序，区分未筛选、过期和未知，可分页 |
| list_jobs | 岗位、进度和指定简历的筛选结果 |
| update_progress | 记录已发生的求职动作和历史 |
| get_progress_history | 查看一个岗位的进度历史 |
| backup_records | 备份本机数据库 |

BOSS 搜索使用 query、cityCode、limit。公开接口使用 query、location、limit，可用 boardTokens 限定本次公司；未提供时使用该平台已保存的目标公司。关键词匹配标题、公司和正文，location 匹配地点文字。返回 ready、empty、partial 或 failed；search.boards 记录各公司数量或失败原因。Lever 欧洲站通过完整招聘页地址指定。

list_jobs 支持 platform、status、query、resumeId、limit 与 offset。query 匹配标题、公司和地点。Greenhouse 与 BOSS 共用简历筛选、收藏和进度工具。

筛选写入时同时校验 jobRevision 与引用原文。岗位变更会令旧结论失效。更新进度使用 UUID requestId，重复提交同一操作不会生成重复事件。

批量流程：screening_context → Codex 对照原文 → save_assessments → rank_jobs。批量结论格式为 `{resumeId, assessments:[{jobId,jobRevision,assessment}]}`；单条 assessment 格式沿用 save_assessment。引用只含空白会拒绝。

rank_jobs 接受 list_jobs 的筛选和分页参数，以及 includeRejected（默认 true）。缺省 resumeId 使用默认简历。先对最近最多500个候选排序再分页，返回 total、hasMore、candidateLimitReached 和覆盖说明。顺序为推荐、待核实、未筛选、需复核、不符合；硬条件冲突优先于推荐。排序不产生新的语义判断。

minimumSalary 为 `{amount,currency,period}`，period 为 hour/day/month/year；maxExperienceYears 指岗位要求的最低工作年限上限。未披露或币种周期不一致保留待核实，不换算汇率。defaultResumeId 须是该 profile 的已有简历。
