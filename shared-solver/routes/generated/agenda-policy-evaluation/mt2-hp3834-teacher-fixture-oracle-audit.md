# MT2 HP3834 teacher-fixture oracle audit

本摘要对应同目录的 [原始 JSON audit](mt2-hp3834-teacher-fixture-oracle-audit.json)。

## 结论

fixture `mt1-mt3-i893-hp8425.route.json` 的当前 strict replay **未通过**：在第 12 步 `changeFloor@MT1:6,0` 出现 `post-exact-state-mismatch`。因此该 fixture 不能作为当前基线的严格路线证据。

它仍可作为非严格 oracle trace：使用当前 primitive simulator 按 fixture decisions 做 summary replay，33/33 decisions 均可执行并到达 MT3/I893。这个 replay 只用于寻找 witness；fixture decisions 没有注入 production search。

## Replay results

| Check | Result |
| --- | --- |
| Strict replay | `performed=true`, `valid=false` |
| Strict failure | step `12`, `post-exact-state-mismatch` |
| Summary replay | `33/33` decisions applied |
| Summary final | MT3, HP8425 / ATK107 / DEF100 / MDEF510 / EXP31, I893 equipped |
| Production-search fixture injection | `false` |

strict replay 的 expected/actual exact state key 已保留在原始 JSON，供后续修复旧 fixture snapshot 语义时审计；本轮不把 summary replay 当作 strict replay 通过。

## Earliest continuation-compatible witness

summary replay 中最早满足当前 `mt2-hp3834` goal 的状态出现在 decision 23 之后：

```text
HP 3834 / ATK 72 / DEF 35 / MDEF 290 / EXP 1
```

此时七个 hard tiles 全部 present：

```text
MT2:4,7  MT2:8,7  MT2:10,8  MT2:11,11
MT2:6,6  MT2:6,8  MT2:6,9
```

fixture 的下一步是：

```text
battle:bluePriest@MT2:2,8
```

## Production action-provider witness audit

以该 fixture-derived witness 作为 oracle-only 起点，调用当前 `mt2-hp3834` production action provider，并让 DP 只展开根节点一次；没有把 fixture decisions 作为搜索动作输入。

| Observation | Result |
| --- | --- |
| Provider action count | `2` |
| Provider supplies next fixture action | `true` |
| Matching successor generated | `true` |
| Matching successor inserted into skyline | `true` |
| Matching action dominance-rejected | `false` |
| Matching action skyline-evicted | `false` |
| Matching successor agenda-expanded | `false` |
| Root agenda pops | `1` |

`agenda-expanded=false` 只说明这次 observer run 的 `maxExpansions=1` 没有继续弹出 successor，不能解释为生产 agenda 永远不会展开它。当前证据表明，在这个 witness 状态上，action provider 提供了下一步，successor 生成并进入 skyline；没有观察到 dominance 或 skyline 驱逐。

## Decision

当前 production bounded search 的 B 类结论仍成立：联合达到 ATK/DEF/MDEF 的状态最高 HP 只有 2828。teacher fixture 提供了一个更高质量的 oracle witness，但由于 strict replay 失效，本轮只保留为非严格 oracle 证据。后续若继续，需要先修复或重新生成该 fixture 的 exact snapshot，再做更深入的 dominance/skyline 分叉审计。
