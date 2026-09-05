# 居境 Compass

面向投资人演示的住宅文化分析报告应用。它将确定性八字排盘、住宅资料、多张带标注照片、专家审核知识和 DeepSeek Harness 组合成一次性静态报告，不提供持续算命对话。

## 当前闭环

- 用户端：由 admin 下发账号后登录；公历/农历出生资料、日期与时间选择器、省/市/区县级联地点选择、独立可随时访问的 `/chart` 命盘页、多人/多命盘切换、住宅朝向与格局、多图上传及逐图空间/镜头方向标注、按成员和住宅查看历史报告。
- API：地点派生经纬度与时区、北京时间输入与可切换的真太阳时校正、账号绑定主体下的多命盘档案、版本化命盘与多住宅档案、按精确历史版本生成的命盘 PDF、按账号主体保护的住宅报告 PDF、查询态流盘计算、私有照片存储、持久化报告、专家知识、问真对照样例，以及独立的八字流派规则发布链路。
- 专家后台：管理员登录后下发 C 端账号、停用账号和重置密码；创建或从 TXT、Markdown、JSON 导入资料；另行管理八字流派配置的草稿、审核、发布与归档；提供问真对照校验台，用于录入人工摘回的四柱、预览差异，并在上传证据引用和人工确认后保存为后续回归样例。资料与规则发布都会生成带内容哈希的不可变版本，但彼此不混用。
- Harness：独立 `fengshui-report` 服务插件、`fengshui-reasoning` 专业推理 Skill、`fengshui-report` 报告 Skill，以及 DeepSeek Harness SDK profile。API 先生成确定性的命盘—住宅证据链；证据足够时直接交给报告 Agent，证据不足时再调用专业推理 Agent 补全，最后由质量 Agent 审核；模型侧实际可见工具精确为 `skill`。
- 边界：本地演示的图片和文件型运行数据位于被 Git 忽略的 `.data`；部署模式的命盘、住宅、报告任务状态、知识与问真人工核验样例事实源为 PostgreSQL，图片仍在私有持久卷；密钥只从被忽略的 `.env` 或服务端运行环境读取。报告记录是可随任务推进更新的状态记录；命盘版本、住宅版本、已发布知识版本、八字流派规则版本和问真核验样例承担不可变版本审计。

## 本地启动

前置条件：Node.js、pnpm。只有实际生成报告时才需要 DeepSeek API 凭证，并且只保存在本机 `.env` 或服务端运行环境中；普通测试和 PostgreSQL 约束回归不需要真实 DeepSeek key。API 只在本地开发启动入口显式加载 `.env`；生产运行和内部适配器只接受进程环境注入，不会自行遍历或回退读取项目文件。

本地开发可以复制空模板，不要把 `.env.example` 里的部署占位值当成生产凭证：

```sh
cp .env.local.example .env
pnpm install
pnpm dev:demo
```

`pnpm dev` 和 `pnpm dev:demo` 都通过 Node supervisor 同时启动三端；`pnpm dev:core` 只用于开发者临时启动用户端和 API，不适合作为投资人演示入口：

- 用户端：`http://127.0.0.1:4173/`
- 独立命盘页：`http://127.0.0.1:4173/chart`
- 专家后台：`http://127.0.0.1:4174/admin/`
- API：`http://127.0.0.1:3001/`

三端启动后，可以另开一个终端运行 `pnpm smoke:demo` 做本地演示验收。它会检查 API、用户端首页、命盘页、报告页和专家后台是否可访问，页面 HTML 是否包含可见 fallback 文案，以及用户端/专家后台的 Vite React 入口是否可加载；如果当前 shell 显式配置了 `ADMIN_API_TOKEN`，还会真实执行 Demo 知识库一键导入并验证后台列表。未配置该令牌时，写入型检查会跳过，不会读取或打印 `pnpm dev:demo` 自动生成的临时令牌。

本地 `pnpm dev:demo` 未显式设置后台凭证时，默认使用 `admin / admin123`。该弱密码仅用于本机演示；部署时必须通过 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 覆盖。

