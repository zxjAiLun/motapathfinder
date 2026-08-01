# PR-4.4k：局部容量隔离矩阵

状态：**completed**；矩阵分类：**raw-goal-archive-capacity-sufficient**。

10/8 retains the winner local while 8/10 does not; raw goal-archive capacity is sufficient in this bounded test.

本轮从自然 MT1 candidate-2 gate 开始，只执行 `mt2-entry → mt2-local-3582`；没有注入 winner/teacher entry 或 local，也没有执行 HP3834 continuation worker。

## 四组结果

| 配置 | winner entry merged | winner local merged | local attempt | 搜索完成度 |
| --- | --- | --- | --- | --- |
| 8x8 | true (retained) | false (production-successor) | true | inconclusive |
| 10x8 | true (retained) | true (retained) | true | inconclusive |
| 8x10 | true (retained) | false (production-successor) | true | inconclusive |
| 10x10 | true (retained) | true (retained) | true | inconclusive |

`entry/local` 的 JSON 记录了 generated、goalAccepted、activeAtFinish、rawArchiveSelected、rawSortRank、selectedArchiveRank、segmentRetained、mergedRetained、attemptExecuted 与 firstAbsentStage。

## 边界

- productionSemanticChange: **false**
- globalDefaultChangeRecommended: **not-established**
- HP3834 continuation workers: **false**
- natural candidate-2 start: **true**
- no teacher injection: **true**

这轮最多证明已知 winner lineage 在某个局部容量配置下是否保留；不能直接推出全局必要条件或修改默认容量。

## Provenance

- solver commit: d2b65ecd8ffe34876de3466daa50a611eba829a6
- source j2 report: shared-solver\routes\generated\agenda-policy-evaluation\mt2-candidate2-capacity10-j2.json
- source j2 SHA-256: e85a0bf55d957dea9d5cbcf301b421c48630f8c9a9746aadece798c77e5f7e2f
- commit stable during run: **true**
