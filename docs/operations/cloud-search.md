# cloud1 后台求解与进度台

> **2026-09-20 核验更正**：下文的6h总时间、三档预算、首次包内容及“不commit/push”属于2026-09-19部署快照，不是当前运行配置。19:14上海时间只读核验时，总时间上限已为0，已新增256k档并迁移重启；前7次新档任务均heap-limit，仍无TS14候选。最新状态、停止原因及证据见[长跑诊断](../260920/neko-cloud-baseline-diagnosis.md)与[当前handoff](../../20260804handoff.md)。本次诊断没有执行云端启停或覆盖；仍禁止热覆盖release。

## 看进度

在本机打开 **http://127.0.0.1:8787/**。2026-09-19 部署时已建立本机 SSH 隧道并验证。

重启电脑或隧道断开后，在一个终端执行并保持该命令运行：

```sh
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:8787:127.0.0.1:8787 cloud1
```

UI 每3秒读取状态，显示局部任务、展开数、frontier、内存、候选及停止原因。浏览器关闭不会停止服务器搜索。远端UI仅监听loopback，无公网端口、密码、启动/停止/命令执行接口。SSH隧道也只绑定本机loopback；从其它设备访问需要在该设备建立自己的SSH隧道。

## 当前运行

- 发布目录：`/home/ubuntu/motapath-solver/releases/20260919-3980c823`
- 运行目录：`/home/ubuntu/motapath-solver/runs/neko-zero-key`
- Node：`/home/ubuntu/.local/share/motapath-solver/node/bin/node`，v22.23.2 / ARM64。
- 服务：`motapath-search-neko.service`（求解）、`motapath-progress.service`（UI），均是 ubuntu 用户服务。
- 用户 `Linger=yes`：注销SSH不影响服务，重启机器后可启动已启用服务。
- 一次只跑一个局部DP；worker堆6144 MiB，RSS8192 MiB，整个搜索进程组MemoryMax=9GiB，UI上限256MiB；Nice=10 / CPUQuota=150%。
- 首轮总累计墙钟6小时；每局部任务预算档位 8000/120s、32000/600s、128000/1800s。每任务保留最多16个goal skyline候选。先尝试低档及更深阶段，再回到其它候选/预算档。
- 找到严格重放通过的五层路线即停止并生成 `verified.route.json`；没有路线则预算到点停止。**不承诺有解，不宣称全局最优。**

## 状态与操作

```sh
ssh cloud1 'systemctl --user status motapath-search-neko.service motapath-progress.service --no-pager'
ssh cloud1 'journalctl --user -u motapath-search-neko.service -n 40 --no-pager'
```

应用诊断：运行目录里的 `status.json`（小型UI状态）、`journal.json`（任务账本）、`worker.log`、`states/`（候选）、`tasks/`（任务输入）。这不是完整DP frontier快照。

有序暂停（只停止本应用求解服务，UI保持可读）：

```sh
ssh cloud1 'systemctl --user stop motapath-search-neko.service'
```

应用写入 `STOP`，正在运行的局部任务在下一个取消检查点结束；systemd最多等待150秒然后清理本服务进程组。恢复同一配置：

```sh
ssh cloud1 'rm -f ~/motapath-solver/runs/neko-zero-key/STOP && systemctl --user start motapath-search-neko.service'
```

- 已完成局部结果保留；被中断的局部DP从其起始checkpoint重跑，不重跑全部前缀，也不称完整frontier续跑。
- 运行身份绑定代码、塔脚本和profile。变更任何这些输入应新建run-dir，不覆盖正在运行的release。
- 总预算累计6小时，暂停重启不会重置。预算扩容/改策略需显式新轮，不靠反复重启绕过限额。
- worker错误自动停止并展示error；不会无限自动重试或隐藏红灯。UI独立运行，所以搜索失败仍能查看。

## 输入与证据边界

Profile：`shared-solver/profiles/neko-zero-key.json`。这是指定的试炼初态而不是完整游戏存档：TS11(6,1)，HP100/ATK1/DEF0/LV1/EXP0，greenKey30，flag:saltygreen2。未从Start执行自动拾取。JC19外部总积分设显式零基线，already-visited教程标志避免重复首访；不冒充用户尚未提供的全游戏积分。