`pnpm smoke:demo` 默认把“报告生成链路 ready”作为投资人演示硬门槛；如果只是开发阶段临时检查页面壳，可以显式运行 `ALLOW_REPORT_NOT_READY=1 pnpm smoke:demo` 放宽这一项。

需要验证“独立后台下发账号 → C 端登录 → 多成员命盘 → 创建报告 → 历史报告归档/回收站/恢复”的真实浏览器链路时，运行：

```sh
pnpm e2e:account
```

该命令会在临时文件存储目录中启动一组隔离的 API、用户端和后台端口，并用本机 Chrome 的无头模式点击页面完成验收；默认使用 dummy DeepSeek key，因此只验证账号、命盘、报告状态、归档恢复和页面交互，不把真实模型质量作为门槛。若要改用其他 Chrome 路径，可设置 `CHROME_EXECUTABLE_PATH`。

仓库根目录的五本《中州派玄空风水》PDF 可解析为带章节、页码与内容哈希的知识切片，并送入待审核队列：

```sh
PDF_IMPORT_PYTHON=/path/to/python-with-pdfplumber pnpm --filter @fengshui/api knowledge:import-books
```

导入具有幂等性；重复执行会跳过相同来源与内容的切片。导入结果为 `in-review`，不会进入报告检索，必须由另一名审核者发布后才可使用。

按下 `Ctrl-C` 会让 supervisor 清理 API、用户端和专家后台三个子进程。如果本次 shell 没有设置 `KNOWLEDGE_MCP_TOKEN`，supervisor 会只为当前 API 子进程生成一个内存中的本地临时 token；该 token 不写入磁盘、不打印到日志，也不会注入浏览器前端。若单独直接启动 API，本地开发模式会让 Harness 读取文件知识库，不会因为缺少内部 reader token 阻断报告生成；生产环境仍必须显式配置 `KNOWLEDGE_MCP_TOKEN`。API 仍可从本地开发 `.env` 读取 `DEEPSEEK_API_KEY`，因此启动 shell 里没有这个变量时，报告功能不一定不可用。

专家后台推荐设置 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 使用 HttpOnly 管理员会话登录；`ADMIN_API_TOKEN` 保留给本地脚本或受控内部调用，不能暴露到浏览器。`ADMIN_ACTOR_ID` 是写入审核记录的服务端稳定身份。

基础功能（admin 下发账号、用户登录、出生资料、地点选择、命盘落库、住宅多图、专家资料草稿）可在文件存储模式下本地跑通。真实报告生成还需要服务端能读取真实 DeepSeek key；正式给投资人演示前，必须使用新的真实令牌，并轮换任何曾经粘贴到聊天里的 DeepSeek key。命盘由后端程序独立计算并作为版本化档案保存；C 端账号由 admin 创建，不提供公开注册，也不强制首次登录修改密码。账号首次登录会绑定当前浏览器已有匿名主体或创建新的主体，之后该账号名下最多可保留 10 个未删除命盘档案，每个档案带 `label` 和 `relationship`，用于区分本人、伴侣、父母、子女或其他对象。`GET /api/v1/charts` 返回当前登录账号的全部未删除命盘档案；旧的 `GET /api/v1/charts/current` 继续兼容，只返回最近更新的一个档案。软删除会释放 10 个档案容量，恢复时会重新检查容量。住宅同样按账号绑定主体保存多套档案，每次修改都会追加不可变版本。报告固定引用生成时的 `chartProfileId`、`chartVersionId`、住宅版本和命盘快照，后续编辑不会改写历史结论。当前浏览器持有 HttpOnly 用户会话；本地缓存只用于快速显示。DeepSeek Harness 自带的 Web UI 不属于产品界面，也不需要启动。

命盘页会通过公开只读接口 `GET /v1/bazi/runtime` 核对已保存命盘与当前排盘环境的时区数据版本。该接口只返回 `provider`、`tzdbVersion` 和 `icuVersion`，不公开 Node 补丁版本、本机路径或其他运行环境信息；版本不同只提示生成新命盘版本，不会自动覆盖历史命盘。

