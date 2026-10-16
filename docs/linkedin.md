# LinkedIn 接入

范围：免登录访客搜索、按岗位链接读取正文、统一记录身份，并接入已有筛选与求职进度。当前为开发功能，尚未发布。

官方 Job Posting API 面向获批的招聘系统合作方，用于发布职位，不是普通求职者搜索接口。JobSpy 等开源实现使用访客搜索页面与公开详情页；这些页面不是稳定的开放开发者 API。LinkedIn 官方限制第三方自动抓取，访问可能被限流或要求验证。

实现只访问固定 LinkedIn HTTPS 地址，读取公开 HTML，不使用账号 Cookie、代理轮换或验证码处理。单次搜索读取一页，保留实际条数和下一页偏移；不假定每页固定条数。短请求间隔、并发限制和429后的冷却由同一读取器管理，不自动重试。

搜索卡片校验链接和岗位编号。详情必须有对应的规范链接或主页面元数据，正文独立提取；登录、验证、身份不明、布局未知和限流分别返回错误，不能当作零结果或完整详情。只有列表时仍按初筛处理。

旧版通用导入中的 LinkedIn 链接在重新读取或导入时按规范身份接续原记录，保留进度与历史；多个旧记录指向同一岗位时明确报冲突，不自动合并。

2026-10-16 首次免登录搜索实测返回 HTTP 429。冷却后，通过真实 stdio MCP 搜索 AI Product、Milan, Italy，读取 Staff Product Manager, AI Management 的5,147字符正文，并再次从本机记录读取成功。真实面板随后以相同关键词和地点返回10个岗位，读取 Product Lead 的3,001字符正文，完成收藏、进度历史与设置页状态检查。验证使用隔离资料目录，没有写入个人求职记录；结果限于这些访客请求，登录态未验证。

可分别用 `node scripts/linkedin-live-check.mjs` 和 `node scripts/linkedin-live-check.mjs --panel` 复测 MCP 与面板。`--report=文件路径` 保存本次真实结果；失败返回非零退出码。两个命令各自发起真实请求，请在冷却结束后按需执行。

来源：

- [LinkedIn Job Posting API](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview)
- [JobSpy LinkedIn 实现](https://github.com/speedyapply/JobSpy/blob/main/jobspy/linkedin/__init__.py)
- [访客页面地址参考](https://github.com/MadsLorentzen/ai-job-search/blob/master/.agents/skills/linkedin-search/url-reference.md)
- [LinkedIn 对自动化软件的说明](https://www.linkedin.com/help/linkedin/answer/a1341387)

Monid 目录有按请求或结果计费的第三方接口，本次仅免费检索目录，未执行收费调用。
