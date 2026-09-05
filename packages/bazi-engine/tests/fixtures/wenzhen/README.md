# 问真人工对照样例

这里仅保存经过人工核对的外部排盘结果。禁止把本引擎输出复制为 `expected` 后标记成问真结果。

录入步骤：

1. 在问真网页手工输入与 `birth` 完全相同的资料和参数。
2. 记录采集日期、问真页面显示的四柱以及可见的校正时间。
3. 保存一份脱敏截图证据；仓库只记录相对证据编号，不保存姓名等个人信息。
   `verified` 和 `accepted-difference` 样例的 `evidenceRef` 必须出现在
   `evidence-manifest.json` 中，并且其中的 SHA-256、MIME、大小和采集时间必须一致。
4. 调用 `POST /v1/bazi/compare` 或增加离线 fixture 测试生成差异。
5. 差异进入人工复核，不得为了单条样例静默修改通用规则。

接受差异时，每条差异都必须记录分类和非空理由。允许的分类为：依赖差异 `dependency`、流派规则
`school-rule`、时区/地点 `timezone-location`、显示/舍入 `display-rounding`。`bug` 表示产品缺陷，必须修复，
不能被标记成 `accepted-difference`。旧 fixture 缺少分类时仍可读取，任何新接受操作都必须补齐分类。

批量差异报告（输出目录必须是一个尚不存在的新目录）：

```sh
pnpm --filter @fengshui/bazi-engine verify:wenzhen -- \
  --fixtures packages/bazi-engine/tests/fixtures/wenzhen \
  --output output/wenzhen-diffs/run-001 \
  --evidence-root .data/evidence/wenzhen
```

`--evidence-root` 省略时默认使用 `.data/evidence/wenzhen`。命令会严格校验目录下所有 fixture 候选、
`evidence-manifest.json` 和每张私有截图本体，核对文件存在性、大小、SHA-256 与 MIME 文件签名，
再生成 `wenzhen-difference-report-v2` 的 `manifest.json` 和每个样例的差异 JSON。
已存在的输出目录会直接拒绝，以防止覆盖审计证据。只有 `status` 为 `verified` 或
`accepted-difference` 的样例会进入报告；`pending-manual-verification` 只统计，绝不计为通过。
证据 manifest 中缺失引用、hash 与 `evidenceRef` 不一致、重复证据、孤儿证据，或截图本体缺失/被替换，都会让命令失败。

报告中的 `passed` 只表示该样例当前已经填写到 `expected` 的字段全部通过，并不表示问真页面其余未录入字段也已验证。
每份报告和总 manifest 都会从实际 `expected` 结构推导 `assertionCoverage`，分别统计四柱、时间校正、专业表格、
大运和动态流盘；fixture 不能自行声明覆盖范围。当前 6 条真实样例的覆盖计数为：四柱 6、时间校正 5、
专业表格 5、大运 1、动态流盘 1。

`expected` 可逐步填写问真页面可见字段：

- `pillars`
- `correctedLocalTime`
- `correctionMinutes`
- `timeProfile`
- `pillarDetails`
- `luckCycles`
- `annualCycles`
- `monthlyCycles`
- `dailyCycles`
- `hourlyCycles`

动态流盘字段必须和出生盘分开采集。只要 `expected` 中出现 `annualCycles`、`monthlyCycles`、
`dailyCycles` 或 `hourlyCycles`，fixture 必须同时填写 `flowQuery`：

```json
{
  "flowQuery": { "targetDate": "2026-09-01", "targetTime": "15:30" }
}
```

校验时会用同一份 `birth` 重新计算目标时刻的流盘。动态数组不会默认比较 `[0]`；
`annualCycles` 按 `year` 查找，`monthlyCycles` 按 `year` + `month` 查找，`dailyCycles`
按 `date` 查找，`hourlyCycles` 优先按 `dateTime`，否则按 `startHour` 查找。未填写这些稳定键时，
会默认比较 `flowQuery` 选中的当前年、月、日、时辰。
`monthlyCycles` 可填写问真可见的 `pillar`，也可补充本引擎返回的 `startTerm`、`endTerm`、`startAt`、`endAt`
用于审计；其中 `startAt`/`endAt` 表示 `corrected-local-solar-term-wall-v2` 的分钟精度本地墙钟时间（秒固定为 `00`），不追加 `Z`，也不表示 UTC instant。

