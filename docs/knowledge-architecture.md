# 专家知识与 Harness 架构

## 权责

| 层 | 负责内容 | 是否可由模型直接修改 |
| --- | --- | --- |
| 专家后台 | 资料、案例、标签、审核申请 | 否 |
| 知识库 | 已发布资料的检索和引用 | 否，只读查询 |
| 规则库 | 可执行规则与版本 | 否，必须审核发布 |
| 八字流派规则配置 | 排盘时间默认参数与旺衰/格局/神煞方法版本 | 否，与知识资产分库发布 |
| Harness 插件 | 调用能力并编排报告 | 否 |

## 发布流

`草稿资料 → 专家标注 → 审核 → 不可变发布版本 → 检索索引 → 报告引用`

发布时生成稳定 `versionId`、SHA-256 `contentHash` 和固定 `exactExcerpt`。修订会创建新草稿版本，旧发布版本保持可复现；修订请求必须携带 `expectedRevision`，PostgreSQL 在行锁内原子校验，过期编辑失败且不写入。公开检索只返回当前处于发布状态的精确版本。每条报告保存规则版本、知识条目版本和输入证据标识。

## PDF 书籍导入

专家书籍先作为草稿资产进入知识库，不能自动发布。根目录运行：

```bash
pnpm knowledge:import-pdfs
```

导入器会扫描 `PDF_KNOWLEDGE_DIR` 目录下的 `.pdf` 文件，按标题与段落语义切片，每个切片创建一个 `article` 草稿资产。正文头部固定保存 `importFingerprint`、`sourceFile`、`sourceSha256`、`sourcePages`、`sourceChunk`、`chapter` 和 `contentHash`；`sourceLabel` 保存集合名、页码和原 PDF 哈希前缀。重复运行会按 fingerprint 跳过已导入切片，避免重复入库。

如果要把新导入资料提交给专家审核，可以在 API 包内运行：

```bash
PDF_KNOWLEDGE_DIR=/path/to/books pnpm --filter @fengshui/api knowledge:import-pdfs -- --submit-review
```

`--submit-review` 只会把新建资产推进到 `in-review`，仍不会创建 `knowledge_versions`，也不会被报告检索。只有后台审核发布后，报告链路才会引用这些书籍内容。

八字流派配置使用独立的 `BaziRuleProfile` 版本空间，不参与知识检索。文件演示模式写入 `.data/bazi-rule-profiles.json`；PostgreSQL 模式由 `bazi_rule_profiles` 和 `bazi_rule_profile_versions` 持久化，发布事务使用行锁保证状态转换和版本单调。新命盘显式选择当前有效的发布版本，并把其稳定 ID、版本号和内容哈希写入新的命盘版本；不得回写旧命盘版本。

## 确定性规则

规则资产必须包含经过校验的事实路径、操作符、值、优先级和结构化结论。发布时拒绝仅有自由文本的规则。报告任务在视觉事实产生后由程序执行当前发布规则，全部条件按 AND 匹配；命中结果按优先级排序，并携带不可变规则版本标识与内容哈希。没有命中时返回空结果，不让模型补写规则结论。

视觉观察使用 `vision-observation-v2`。自由文本 `observedElements` 仅用于展示；确定性规则只读受控的 `vision.factCodes`，且只接受置信度不低于 `0.7` 的事实。户型拓扑事实只允许全屋总览图产生；中置信度内容仅进入待确认项，低置信度内容不进入推理上下文。图片上传时绑定匿名主体，创建报告时原子绑定到唯一报告，防止跨用户或跨住宅复用同一媒体。

全屋户型图可以额外提交结构化 `floorPlan` 几何数据：外框、上北证据、房间中心点或多边形、人工覆盖记录。API 会用 `floorplan-nine-grid-v1` 先归一化到 0..1 九宫格，再只产出可复算的 `kitchen.south` 与 `bathroom.near-center` 两类事实；靠近网格线、跨宫面积接近、方向缺失或证据缺失时均 fail closed。`circulation.entry-balcony-aligned` 仍必须来自门窗线几何或人工审核，不由九宫格算法猜测。九宫格结果会持久化到报告记录，并以 `program-nine-grid` 来源追加到视觉事实流，供已发布规则评估。

住宅整体朝向未知时，不再阻塞所有报告判断；它只限制朝向类结论。若命盘、局部户型事实和规则证据足够，报告仍可输出局部合拍或冲突点，同时把整体坐向列入待确认信息。

## Skills

