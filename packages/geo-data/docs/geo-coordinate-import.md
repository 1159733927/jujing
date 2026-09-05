# GeoNames 坐标生成物

产品地点库由两个来源组成：

- `province-city-china@8.5.8` 提供行政区划树，许可证为 MIT。
- GeoNames `CN.txt` 提供经审核的 WGS84 坐标，许可证为 CC BY 4.0，对外展示时必须保留 `GeoNames` attribution。

当前生成物使用 2026-08-31 dump，从已审核的
`.data/geonames/2026-08-31/crosswalk-v4/candidates.json` 生成。仅导入 `candidates.json`，
不导入 `filtered.json` 或 `conflicts.json`。

```sh
pnpm --filter @fengshui/geo-data build:geonames-artifact
```

默认输出为 `src/generated/geonames-cn-2026-08-31.json`。目标已存在时命令会拒绝覆盖；
只有确认上游 v4 产物与哈希未变、需要确定性重建时才使用：

```sh
pnpm --filter @fengshui/geo-data build:geonames-artifact -- --force
```

生成脚本会验证：行政代码在本地行政树中存在、代码唯一、经纬度合法、
拒绝 `(0, 0)`、manifest 数量与来源元数据一致。records 按行政代码排序，
每条只保留 `code/longitude/latitude/externalId/sourceName/mappingMethod`，来源与哈希只存一次。
`metadata.contentSha256` 是对 `JSON.stringify(records)` 的 SHA-256；它由构建脚本生成，
并在 Node 测试门禁中独立重算，用于发现生成后的记录篡改。该校验属于构建期，
不会在浏览器运行时引入 `node:crypto`。

## 当前覆盖

- 行政区划：3311 个区县级节点。
- GeoNames 已审核坐标：2612 个（78.89%）。
- 原演示坐标 fallback：2 个，每条明确标记 `manual-demo`。
- 最终可选：2614 个；坐标不可用：697 个。

这是 `licensed-partial` 数据集，不是全国坐标完整库，不得对外声称 nationwide complete。
有 GeoNames 记录时它优先于原 demo 坐标；无 GeoNames 且无明确 demo fallback 时，
该地点保持 `unavailable`，不会猜测或填充坐标。中国地点时区统一为 `Asia/Shanghai`。

## 源文件哈希

- `CN.txt`: `64057955b60e80e8ae31ea073b41063e6d7a3cd5ef7f3d278be80dacb3c7127d`
- `admin1CodesASCII.txt`: `590651498043f674accda2b7f46d21286cda0e290b02f8561c5005eee9a5448c`
- `admin2Codes.txt`: `e3844a99e8281d612a0125d292755a54d442a829c9f2b0f66422f9a97207b068`

GeoNames dump: <https://download.geonames.org/export/dump/>
CC BY 4.0: <https://creativecommons.org/licenses/by/4.0/>
