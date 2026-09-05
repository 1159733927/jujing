# 命盘落库设计

## 目标

命盘是可以反复查看和更新的个人档案，不是报告里的临时字段。服务端是事实源，浏览器 `localStorage` 只保存最近一次显示快照；C 端用户通过 admin 下发账号登录后，可恢复该账号绑定主体下的命盘、住宅和报告。

## 数据关系

```text
user_account（admin 下发账号）
  └─ principal（账号绑定主体；兼容首次登录前的匿名主体）
  └─ chart_profile（逻辑命盘档案，名称、关系、当前版本与 revision）
       └─ chart_version（不可变出生输入与排盘结果）
            └─ report.chart_profile_id + report.chart_version_id（生成报告时的确切引用）
```

- `principals` 只保存随机访问令牌的 SHA-256 哈希，不保存原始令牌、设备指纹或 IP。
- `user_accounts` 由 admin 创建，保存用户名、展示名、密码哈希、状态、绑定主体和最近登录时间；不提供公开注册。
- `user_sessions` 保存 C 端 HttpOnly 登录会话。禁用账号和重置密码都会撤销该用户现有会话。
- `chart_profiles` 保存归属、用户可见名称 `label`、对象关系 `relationship`、当前版本、乐观锁 revision 和软删除时间。
- `relationship` 只允许 `self`、`partner`、`parent`、`child`、`other`；`label` 长度为 1-40 个字符，缺省为 `我的命盘`。
- 数据库和文件存储都允许同一主体保存多个未删除档案，最多 10 个，用于本人、家人和其他对象的命盘管理。
- `GET /v1/charts/current` 是兼容接口，只返回最近更新的一个未删除档案；新功能应使用 `GET /v1/charts` 枚举全部未删除档案。
- `chart_versions` 追加保存出生输入、确定性排盘结果，以及本次计算采用的专家规则发布版本引用；历史版本不覆盖。
- 新计算只能绑定当前仍有效的发布版本；旧命盘保留当时的版本号和内容哈希，即使后台随后发布新版或归档配置也不会漂移。
- 兼容期内允许旧命盘没有专家规则引用，此时产品必须明确显示为引擎内置规则，不能伪装成专家审核结果。
- 住宅报告只复用出生输入和规则版本都一致的当前命盘；规则选择发生变化时追加新的命盘版本，再让报告引用新的 `chart_version_id`。
- 已停用的规则版本继续保留在历史命盘与既有报告中用于复算和审计，但不能用于创建新命盘版本；前端恢复这类历史命盘时自动选择当前启用规则，保存后生成新的命盘版本。
- `GET /v1/charts/:profileId/versions/:versionId/pdf` 按登录账号绑定主体、命盘 ID 与不可变版本 ID 精确读取服务端快照并生成 PDF，不重新排盘。跨主体与不存在统一返回 `404`；响应使用私有禁缓存头，不包含住宅照片、内部主体 ID 或凭证。软删除后的本人历史版本仍按版本历史语义允许导出。
- 服务端 PDF 使用共享白名单模板、受限并发的 Chromium 和 Noto CJK 字体；渲染时禁止外部网络请求。浏览器或字体不可用时明确返回 `503`，不返回空白文件或伪 PDF。
- `reports` 继续保存生成时的完整快照，并用 API 字段 `chartProfileId`、`chartVersionId`（数据库列为 `chart_profile_id`、`chart_version_id`）指向确切命盘档案与版本，以便审计和复现。

## 访问与隐私

用户登录成功后，API 签发随机 `HttpOnly; SameSite=Lax` 用户会话 Cookie。首次登录会绑定当前浏览器已有匿名主体或创建新的主体，不强制修改密码；后续读取、更新和删除必须同时满足档案 ID 与账号主体归属。生产环境 Cookie 还带 `Secure`。

当前 Demo 不提供公开注册，账号由 admin 下发。匿名主体只作为首次绑定兼容层，不使用指纹猜测归属，也不暴露可枚举的公开命盘 ID。

## 更新、并发与删除