受保护钥匙的door requirements在动作生成和执行处拒绝，动作前后净减少也拒绝；TS11～TS15事件审计仅找到Boss结算文字引用greenKey，没有消费事件。该有限场景消费约束与终端重放共同构成零绿钥匙证据；泛化到“同一事件先消费再补回”的其它塔需更细粒度资源账本。

Boss战后HP由`allhp`结算增量/10派生，不把恢复后的外部角色HP误认为试炼剩余HP。局部候选不得当成五层通关；下列证据只是前缀：

- 云端第一段smoke：正确初态、绿钥匙30→34、TS12 HP985 / ATK4、12决策，strict replay PASS。
- 长跑前两段的独立重放：TS13 HP1369 / ATK6 / DEF0 / LV2 / EXP17，28决策，绿钥匙34；`/home/ubuntu/motapath-solver/evidence/ts13-prefix.route.json`。
- `ts13-prefix.route.json` SHA256：`14baab77e9d9af6784eae330fd0a44ef3588a8c3da25e893fa43590ae292b487`。

## 发布和回滚

本轮无commit/push；使用当前工作区选定源文件快照。包仅含solver及塔project JS，不含存档、凭据或资源图片。包内`bundle-manifest.json`校验1237个文件，压缩包SHA256：

`3980c82309a27250f6aacdf30cca34b3cd8a38804dcb55bffa1f4d5171929df6`

Node官方HTTPS下载并对照SHASUMS256核验（SHA256 `fff4078c5def658577f92c88db7db3bc0072924bfb93fe52c1e744a54e94abb8`）。没有apt升级、没有改防火墙或其它服务。

仅停用本应用：

```sh
ssh cloud1 'systemctl --user disable --now motapath-search-neko.service motapath-progress.service'
```

不要删除`runs/`来清理状态；先保留账本/候选/结果用于复核。Node和release均独立用户目录，可在确认不再需要后另行清理。

## 验证命令

```sh
node shared-solver/check-durable-search.js
node tools/audit-js-files.js --check-manifest
node tools/audit-js-files.js --check-no-tower-solver-js
node tools/check-agent-boundaries.js --allow-public-layer-dev=1
```

本地及云端focused check均PASS。真实云端UI经本机隧道的Chrome桌面/390px移动视口截图检查通过，无pageerror及横向溢出。截图：`shared-solver/routes/generated/cloud-search/progress-{desktop,mobile}.png`（ignored）。

## Probe / release 隔离约定（PR-5.31g）

实验/probe **禁止写入或覆盖生产 release 目录**。已实测到 `20260920-5-29a-56f6c7d` release 里的 `dp-search.js` 被换成未提交实验代码——目录名不能证明执行内容。约定：

- probe 使用独立目录/独立 bundle（如 `probes/<id>/`），不 `cp` 覆盖 `releases/<prod>/`；生产 release 视为只读快照。
- 每次 durable 运行的 journal 与 `status.json` 现记录 `executionProvenance`：`solverDigest`（solver 代码树 sha256）、`problemFingerprint`、`resumeSearchFingerprint`、`executionIdentity`、`searchSemantics`（dpPriorityMode/dpAgendaMode/fairnessEvery/fairOrderMode/maxActionsPerState/continuationSlice）。reviewer 以此追溯实际执行，不靠 `release_id` 猜。
- `resumeSearchFingerprint` 现覆盖所有有效搜索选项。改任一语义选项 → resume 被 `SEARCH_SEMANTICS_DRIFT` 拒绝，不静默沿用旧 frontier；改诊断/输出项不影响身份。回归门：`npm run check:search-semantics-identity --prefix shared-solver`。
- 校验实际执行身份（只读）：`node -e "const d=require('./shared-solver/lib/durable-search');console.log(d.executionProvenance(require('./<config>'),'<tower-root>'))"`，与 journal 内 `executionProvenance` 比对。

里程碑：[Cloud search + progress UI](../260919/cloud-search-progress.md)、[PR-5.31g](../260922/5-31g.md)。
