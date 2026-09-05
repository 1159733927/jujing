# 全国行政区坐标离线导入

`@fengshui/geo-data` 的坐标导入器只读本地文件，不会联网下载、地理编码或填补坐标。输入来源的授权、版本和归属文本由使用者审核；导入器负责将这些证据和输入文件 SHA-256 写入产物，不代替法务审查。

## 支持的输入

- GeoNames 原始 19 列 TSV **不能直接交给通用 importer**。必须先经过下文的 GeoNames 专用 crosswalk；它只读取官方无表头的标准 19 列格式，不把 GeoNames admin code 直接声明为 GB/T 2260。
- JSON 数组，或包含 `records` / `geonames` 数组的对象。字段可用 `administrativeCode` / `adminCode` / `gb2260` / `adcode`、`name`、`longitude` / `lng`、`latitude` / `lat`、`provinceName`、`cityName`、`alternateNames`、`geonameId`。
- 项目 CSV，建议表头：

```csv
administrativeCode,name,provinceName,cityName,longitude,latitude,externalId
330106,西湖区,浙江省,杭州市,120.1302,30.2595,source-row-1
```

经纬度必须是 WGS84；导入器不做 GCJ-02 / BD-09 转换。缺失、非数字或超出范围的坐标会进入 `rejected.json`。

## GeoNames 预处理

预处理需要同一批次的三个 GeoNames dump 文件：

- `CN.txt`（或从 `allCountries.txt` 原样筛出的 `countryCode=CN` 记录）；
- `admin1CodesASCII.txt`；
- `admin2Codes.txt`。