如果只是想快速准备一场投资人演示，可以显式设置 `DEMO_SEED_KNOWLEDGE=true` 来准备 Demo 资料包：系统会按正式链路创建或复用已审核发布的演示资料。默认不再自动导入，避免真实专家书库与 Demo 资料混用。专家后台仍保留“一键导入 Demo 资料”按钮。

本地文件存储开发模式还会自动发布一条标注清楚的 `演示流派 · 真太阳时` 规则版本，用来保证首次打开 Demo 时就能展示“专家规则发布 → 命盘版本绑定 → 报告依据追溯”的闭环。生产环境不会自动种子；如果本地也想从空后台开始，把 `.env` 中 `DEMO_SEED_KNOWLEDGE=false` 和 `DEMO_SEED_BAZI_RULE_PROFILE=false`。

投资人 Demo 的出生地点选择器已经接入 `province-city-china@8.5.8` 全国区县行政树，并内置 GeoNames 中国快照（CC BY 4.0）交叉映射后的审核坐标：当前 3311 个区县级节点中，2612 个来自 GeoNames，另有 2 个明确标记为 `manual-demo` 的演示 fallback，最终 2614 个地点可用于排盘，697 个地点会展示为“坐标待补充”。服务端始终以 `placeCode` 重新派生经纬度、时区和 `geoDataVersion`，不会相信浏览器提交的坐标覆盖值；命盘、命盘版本与未绑定既有命盘的报告写入都强制要求 `placeCode`，旧自由地点输入只保留在无存档诊断接口中。该数据集标记为 `licensed-partial`，不得宣称全国坐标完整覆盖。日期选择器的农历月份来自只读接口 `GET /api/v1/calendar/lunar-years/:year`（支持 1801–2100），闰月作为独立月份出现，每月天数严格限制为 29 或 30；月表加载失败时农历确认会被禁用，公历输入不受影响。命盘专业视图包含四柱、十神、藏干、支神、纳音、空亡、地势、自坐、神煞、干支关系，以及大运、流年、流月、流日、流时。命盘页通过 `POST /api/v1/charts/:id/flow` 按服务端已保存的命盘版本和目标日期时间即时计算流盘；流月按 `flow-v4-timezone-projected-jie-boundaries` 生成，从立春到次年立春取 13 个精确“节”，先映射到目标 IANA 时区，再按同一 DST 与真太阳时规则钟形成 12 个半开区间。`startAt`/`endAt` 是校正后本地墙钟分钟精度时间（秒固定为 `00`），不带 `Z` 或时区偏移，也不是 UTC instant。客户端不能覆盖出生资料或规则版本，查询也不会新增命盘版本。旧命盘如果缺少省市区、地点编码、纬度或时区，会提示重新选择出生地点后保存。`POST /api/v1/bazi/flow` 仅保留为无存档计算的兼容入口。专家后台本地导入支持 `.txt`、`.md`、`.json`；仓库内置的专家书籍导入命令还支持 PDF 文本层解析、标题/段落感知切片、页眉页脚清理和待审核入库，DOCX 仍留待后续文档抽取服务处理。问真对照页同样使用行政区搜索选择器，只提交 `placeCode`，调用 `POST /api/v1/bazi/compare` 做服务端派生后的即时校验，返回的叶子级差异路径可原样用于 `acceptedDifferences`，通过管理员确认后调用 `POST /api/v1/bazi/wenzhen/fixtures` 追加写入 schema-versioned fixture store。后台四柱是最小必填，扩展 expected JSON 可继续录入已人工摘录的时间校正、专业表格、大运和动态流盘字段。真实问真截图通过 `POST /api/v1/bazi/wenzhen/evidence` 按 SHA-256 保存到 `.data/evidence/wenzhen/`，fixture 只保存稳定 `evidenceRef`。文件模式使用并发串行化与原子替换，生产模式使用 append-only PostgreSQL 表；经专家确认的差异必须逐条给出路径、分类和理由，并通过独立审核令牌写入审核身份与时间。当前已有 6 条真实问真截图哈希样例通过 `pnpm wenzhen:diff`，但仍不应宣称已与问真完全一致。

