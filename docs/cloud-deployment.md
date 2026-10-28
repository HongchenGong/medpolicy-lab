# GitHub + Render Free + Supabase Free

这个项目是完整的 Next.js 服务端应用。GitHub 保存代码并运行检查；实际网页由 Render 提供，数据和原文件保存在 Supabase。GitHub Pages 不能独立运行本系统。

## 免费方案及限制（核对于2026-10-28）

- Render Web Service 必须选 Free。空闲15分钟后休眠，下次访问约需1分钟唤醒。每月750免费实例小时，与账号下其他免费实例共享；平台可重启或暂停免费服务。不要用 Render 免费磁盘保存资料，也不要使用30天到期的免费 Render Postgres。
- Supabase 必须选 Free：数据库500MB、文件1GB、普通出站5GB；一周无活动会暂停。不能保证无限使用或永久维持现行免费额度。
- 不购买域名，不启用付费实例、付费磁盘或其他付费附加项。Render 若已有支付方式，超出带宽/构建额度可能收费；零费用部署须先核对账号计费设置，不能只看服务的 Free 标签。
- 国内校园网络的可访问性需要上线后实测。部署成功不能证明所有地区网络都稳定。

官方依据：https://render.com/docs/free 和 https://supabase.com/pricing。

## 连接与配置

优先通过已连接的 Render、Supabase 管理工具完成设置。创建服务、SQL迁移和环境变量配置由开发代理执行；账号登录和授权由账号所有者完成。不要把密码或数据库凭据粘贴到公开仓库、Issues、聊天截图或 Actions 日志。

Render Blueprint 已写入仓库根目录 render.yaml，固定 plan: free、Singapore、Node 24，构建完整应用。通过 GitHub 检查后自动部署；不会配置 Pages。

Supabase 建议选与网站接近的区域。DATABASE_URL 使用 Session pooler 的 PostgreSQL 连接字符串（支持IPv4）；连接使用TLS证书验证，不允许通过关闭证书校验解决错误。若平台提供专用CA，把证书内容保存在 DATABASE_CA_CERT。不要选择 Transaction pooler：应用使用连接级 search_path。

服务端私密环境变量：

| 名称 | 作用 |
|---|---|
| DATABASE_URL | PostgreSQL连接字符串，含数据库密码 |
| SUPABASE_URL | Supabase项目HTTPS地址 |
| SUPABASE_SERVICE_ROLE_KEY | 仅服务端使用的Storage管理密钥 |
| STORAGE_BUCKET | 默认 medpolicy-private，必须为私有 |
| ADMIN_INITIAL_PASSWORD | 首次初始化的独立组长密码 |
| SEED_CONFIG_JSON | 本地 data/seed-config.private.json 的内容，仅用于首次初始化 |
| APP_ORIGIN | 公开HTTPS来源；Render默认从 RENDER_EXTERNAL_URL 自动获取 |

公开仓库不含任何真实姓名、完整学号、默认密码、课程原件或数据库。初始化配置中的 members 数组共12项，每项为 `[姓名, 学号字符串]`，第一位为管理员，后11位依次负责R01—R11；memberPassword指定成员初始密码。仅示例结构，不在文档中写真实值。

cloud-start 在启动前验证数据库和私有存储桶。首次启动只在空数据库初始化；再次部署不会重置账号或覆盖研究历史。Cookie自动启用Secure，固定HTTPS来源；初始化秘密不会传给运行中的Web子进程。数据库位于 medpolicy schema，不通过Supabase的 public Data API 暴露，并启用RLS；没有客户端访问策略，仅服务端数据库所有者连接可操作。文件必须先通过本站服务端权限校验才能下载。

## 已有本地数据

data/ 内有真实数据库、课程资料及私密初始化配置，应留在本机或加密备份中。部署前必须选择“迁移已有数据”或“建立空项目后重新上传课程资料”；不得把data目录加入Git。

本项目附有 scripts/migrate-cloud.ts：仅向空的云端数据库迁移已有账号哈希、研究记录和课程原件，排除旧会话/限流记录，校验原文件SHA256并保留版本。使用前须先获得目标云账号授权并确认目标项目；脚本不会创建付费服务。迁移脚本不会打印秘密。

## 验证与更新

自动检查覆盖本地SQLite及PGlite内嵌PostgreSQL引擎的完整工作流。对象存储另有协议测试；这不等于已验证真实Supabase连接、云端TLS或跨网络访问。仍需在实际托管服务完成部署、两种浏览器访问、上传下载、重新部署后的持久化验证。

后续修改推送main分支，GitHub运行检查，Render在检查通过后更新。数据库和原文件保存在独立服务中，不随网站代码重建丢失。云端ZIP按流式生成，避免把所有原文件一次性载入免费实例内存。
