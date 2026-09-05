# Stage 1 Dependency Decisions
Captured on 2026-08-31. Re-check before production release.

## Summary

| Capability | Decision | Package | Version checked | License | Weekly downloads checked | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Calendar and BaZi baseline | Keep | `lunar-typescript` | 1.8.6 | MIT | 66,388 | Already integrated; broad Chinese calendar and BaZi coverage. |
| Calendar and BaZi future evaluation | Defer | `tyme4ts` | 1.5.2 | MIT | 14,698 | Newer package; evaluate only after WenZhen fixtures exist. |
| China administrative hierarchy | Candidate | `province-city-china` | 8.5.8 | MIT | 1,460 | Provides hierarchy JSON/CSV/SQL, not coordinates. |
| Coordinate-to-timezone utility | Prefer first | `@photostructure/tz-lookup` | 11.6.1 | CC0-1.0 | 273,755 | Small package; good fit when approximate timezone lookup is enough. |
| Coordinate-to-timezone fallback | Server fallback | `geo-tz` | 8.1.8 | MIT | 373,649 | More precise polygon lookup but large unpacked size. |
| Server PDF/image render | Optional | `playwright` | 1.62.1 | Apache-2.0 | 87,469,377 | Reliable, heavy; use only if browser export is not enough. |

## Adopt Now

- Keep `lunar-typescript` in `@fengshui/bazi-engine`.
- Keep local browser PDF/image export for the demo.
- Keep `@fengshui/geo-data` as a versioned adapter and label the current data as demo-only.

## Adopt Later

- Add `province-city-china` only when the UI/API needs complete administrative hierarchy. Do not treat it as a coordinate source.
- Add `@photostructure/tz-lookup` if birthplace coordinates can be selected manually or supplied by a licensed dataset and we need timezone derivation.
- Add `playwright` only for server-rendered PDF/image exports.

## Do Not Do

- Do not scrape WenZhen as a data source.
- Do not import coordinates whose license and redistribution rights are unclear.
- Do not migrate from `lunar-typescript` to `tyme4ts` before a WenZhen comparison corpus exists.
- Do not claim full China district coverage while `BIRTHPLACE_DATASET_METADATA.coverage` is `demo-sample`.

## Source Notes

- `lunar-typescript`: npm metadata showed version 1.8.6, MIT license, modified 2025-11-05, unpacked size about 1.36 MB; npm downloads API showed 66,388 downloads for 2026-08-23 to 2026-08-29.
- `tyme4ts`: npm metadata showed version 1.5.2, MIT license, modified 2026-06-12, unpacked size about 1.02 MB; downloads API showed 14,698 downloads for 2026-08-23 to 2026-08-29.
- `province-city-china`: npm metadata showed version 8.5.8, MIT license, modified 2024-09-05, unpacked size about 25.09 MB; downloads API showed 1,460 downloads for 2026-08-23 to 2026-08-29.
- `geo-tz`: npm metadata showed version 8.1.8, MIT license, modified 2026-07-12, unpacked size about 73.45 MB; downloads API showed 373,649 downloads for 2026-08-23 to 2026-08-29.
- `@photostructure/tz-lookup`: npm metadata showed version 11.6.1, CC0-1.0 license, modified 2026-08-08, unpacked size about 88 KB; downloads API showed 273,755 downloads for 2026-08-23 to 2026-08-29.
- `playwright`: npm metadata showed version 1.62.1, Apache-2.0 license, modified 2026-08-31, unpacked package size about 5.07 MB before browser binaries; downloads API showed 87,469,377 downloads for 2026-08-23 to 2026-08-29.