下载格式以 [GeoNames dump readme](https://download.geonames.org/export/dump/readme.txt) 和 [GeoNames export 页面](https://www.geonames.org/export/) 为准。GeoNames 数据按 CC BY 4.0 使用；每次输入必须记录 dump 日期，预处理器会分别计算上述三个文件的 SHA-256，并在 `manifest.json` 与候选记录审计信息中保留来源 URL、许可证和 `GeoNames` attribution。不要只用“最新”作为版本。

```bash
pnpm --filter @fengshui/geo-data preprocess:geonames -- \
  --cn /absolute/path/CN.txt \
  --admin1 /absolute/path/admin1CodesASCII.txt \
  --admin2 /absolute/path/admin2Codes.txt \
  --dump-date 2026-08-30 \
  --output /absolute/path/output/geonames-crosswalk-2026-08-30
```

crosswalk 只从 `countryCode=CN`、`featureClass=A`、`featureCode=ADM3` 产生区县坐标候选。ADM1/ADM2 行只作为父级验证证据；ADM4 行保留在 `filtered.json` 供审阅，但不参与映射或重复坐标判定，避免更细层级的同名记录抹掉有效 ADM3 候选。GeoNames 的 `admin2Code` / `admin3Code` / `admin4Code` 可能是 GeoNames 自身层级 ID（例如七到八位数字），**不是** GB/T 2260；不能因字段名含 `admin` 就当作中国行政代码。

匹配有三条保守路径：如果 admin2/admin3/admin4 中确有六位值，仍须验证代码存在于固定版本的 `province-city-china` 本地树、地区名称精确一致且父级一致；对于常见的 ADM3 非六位 ID，四位 `admin2Code` 可在 `admin2Codes.txt` 与本地树中唯一锁定城市。直辖市等非四位 admin2 则不能硬编码 ID：crosswalk 使用 admin1/admin2 映射条目的 `geonameId` 找到同一 `CN.txt` 中对应的 ADM1/ADM2 行，再用这些行的中文名称/别名唯一匹配本地省和城市。以上路径最后都只在已验证城市范围内匹配区县。

省直管县级 ADM3 使用单独路径：必须先通过 admin1 映射的 `geonameId` 和 CN.txt ADM1 中文名唯一确认省份，然后只在该省本地名称含“省直辖县级行政区划”或“自治区直辖县级行政区划”的容器内，用 ADM3 中文名/别名唯一匹配。空 admin2 不会放宽范围；non-four admin2 的 ADM2 行若存在且与区县同名，可作为额外父级佐证。该路径绝不搜索其他省份或普通地级市，审计方法为 `verified-province-direct-and-name`。

城市或地区名不唯一、代码/名称矛盾、错误 admin1/admin2、父级不一致和同代码多坐标都会写入报告，不产生候选坐标。香港、澳门与内地行政层级的合并方式暂不自动假设，相关记录必须人工审核。预处理器不会补 `0,0`、邻区坐标或无父级约束的名称猜测。

预处理产物：

| 文件 | 内容 |
| --- | --- |
| `candidates.json` | 通用 importer 可读取的候选，含 `administrativeCode,name,provinceName,cityName,longitude,latitude,externalId` 与 GeoNames ID、原始 display name、原行号和映射方法审计 |
| `manifest.json` | dump 日期、三个输入文件 SHA-256、许可证/attribution 和数量摘要 |
| `filtered.json` | 非 CN、非行政 feature class、非支持层级，以及只作父级证据的 ADM2（`parent-reference-row`）和禁止导入的 ADM4（`adm4-not-imported`） |
| `rejected.json` | 非 19 列、缺 ID/名称、坐标非法或 `0,0` 哨兵值 |
| `conflicts.json` | 无可靠代码、重名、代码/名称/父级矛盾、同代码坐标分歧 |
| `duplicates.json` | 同一行政代码和同一坐标的非阻塞重复行，逐条保留被忽略行与保留行的 source row、GeoNames ID 和原始名称 |

这是预处理和人工审阅门禁，不是最终自动导入。确认 `filtered/rejected/conflicts` 后，才把 `candidates.json` 交给通用 importer：

```bash
pnpm --filter @fengshui/geo-data import:coordinates -- \
  --input /absolute/path/output/geonames-crosswalk-2026-08-30/candidates.json \
  --format json \
  --output /absolute/path/output/geonames-2026-08 \
  --dataset-version 2026.08.1 \
  --source-id geonames-cn \
  --source-label "GeoNames China export" \
  --source-version 2026-08-30 \
  --source-url https://download.geonames.org/export/dump/ \
  --license "CC BY 4.0" \
  --license-url https://creativecommons.org/licenses/by/4.0/ \
  --attribution "GeoNames"
```

GeoNames 预处理器要求输出目录尚不存在：所有 JSON 先完整写入同级临时目录，再通过一次原子 rename 发布；目标已存在或任一文件失败时不会留下旧/新混合报告。crosswalk 的 `--strict` 会在写完报告后对任何 filtered/rejected/conflict 返回退出码 2；通用 importer 的 `--strict` 会对 conflict/unmatched/rejected 返回退出码 2。完全相同坐标的重复行属于非阻塞审计，计入 `duplicateCount`，不会单独令 strict 失败。

## 匹配规则

以下规则只适用于 crosswalk 审阅通过后的通用 importer：

1. 输入有六位行政代码时，只用代码匹配。代码不存在时记为冲突，不降级到名称匹配。
2. 没有可用代码时，使用地区名与可选的省/市上下文精确匹配。
3. 名称命中多个候选时写入 `conflicts.json`；没有候选时写入 `unmatched.json`。
4. 同一行政代码命中多个不同坐标时，所有相关行写入冲突报告，并且不输出该行政区坐标。完全相同的重复坐标只保留最早的源记录。

## 产物和证据

| 文件 | 内容 |
| --- | --- |
| `coordinates.json` | 按行政代码排序的版本化 WGS84 坐标记录，含许可证据、原始行号和外部 ID |
| `manifest.json` | schema/dataset 版本、来源元数据、输入 SHA-256 和数量摘要 |
| `matches.json` | 每条成功命中的匹配方法 |
| `conflicts.json` | 代码矛盾、重名歧义和坐标分歧 |
| `unmatched.json` | 无候选的名称记录 |
| `rejected.json` | 缺名称或坐标非法的记录 |

导入后应先审阅所有报告，再由另一个明确步骤将 `coordinates.json` 接入出生地数据集。本导入命令本身不会改写生产数据。

## 验证

```bash
pnpm --filter @fengshui/geo-data typecheck
pnpm --filter @fengshui/geo-data test
```