问真差异报告只对 fixture 实际填写的字段负责；当前 6 条真实样例覆盖计数为四柱 6、时间校正 5、专业表 5、大运 1、动态流盘 1。新接受差异必须逐条选择 `dependency`、`school-rule`、`timezone-location` 或 `display-rounding` 并填写理由，`bug` 不允许接受；历史无分类记录仍可读取。`pnpm wenzhen:diff` 用于诊断当前进度，只有严格的 `pnpm wenzhen:gate` 返回 0 才表示完整矩阵达到阶段 1 验收标准。

采集矩阵里的每个 `capture` 标签必须归入机器断言、输入绑定或截图人工复核之一；未知标签会产生 `unmapped-capture-label` 并阻断严格门禁，不能被静默忽略。机器断言范围仍只由 fixture 的实际 `expected` 叶子路径决定，人工复核标签不会增加自动覆盖计数。

八字流派规则使用 `schemaVersion: 2` 的数据型决策表。规则只能读取固定事实路径、固定操作符和已发布知识版本引用，不能执行脚本，也不会把后台完整规则表暴露给浏览器。命盘现会保存 `seasonal-support-baseline-v1` 平衡中间量、`month-command-facts-v1` 月令主气事实，以及 `support-dimensions-facts-v1` 得令、得地、同类透干和印星透干等客观维度，并支持旺衰、格局、扶抑候选五行、神煞四类可版本化评估。扶抑候选只表达透明基线下的补扶或泄耗制方向，不等同于完整喜神、忌神或用神。只有引用真实已发布方法资料的规则才会生成程序结论；未命中或冲突时保持待定。现有五本中州派资料用于住宅玄空规则，不能作为子平八字旺衰、格局或喜忌的依据。Harness 若作有限的传统方法推断，必须单独标注为低置信度 AI 推断，不得冒充程序或专家库结论。

报告记录会保存各处理阶段的 `startedAt`、`completedAt`、`durationMs` 和结果状态，用于定位视觉分析、专业推理、报告生成与后台质量增强的耗时；其中不包含密钥、提示词或报告正文。`status: completed` 表示首版报告已通过服务端 validator 并可由创建者读取；`qualityStatus: pending | running | failed | passed` 单独表示后台增强进度。`POST /v1/reports/:id/regenerate` 可基于一份已完成报告重新生成新版：新报告使用新的 ID，保存 `sourceReportId`，固定复用源报告绑定的不可变命盘版本、住宅版本和已保存视觉事实，不读取已删除原图，也不复用旧 citations、规则结果、正文或 provenance。

当前版本报告采用两层阅读结构：首屏把“总体判断、最主要原因、需要注意”提取为结果摘要，并直接展示合拍与冲突正文；命盘前提、住宅属性、待确认信息和来源版本默认折叠。三项摘要不完整或旧报告格式不匹配时，页面保持原文完整展示，不会因提取失败丢失内容。

用户端当前采用 admin 下发账号登录，不提供公开注册。知识资料的完整列表、创建、修订、提交审核、发布和归档要求管理员会话或 `Authorization: Bearer <ADMIN_API_TOKEN>`。知识修订携带 `expectedRevision`，文件模式用写队列原子校验，PostgreSQL 模式在行锁内校验；过期编辑返回冲突，已经发布的版本和内容哈希不被覆盖。发布版本会记录提交、审核和发布的 actor 与时间，用于兼容既有审计结构；当前 Demo 不再要求单独的浏览器审核令牌。报告生成前，API 使用服务端内部令牌检索已发布专家资料，并把筛选后的 citations 固化到报告记录；模型不会获得知识 MCP、文件、网页或额外检索工具。配置知识 API 地址但缺少内部 token 时，检索会在进入 Harness 前失败关闭。浏览器不能直接读取专家正文，未配置相应服务端令牌时这些接口会关闭。问真后台采集动态流年、流月、流日或流时时，必须显式填写流盘目标日期，可选填写目标时间；不填写目标日期时不会默认使用当天，也不会生成 `flowQuery`。