- 更新命盘时客户端携带 `expectedRevision`；服务端在一个事务中锁定档案、校验 revision、插入新版本并切换当前版本。
- revision 不匹配返回 `409`，客户端必须重新加载，避免另一个页面的更新被静默覆盖。
- “移除命盘档案”执行软删除，之后不再出现在 `GET /v1/charts` 和 `GET /v1/charts/current` 中，并释放 10 个未删除档案容量。
- 软删除后的档案仍可由同一登录账号绑定主体读取历史版本并恢复；恢复前会重新校验该主体的未删除档案数量，达到 10 个时恢复失败，避免恢复后超过容量。
- 已生成报告保留其命盘快照和版本引用，不因档案软删除而变化。
- 面向真实用户开放前，需要再增加隐私硬删除/保留期策略和账户认领流程。

## API

- `POST /v1/bazi`：纯计算，不落库，便于确定性校验。
- `GET /v1/charts`：按登录账号绑定主体读取全部未删除档案，按最近更新时间倒序返回；无有效会话时返回 `{ "profiles": [] }`。
- `GET /v1/charts/current`：兼容接口，按登录账号绑定主体读取最近更新的未删除档案，缺失时固定返回 `{ "profile": null }`。
- `POST /v1/charts`：创建一个命盘档案和首个版本；可选 `label` 与 `relationship`，同一主体最多 10 个未删除档案，超额返回 `409`。
- `GET /v1/charts/:id/versions`：按版本号倒序读取自己的全部历史版本，包括软删除档案。
- `POST /v1/charts/:id/versions`：追加不可变版本，要求 `expectedRevision`。
- `POST /v1/charts/:id/flow`：按指定命盘版本和目标日期时间返回查询态流盘；流月使用 `flow-v4-timezone-projected-jie-boundaries`，每项包含 `startTerm`、`endTerm`、`startAt`、`endAt`。节气先从上海墙钟解析为绝对时刻，再投影到目标 IANA 时区并应用同一 DST/真太阳时规则。边界是 `corrected-local-solar-term-wall-v2` 的分钟精度本地墙钟时间（秒固定为 `00`），不是 UTC/RFC3339 instant。
- `DELETE /v1/charts/:id`：软删除自己的档案。
- `POST /v1/charts/:id/restore`：恢复自己的软删除档案；如果当前已有 10 个未删除档案，存储层会拒绝恢复，API 层需要把该失败映射为稳定冲突响应后再作为生产验收项。
- `POST /v1/reports`：复用指定命盘档案时必须同时提交当前看到的 `chartVersionId`；版本已变化则返回 `409` 要求刷新。没有指定档案时，API 会为出生资料创建/追加版本，并把确切版本记录进报告。
- `GET /v1/reports`：默认只返回当前账号主体的未归档报告，按创建时间倒序排列；可带 `chartProfileId` 只看当前成员报告，也可带 `residenceProfileId` 只看某套住宅报告；两个参数同时存在时取交集；无有效会话时固定返回 `{ "reports": [] }`。
- `GET /v1/reports?archived=true`：只返回当前账号主体的归档报告，用作回收站列表；不会混入活跃报告，并支持同样的成员/住宅筛选。
- `GET /v1/reports/:id`：只允许创建报告时绑定的同一账号主体读取；无会话、其他账号、旧无归属记录与不存在 ID 均返回 `404`，避免 ID 枚举泄露。公开响应移除照片和视觉记录中的私有 `fileId`，服务端事实记录仍保留该标识供处理与审计。
- `GET /v1/reports/:id/pdf`：只允许同一账号主体导出未归档、已完成且有正文的报告；按报告 ID 与主体一次性精确查询，未完成或已归档返回 `409`，手工四柱报告暂返回 `422`，渲染运行时不可用返回稳定 `503`。PDF 使用共享白名单模板、安全 Markdown 子集、私有禁缓存响应和受限 Chromium，不包含照片文件标识或内部主体信息。
- `DELETE /v1/reports/:id`：把自己的 `completed` 或 `failed` 报告软归档，并返回 `204`；`queued` 或处理中报告返回 `409`。归档会写入 `archivedAt`、撤销分享访问、清除运行租约，并从默认报告列表和 worker 认领范围移除；同一主体仍可读取详情。
- `POST /v1/reports/:id/restore`：恢复自己的归档报告并返回脱敏报告详情；恢复不会恢复旧分享 token，需要重新满足分享条件后再创建新分享。
- `POST /v1/reports/:id/regenerate`：基于自己的已完成报告创建一个新报告任务，返回 `202`。源报告必须绑定确切的不可变命盘档案版本、住宅档案版本，并保留已保存的 `vision` 事实；缺少任一项返回 `409`。新报告保存新的 `id` 和 `sourceReportId`，复用源报告的命盘版本、住宅版本、用户提交照片标注和已保存视觉事实，但不读取已删除原图，也不复用旧 citations、规则结果、报告正文、分享 token 或 `generationProvenance`。后续会重新跑当前知识检索、规则评估、Harness 报告生成和后台质检。