Harness 模型侧只暴露一个产品 Skill：

- `fengshui-report`：根据 API 已经提供的命盘、住宅资料、视觉事实、规则命中和专家引用，生成静态中文文化报告。

出生资料校验、视觉事实抽取、规则执行、知识检索和证据审核都在 API 或独立服务中完成，不作为模型可调用 Skill 暴露。`fengshui-report` 不重新排盘、不访问文件、不搜索网页、不调用 MCP，也不扩展 API 提供之外的资料。

## MCP

- `knowledge-mcp`：已实现的只读 stdio 服务，只检索当前已发布的不可变版本，并返回来源、稳定版本标识、内容哈希和固定摘录。

`knowledge-mcp` 保留为独立只读服务边界，用于后续外部客户端或受控集成，但当前报告链路不把它暴露给模型。Harness 通过根目录的 `harness.fengshui.patch.yml` 只加载产品 Skill；知识检索由 API 在进入 Harness 前完成，并把实际采用的引用持久化到报告记录。专家后台只通过受保护的业务 API 写入资料；生产环境以 PostgreSQL 中的 `knowledge_assets` 与不可变 `knowledge_versions` 为事实源。知识 MCP 不直连数据库，而是携带内部 `KNOWLEDGE_MCP_TOKEN` 调用 API 的只读 `/v1/knowledge/search`，只获得当前已发布版本，因此模型无法发布、篡改或读取草稿。只有显式选择 `STORAGE_DRIVER=file` 的本地演示模式才会读取 `.data/knowledge.json`。

API 启动 Harness 时不向模型侧传递 `DATABASE_URL`、管理员 token、DeepSeek key 或知识 MCP 凭证。数据库迁移、资料权限、发布状态和检索失败都由业务服务管理；报告任务已经入队时，检索失败会把同一任务更新为可追踪的 failed 状态。

报告生成不复用个人 `~/.dsh` 配置。API 为每份报告创建独立 `DSH_HOME`，使用官方 `sdk` profile 通过 stdin/stdout JSON-RPC 与 Harness 通信，避免把完整 prompt 放进命令行参数或系统进程列表。该 Profile 的模型工具白名单仅保留产品 Skill，关闭通用代码 Agent 的 Shell、文件系统、代码运行、Web、工作流及子 Agent 能力；同时禁用 Harness 遥测和会话日志扩展。

API 在构造 prompt 前执行上下文预算，当前上限为：专家引用最多 8 条，规则命中最多 10 条，照片/视觉事实最多 12 条，单条引用摘录最多 300 个 Unicode 字符。超过预算的资料保留在结构化报告记录中用于审计和复算，但不会进入本次模型上下文。生成文本在持久化或返回前必须通过 API 侧合规校验，章节、文化娱乐提示和已使用资料的标题、“第几版”版本号、来源标签任一缺失都会使任务失败；确定性规则命中同样必须写出标题、“第几版”版本号和原样结论文字。知识、规则和专业评估的内部版本 ID、内容哈希与事实哈希仍保存在结构化报告记录中用于审计，不强制暴露在面向用户的正文里。

报告生成采用“生成者—审核者—修订者”流水线：Harness 先生成初稿；初稿通过服务端 validator 后先进入 `completed`，创建者可立即读取。独立质量审核 Agent 只输出结构化审查结果，质量增强进度由 `qualityStatus: pending | running | failed | passed` 表示；需要修订时，修订 Agent 按问题清单重写，最多自动修订 1 次。审核通过后 `qualityStatus` 更新为 `passed`，报告才允许分享；审核失败、超时、报错或坏格式会保留首版报告并把 `qualityStatus` 更新为 `failed`，分享保持关闭。审核草稿和审查轨迹仅内部可见。审核重点检查人宅合拍结论、命盘与住宅事实、已发布交叉规则、证据可追溯性，以及代码或无依据断言。审查意见与评分来自审核 Agent，但持久化的 `reviewedAt` 由服务端在接收审查结果时覆盖生成，模型不能决定审计时间。

每次真实 Harness 调用还会生成服务端 provenance：模型配置来自实际隔离 profile，patch、插件和 Skill 从运行时文件计算 hash，prompt hash 对应实际发送内容，输入和报告使用稳定 canonical hash；校验成功、校验失败与 runner/tool 失败分别记录 `pass`、`fail`、`not-run`。公开 API 只返回白名单字段和安全 host 标签，不返回 Key、完整 prompt、本机路径或 URL userinfo/query。