报告与命盘共用当前登录账号绑定的 HttpOnly 用户会话和服务端主体。报告详情只对创建它的账号主体返回；无会话、其他账号、旧无归属记录和不存在 ID 均返回 404。`GET /v1/reports` 默认只返回未归档报告，可用 `chartProfileId` 只看当前成员报告，也可用 `residenceProfileId` 只看某套住宅的报告；两者同时提供时取交集。`GET /v1/reports?archived=true` 返回当前账号主体自己的回收站，并同样支持成员和住宅筛选。`DELETE /v1/reports/:id` 只把 `completed` 或 `failed` 报告归档，不物理删除；归档会撤销已有分享并清除运行租约，报告详情仍可由创建者读取。归档报告不能创建分享，`GET /v1/reports/:id/pdf` 也会返回 `409`。`POST /v1/reports/:id/restore` 恢复自己的归档报告，恢复后不会自动恢复旧分享 token。

首版报告通过服务端 validator 后进入 `completed`，创建者可立即读取；独立质检作为后台增强继续更新 `qualityStatus`。只有未归档且 `qualityStatus: passed` 的报告可由创建者调用 `POST /v1/reports/:id/share` 生成 7 天有效的分享 token；`pending`、`running`、`failed` 或已归档报告都不可分享。只读分享页使用 `/shared-report/:id#access=<token>`，token 保留在 URL fragment 中，不进入服务端访问日志。页面再通过 `x-report-share-token` 请求 `GET /v1/shared-reports/:id`。过期、撤销、错误 token、报告后来被降级、质检状态不再为 `passed`、报告被归档和不存在 ID 均统一返回 404，响应仍会剥离主体 ID、分享 hash 和私有上传 `fileId`。API 返回会移除私有上传 `fileId`，但服务端内部记录保留完整媒体引用用于视觉处理与审计。知识检索失败时报告先落为 queued，再更新为可查询的 failed 状态，不会留下无记录的裸 500。

重新生成要求源报告属于当前账号主体、状态为 `completed`，并且同时具备 `chartProfileId`、`chartVersionId`、`residenceProfileId`、`residenceVersionId` 和已保存 `vision`。创建成功后返回 `202` 和新报告记录；新任务跳过视觉模型识别阶段，从视觉 checkpoint 之后继续跑当前知识检索、规则评估、Harness 报告生成和后台质检。

命盘落库的数据边界、版本与删除语义见 `docs/chart-storage.md`；阶段 1 排盘基础产品的可复算路线见 `docs/phase-1-bazi-foundation.md`，依赖选型记录见 `docs/dependency-decisions-stage1.md`；问真/测测式能力对标见 `docs/competitor-bazi-reference.md`；阶段 0 到生产化的长期开发方案见 `docs/development-roadmap.md`；投资人演示前的本地验收步骤见 `docs/demo-acceptance-checklist.md`。C 端账号已可跨浏览器恢复自己的主体数据；未登录匿名凭证只作为首次绑定兼容层，生产前还需要补齐找回密码、租户隔离和隐私保留策略。

## 单机部署 Demo

项目包含 Docker Compose 包装，用于在单台 VM 上演示。C 端官网和 Admin 后台是两个独立 nginx 服务/端口，共用同一个 API 和 PostgreSQL：

- `http://127.0.0.1:${APP_PORT:-8080}/`：用户端报告生成流程。
- `http://127.0.0.1:${APP_PORT:-8080}/chart`：独立命盘档案。
- `http://127.0.0.1:${ADMIN_PORT:-8081}/admin/`：专家资料、账号、规则与问真后台。
- 两个前端服务各自的 `/api/` 都会反向代理到同一个 Fastify API。
- `db`：私有 PostgreSQL 服务，生产模式不会静默降级到 JSON 文件。

```sh
cp .env.example .env
# 编辑 .env，填入 POSTGRES_PASSWORD、ADMIN_API_TOKEN、ADMIN_USERNAME、ADMIN_PASSWORD、KNOWLEDGE_MCP_TOKEN。
# 只有要真实生成报告时才填 DEEPSEEK_API_KEY；验证数据库约束时不要使用真实 DeepSeek key。
# 可用 REPORT_GENERATION_TIMEOUT_MS 调整 Harness 报告生成超时，默认 480000，允许 30000-600000 毫秒。
docker compose up --build -d
curl -fsS "http://127.0.0.1:${APP_PORT:-8080}/api/ready"
curl -fsS "http://127.0.0.1:${ADMIN_PORT:-8081}/admin/"
```