每个新生成的命盘版本在 `bazi.timeProfile.runtimeProvenance` 中保存实际使用的 Node Intl、TZDB、ICU、CLDR 与 Unicode 版本标识（仅记录当前运行时实际提供的字段，不含时间戳、路径或机器标识）。这些字段随完整 `BaziChart` 一起进入文件或 PostgreSQL JSON 快照，不需要独立数据表。旧版本缺少该字段时按“旧版本未记录”读取，不得用当前服务器版本回填历史结果。
- `POST /v1/reports/:id/share` / `DELETE /v1/reports/:id/share`：只允许报告创建者为未归档、已完成、validator 通过且 `qualityStatus: passed` 的报告创建或撤销分享访问。服务端只保存 token 的 SHA-256 hash，重复创建会旋转 token 并让旧 token 失效，默认 7 天过期；`qualityStatus` 为 `pending`、`running`、`failed` 或报告已归档时创建分享返回 `409`。
- `GET /v1/shared-reports/:id`：不依赖匿名 cookie，只接受 `x-report-share-token`。缺失、错误、超长、过期、已撤销 token、报告被归档、报告质检状态不再为 `passed` 与不存在报告统一返回 `404`；成功响应使用 `private, no-store` 并复用脱敏报告结构，不暴露 `principalId`、`shareAccess`、`reviewDraft` 或私有上传 `fileId`。

报告 worker 使用两套彼此独立的持久状态：`runLease.workerId + attempt` 只负责并发 fencing，`pipelineCheckpoint` 负责业务断点。citations、视觉结果、规则结果、专业推理、Harness 草稿以及每次质量审核/修订完成后都会先通过 `saveClaimed` 落库，再进入下一阶段。服务重启只会跳过“checkpoint 与对应输出同时存在”的阶段；旧报告缺 checkpoint 时保守重跑。首版通过 validator 后先保存为 `completed` 且 `qualityStatus: pending`，后台质检运行中为 `running`，通过后为 `passed`，失败时保留首版并保存 `qualityStatus: failed`。失去 lease 的旧 worker 不清理住宅图片，只有当前 worker 成功保存整体 `failed`、`qualityStatus: passed` 或 `qualityStatus: failed` 的终态后才清理。

## 存储驱动

- 本地 Demo 和测试：`.data/charts.json` 与 `.data/accounts.json`，串行写队列加临时文件原子替换。
- 部署模式：PostgreSQL migration `002_chart_profiles.sql` 创建基础命盘表；`013_multi_chart_profiles.sql` 增加 `label`、`relationship` 并移除“每个主体只能有一个活动命盘”的唯一索引；`014_report_archive_lineage.sql` 为报告增加 `archived_at`、`source_report_id` 和主体活跃/归档列表索引；`015_admin_issued_accounts.sql` 增加 admin 下发账号、用户会话和最近登录时间。命盘版本追加使用事务和 `FOR UPDATE`；创建与恢复用主体级 advisory lock 串行化容量检查。
- 报告 lineage：`sourceReportId` 表示一份报告由 `POST /v1/reports/:id/regenerate` 从另一份已完成报告创建，用于把同一命盘版本、住宅版本和视觉事实下的多次生成串起来。
- PostgreSQL 是生产模式唯一允许的驱动，不会静默降级到文件。
