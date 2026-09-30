# server1 隔离部署（PR-5.33b）

关联：[里程碑](../260930/5-33b.md)、[当前交接](../../20260804handoff.md)。

## 状态与前置门

实现 `eec63b85a90690bd2093112f0c2755c4ddf22e3f` 已发布到 Git，但[完整 qualification 36713333562](https://github.com/zxjAiLun/motapathfinder/actions/runs/36713333562)失败（24成功/17失败/1汇总跳过）。**server1 尚未上传发布包或启动搜索，部署门保持关闭。** 必须先取得冻结代码提交的完整资格通过；fast-only 或 skipped 不算通过。下方为已授权边界，不是已执行记录。

**cloud1 已有其他业务，禁止连接、读取、修改或部署。** 本说明取代旧 cloud1 运维命令在本轮的使用。

## 隔离与资源

- 仅使用 server1 的 ubuntu 用户、现有 `/usr/bin/node`；不安装/升级全局包，不改防火墙、容器、其他应用或占用端口。
- 使用独立 `~/motapath-solver-pr533b/`，不可变 `releases/<commit>/`、新 `runs/<id>/` 和独立命名的用户服务；不覆盖任何旧 release/journal。
- 搜索 cgroup `MemoryMax=512M`、`MemorySwapMax=0`、`CPUQuota=50%`、`Restart=no`；worker `heapMb=256`、`maxRssMb=384`。先验证实际 cgroup 文件，不只看 unit 声明。
- 进度服务独立限额（计划 MemoryMax=128M / MemorySwapMax=0 / CPUQuota=10%），仅监听空闲 loopback 端口。8787 已占用，禁止接管。访问通过 SSH 隧道，不公开无鉴权 HTTP。
- 从原始 `shared-solver/profiles/neko-zero-key.json` 派生受限配置，只覆盖资源与预算：单档 8000 expansions /120000ms，总≤600000ms；保留初态、目标、累计绿钥匙上限1、候选和搜索策略。严禁直接使用原 profile 的 6144/8192MiB、无限运行配置。
- 首次先做 loader/worker 受限健康检查，再做有界部署验证。内存不适配即保留失败证据并停止，不加限额、不无限重试、不自动重启重置预算。诊断见证不打包成搜索输入，不用于初态或 checkpoint。

## 验证与证据（待执行后追加）

需要记录实际 commit、bundle/文件清单 SHA256、配置 SHA256、cgroup 实际值、独立端口、HTTP 只读限制、worker 结果及 doctor 原始字段。结束时搜索应已停止；只读 UI 可保留。搜索 MISS/资源失败不得写成无解或自主通关。

## 2026-09-30 只读复检

Node22.22.2；1967MiB总RAM、约952MiB available；8.9GiB磁盘可用；cgroup v2具备memory/cpu控制器；用户Linger=yes。`~/motapath-solver-pr533b` 不存在，未列出motapath用户unit。8787占用，8791/18787未监听（发布时仍需再次检查）。本轮没有上传文件、创建unit、占用端口、启动搜索或改动其他服务。cloud1没有访问。