完整的 build、健康检查、日志、备份、升级、回滚和停止流程见 `docs/deployment.md`。注意不要在有用数据的环境中运行 `docker compose down -v`，它会删除数据库和上传卷。

## 验证

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm --filter @fengshui/knowledge-mcp build
pnpm --filter @fengshui-report/dsh-fengshui-report build
pnpm --filter @fengshui/api exec tsx tests/harness-tool-catalog.integration.ts
pnpm wenzhen:diff
pnpm wenzhen:gate
```

`pnpm test` 会统一运行 API、排盘引擎和知识 MCP 测试。Harness 目录校验会加载真实受限 composition，在模型请求前停止，并断言实际模型可见工具精确为 `skill`。它不调用模型，也不依赖 denylist 文本判断。
`pnpm wenzhen:diff` 默认从 `.data/evidence/wenzhen` 读取私有截图本体，逐张核对存在性、大小、SHA-256 和 MIME 文件签名后才生成 v2 差异报告；缺图或截图被替换都会失败，不能只靠仓库里的 manifest 冒充真实证据。`pnpm wenzhen:gate` 还要求所有规划场景均已核验、输入和证据绑定一致且必要断言齐全；当前仍有待采集项时按设计返回非零。

问真完整对照还没收齐时，可以先导出人工采集清单：

```sh
pnpm wenzhen:capture-plan
pnpm wenzhen:capture-plan -- --json
```

清单按批次列出每个待采集样例的出生输入、必看字段、风险点和截图要求。它只读取 `capture-matrix.json` 中的 `pending-capture` 项，不生成 expected 四柱，也不会把本项目排盘结果冒充问真结果。

默认 `pnpm test` 会在未设置 `TEST_DATABASE_URL` 时跳过 PostgreSQL integration tests。需要强制跑真实 PostgreSQL 约束回归时，使用专门的门禁命令：

```sh
pnpm test:postgres
```

该命令未设置 `TEST_DATABASE_URL` 时会立即失败并返回非 0，避免把“跳过”误判成“通过”。设置后只运行已存在的 PostgreSQL integration tests：问真样例、知识发布，以及当前分支存在时的命盘持久化测试。

安全方式一：使用宿主机已有 PostgreSQL，但必须指向空的、可丢弃的测试数据库，不能连接生产库或共用业务库。测试只需要 dummy 环境变量，不需要真实 DeepSeek key。

```sh
TEST_DATABASE_URL='postgres://fengshui_test:password@127.0.0.1:5432/fengshui_test' \
DEEPSEEK_API_KEY=dummy \
pnpm test:postgres
```

如果本机已经安装 PostgreSQL 命令行工具（`initdb`、`pg_ctl`、`psql`），可以直接启动一次临时本地数据库并跑同一组真库测试：

```sh
pnpm test:postgres:local
```

该命令会创建空的临时数据目录、监听 `127.0.0.1:55433`、跑完后停库；临时目录默认保留，方便失败时查看 `server.log`，可手动删除。

安全方式二：使用隔离 Compose 只启动临时 PostgreSQL，并绑定到本机回环地址。测试完成后用同一个 project name 删除卷。

```sh
docker compose -p fengshui-pg-test -f - up -d --wait <<'YAML'
services:
  db:
    image: postgres:16-bookworm
    environment:
      POSTGRES_DB: fengshui_test
      POSTGRES_USER: fengshui_test
      POSTGRES_PASSWORD: dummy-postgres-password
    ports:
      - "127.0.0.1:55432:5432"
YAML

TEST_DATABASE_URL='postgres://fengshui_test:dummy-postgres-password@127.0.0.1:55432/fengshui_test' \
DEEPSEEK_API_KEY=dummy \
pnpm test:postgres

docker compose -p fengshui-pg-test -f - down -v <<'YAML'
services:
  db:
    image: postgres:16-bookworm
    environment:
      POSTGRES_DB: fengshui_test
      POSTGRES_USER: fengshui_test
      POSTGRES_PASSWORD: dummy-postgres-password
    ports:
      - "127.0.0.1:55432:5432"