无 Chrome 条件下采集动态流盘时，按这个人工流程执行：

1. 在本后台选择或录入同一份出生档案：出生日期、时间、性别、历法、出生地点、真太阳时、子初换日和起运流派必须与问真页面一致。
2. 在本后台填写流盘目标日期；需要核对流时时再填写流盘目标时间。没有目标日期时不得采集 `annualCycles`、`monthlyCycles`、`dailyCycles` 或 `hourlyCycles`。
3. 打开问真网页，切到同一出生档案的流盘页面，设置相同目标日期和时间，人工记录问真显示的流年、流月、流日、流时干支。
4. 截取能证明目标日期/时间、当前页签和四类流盘结果的图片。截图必须裁剪掉姓名、手机号、头像等个人信息；不要只截单个干支，证据需要能回看上下文。
5. 在 Admin 问真对照页插入动态流盘摘录模板。模板的流年 `year`、流月 `monthYear` + `month`、流日 `date`、流时 `dateTime`/`startHour` 都来自服务端按出生地点、时区、真太阳时与换日规则计算出的 `flow.selection`。午夜附近或立春前后可能不同于页面输入的原始日期/时间，不要手工改这些 stable key。
6. 只把问真页面真实显示的干支填入模板，再上传脱敏截图证据。
7. 先点击比较，确认差异路径、分类和理由；只有截图、`flowQuery` 与四类 stable key 都齐全后，才保存为 `verified` 或进入人工接受差异流程。

动态流盘的 stable key 必须来自目标时间轴，而不是数组位置：

- `annualCycles`: 使用 `year`。
- `monthlyCycles`: 使用 `year` + `month`。
- `dailyCycles`: 使用 `date`，格式为 `YYYY-MM-DD`。
- `hourlyCycles`: 优先使用 `dateTime`，格式为 `YYYY-MM-DD HH:mm`（日期与时间之间为空格）；没有 `dateTime` 时才使用 `startHour`。

空白模板、占位字、未填写 `pillar` 的动态项不能发布，也不能保存为已验证样例。模板只是录入辅助，不是问真结果；发布前必须有人工摘录值和对应截图证据。

当前真实样例基线为 6 条，均有脱敏 `evidence-manifest.json` 记录：

- `wz-020-professional-table`：普通专业表格，四柱 `壬申/戊申/己巳/庚午`，并断言可见专业字段和首批大运字段。
- `wz-021-lichun-boundary-before`：立春边界前，四柱 `癸卯/乙丑/戊戌/庚申`。
- `wz-022-late-zi-day-boundary`：23 点子初换日，四柱 `己卯/丙子/己未/甲子`。
- `wz-023-urumqi-dst-ignore`：乌鲁木齐西部经度与 `dstPolicy: ignore`，四柱 `庚午/壬午/丁巳/乙巳`。
- `wz-024-lunar-leap-fourth-month`：农历闰四月，四柱 `庚子/辛巳/丙寅/壬辰`。
- `wz-025-dynamic-year-month-public`：问真公开 H5 流盘中的 2026 `丙午` 流年与立秋月 `丙申`；流日、流时因会员权限未断言。

这 6 条样例的已断言字段通过自动差异校验。真太阳时仍有问真显示分钟与当前 NOAA 近似算法相差 1 分钟的样例；当前只记录差异，不用样例常量硬编码追平。截图本体保存在本地私有证据目录，仓库 manifest 只保存 hash、MIME、大小、采集时间和截图尺寸。部署或多人验收时，证据目录必须挂载为持久共享卷，否则 fixture 中的 `evidenceRef` 无法追溯到原始截图。

`capture-matrix.json` 现有 31 条：6 条 `verified` 与 25 条 `pending-capture`；`wz-025` 是从 `wz-048` 拆出的公开流年/月部分证据，不替代完整五层场景。Stage 1 的完成标准仍是把
待采集项逐条替换为真实问真截图与人工摘录结果，而不是把“矩阵已规划”算作“30 条已验证”。
后续继续覆盖其他节气交界、更多 23:00–00:59、农历闰月、历史夏令时、新疆远西经度和海外 IANA 时区。