YAML
```

这些测试会在目标库中创建唯一临时 schema，验证问真样例并发追加、重复拒绝、append-only 触发器和知识发布审计，然后只清理自己创建的 schema。

通过 Harness 验证模型侧工具目录：

```sh
pnpm --filter @fengshui/api exec tsx tests/harness-tool-catalog.integration.ts
```

报告正文的完整 prompt 不通过 CLI argv 传递。API 为每次报告生成创建独立的 `.data/report-harness-home/runs/<report-id>-<uuid>`，用 `sdk` profile 启动 Harness SDK，通过 stdin/stdout JSON-RPC 的 SDK run channel 发送任务内容，结束后清理该次运行目录。模型输入中的上下文有固定预算：最多 8 条 citations、10 条确定性规则、12 张照片/视觉事实，每条 citation 摘要最多 300 个 Unicode 字符；超出预算的资料仍保存在服务端记录中，但不得在报告正文中引用或暗示。

## 重要边界

照片会先在本地私有保存；上传和生成报告两个 API 都会强制验证用户已明确同意，然后系统通过可替换适配层发送到 DeepSeek 视觉模型，只提取可见事实和不确定项，再由 Harness 生成报告。单张照片被视觉模型拒绝、超时或返回不可解析内容时，该照片会被记录为“未完成自动识别”的待确认项，不虚构画面事实，也不直接终止整份报告。任务处理结束后删除本地原图；进程异常遗留的上传由启动与定时清理任务在 24 小时内删除。报告只保留结构化观察与不可反查的文件标识。所有命理与风水内容仅供传统文化研究和娱乐参考，不构成医疗、法律、财务或人生决策建议。

报告进程为每次请求创建一次性隔离 Harness Home，不加载个人 Harness 配置。配置层关闭 Shell、文件系统、代码运行、工作流、子 Agent、Web 和写入工具；产品插件再以运行时 allowlist、执行 guard 和实际 schema 精确断言三重限制，仅开放产品自有 Skill。专业推理 Agent 使用 `fengshui-reasoning`，每个合拍或冲突点必须同时绑定命盘事实、住宅事实和一条真实存在的已发布资料或规则来源；输出经过严格 JSON、字段一致性和来源白名单校验，一次格式修复仍失败则关闭报告链路。报告与修订 Agent 使用 `fengshui-report`，质量 Agent 独立审核。已发布专家资料由 API 预取、截断并写入 prompt，不作为模型可调用 MCP。模型结果返回 API 前还会进行 fail-closed 校验：必须包含固定章节、逐字文化娱乐提示和完整引用，同时拒绝确定性的医疗、法律、金融或重大人生决定建议。内部版本 ID、内容哈希和事实哈希只保存在结构化报告记录中用于审计，不要求写入用户正文。

当确定性规则已经同时绑定命盘和住宅证据时，API 跳过重复的专业推理调用；只有证据不足时才调用该 Agent。质量审核不通过时最多自动修订 1 次。后台质检失败不会撤回已通过 validator 的首版报告，创建者仍可在用户 API 读取该首版，但 `qualityStatus` 会落为 `failed` 且分享保持关闭。审核中的 `reviewDraft` 仅保存在内部记录，不通过用户 API 或分享页暴露；审核意见由 Agent 生成，审计时间由服务端记录，避免模型生成错误时间污染审核轨迹。

新生成的报告会保存 `generationProvenance`：实际模型提供方和模型名、安全化后的 API host、Harness profile `sdk`，以及 patch、插件、Skill、prompt、输入和报告的 SHA-256，连同校验器版本、校验结果和生成时间。所有字段由服务端依据实际文件与调用内容生成，模型不能自报；不保存 API Key、完整 prompt、本机路径或 URL 用户信息。旧报告仍可读取，但明确视为没有运行环境记录的历史数据。PostgreSQL migration `014_report_archive_lineage.sql` 为报告增加 `archived_at` 与 `source_report_id` 列，并建立主体活跃/归档列表索引。
