# motapath-observer-mcp

专为 **网页端 Reviewer Agent（如 ChatGPT / Claude Web / 自定义 Reviewer）** 设计的只读 MCP（Model Context Protocol）服务器。

用于消除 **GitHub 代码事实** 与 **云端搜索实机运行事实** 之间的证据脱节，允许 Reviewer 直接调阅云端 durable journal、states、probes、diagnostics 与 release identity，避免人肉搬运日志与工件截图。

```text
GitHub connector
    → 查阅 committed code / diff / SHA

motapath-observer-mcp (云端只读)
    → 查阅真实 durable journal / states / probe / logs / release identity

Reviewer Agent
    → 自动交叉核验代码与实机运行事实
```

---

## 核心设计与安全约束

1. **严格只读 (Strictly Read-Only)**：
   - 彻底拒绝万能执行工具（无 `run_shell`、`systemctl`、`cat_any_file`、`kill`、`git pull` 等）。
   - 绝不提供任何文件写入、进程修改或配置变更能力。
   - 读取操作严格保证不改变任何 journal/state 的 mtime 或内容。
2. **白名单与路径穿越防御**：
   - 仅允许读取预定义的工件目录（`runs/*/`、`releases/*/`、`routes/generated/`、`logs/generated/`）。
   - 严格禁止访问系统敏感文件（`~/.ssh`、`/etc`、`.env`、凭证与密钥）。
   - 文件大小与行数严格受限（默认最大 256 KB，硬上限 1 MB；日志读取最大 300 行）。
3. **身份与 Provenance 一等公民**：
   - 每一个工具返回结果均自动携带 `_provenance` 元数据块：
     ```json
     {
       "_provenance": {
         "host": "instance-20260917-2257",
         "run_id": "neko-zero-key",
         "release_id": "20260920-5-28b-a647d573-r2",
         "git_sha": "bundle-1aefd4f0d40d",
         "file": "journal.json",
         "file_sha256": "40409e8d838bd006f9fe7a68367d75993731933ea851aab8242ee8913e7f43e9",
         "mtime": "2026-09-20T12:00:49.759Z",
         "read_at": "2026-09-20T14:00:09.244Z"
       }
     }
     ```
   - 彻底解决“拿 A 运行的 journal 去解释 B 版本的代码”的身份漂移隐患。
4. **支持的协议传输 (Transports)**：
   - **Streamable HTTP** (`POST /mcp` 或 `POST /`)：支持 OpenAI ChatGPT 网页端 Remote MCP。
   - **Standard MCP SSE** (`GET /sse` + `POST /messages?sessionId=...`)：标准 Server-Sent Events 流式传输。
   - **Stdio Transport** (`node server.js --stdio`)：供本地测试、命令行管道或 Secure MCP SSH Tunnel 使用。
5. **身份隔离与守护进程**：
   - 独立运行于专用端口 `8788`，内存配额限制为 `512MB`，独立于 solver 与 progress UI。
   - 即使 MCP 服务异常退出，绝不影响求解器正常执行。

---

## 工具集（9 个语义工具）

### 1. `get_runtime_status`
获取求解器当前运行状态、活动任务、展开统计及当前 release/profile 身份。
- **参数**：
  - `run_id` (可选，字符串): 运行目录名称（默认 `neko-zero-key`）
- **典型返回**：
  ```json
  {
    "service": "paused",
    "title": "纳可物语 · 血洛缘起 · 零绿钥匙",
    "run_id": "neko-zero-key",
    "release_id": "20260920-5-28b-a647d573-r2",
    "solver_digest": "ed24600f6f754618659fb06db7f5c46e2b12150bd91ac221c4dd54cd0016c1d7",
    "completed_attempts": 160,
    "total_expansions": 6757300,
    "candidates_count": 53,
    "pending_count": 27,
    "limits": { "heapMb": 6144, "maxRssMb": 8192 }
  }
  ```

### 2. `list_durable_nodes`
列出并聚合搜索账本（journal）中的 durable checkpoint 节点。
- **参数**：
  - `stage` (可选，整数): 阶段索引（例如 `2` 代表 TS13）
  - `tier` (可选，整数): 预算档位
  - `status` (可选，字符串): `pending` | `searched` | `bounded` | `goal` | `running`
  - `limit` (可选，整数，默认 50，最大 500)
  - `offset` (可选，整数，默认 0)
  - `hero_aggregate` (可选，布尔值，默认 true): 自动返回所有匹配节点的英雄属性分布！
- **实测解答**：“34 个 TS13 entry 是不是全部 ATK=6 / DEF=0？”
  单次调用直接返回：
  ```json
  {
    "total_matching": 34,
    "hero_distribution": {
      "count": 34,
      "atk_distribution": { "6": 34 },
      "def_distribution": { "0": 34 },
      "mdef_distribution": { "0": 34 },
      "lv_distribution": { "2": 34 },
      "floor_distribution": { "TS13": 34 },
      "hp_summary": { "min": 666, "max": 1369, "median": 1337 }
    }
  }
  ```

### 3. `get_durable_node`
按 node ID 获取该检查点的详细状态、英雄属性、坐标、物品背包、标志位以及对应的 preview 快照。
- **参数**：
  - `node_id` (必填，字符串): 节点 ID（如 `2-e43578327354f648338adb56`）
  - `include_full_state` (可选，布尔值，默认 false): 是否加载包含全地图地块变动的完整 state

### 4. `get_attempt_history`
获取求解尝试记录（倒序排列，最新优先），提取每次尝试的展开数、frontier 规模、停止原因、DP 诊断概览。
- **参数**：
  - `node_id` (可选，字符串): 过滤入口节点
  - `stage` (可选，整数): 过滤阶段
  - `limit` (可选，整数，默认 30，最大 100)

### 5. `get_search_diagnostics`
获取详细的搜索剪枝与统治关系诊断。
- **参数**：
  - `task_id` (可选，字符串): 任务 ID 或 `latest`
  - `probe_name` (可选，字符串): 查询 probe 工件（如 `256k`、`128k`）
- **包含指标**：
  - `dp`: unique keys, dpSkylineMax, goalArchiveTrimmed, goalArchiveEvictedCount
  - `dominance`: acceptedStates, rejectedByHigherHp, sameHpRejected, replacedLowerHp
  - `memory`: peakHeapUsedMb, peakRssMb, rssGcCount

### 6. `analyze_stage_candidates` (领域专属分析)
对特定阶段（如 TS12→TS13）候选生成的深度因果审计工具。
- **参数**：
  - `stage` (必填，整数): 阶段索引（`0`: TS11, `1`: TS12, `2`: TS13）
- **核心功能**：
  - 统计所有被注册到 journal 的目标候选属性分布。
  - 检查生成这些候选的历史尝试中是否发生了 top-16 归档淘汰（`archive_retention_evidence`）。
  - 识别搜索过程中见过的最大属性（`max_hero_seen_during_search`）。
  - 输出 `causal_assessment` 结论，明确回答属性单一究竟是因为“搜索只产生此类候选”还是“其他属性候选被 HP 排序淘汰”。

### 7. `inspect_frontier_snapshot` (领域专属分析)
实时 / probe 队列因果审计工具，提供分楼层服务统计与饿死判定。
- **参数**：
  - `task_id` (可选，字符串): probe 名称（如 `256k`）
- **核心功能**：
  - 提取各楼层 active frontier 规模（TS11: 5, TS12: 12,603, TS13: 28,697）。
  - 各楼层出队与入队计数（popped vs inserted）。
  - 各楼层最老未服务节点等待时间（TS13: 255,999 展开）。
  - 自动输出 `starvation_diagnosis` 评估报告。

### 8. `read_artifact`
安全读取白名单内的工件文件（`status`、`journal`、`preview`、`task`、`attempt`、`state`、`route`、`probe`、`manifest`、`log`）。
- **参数**：
  - `artifact_type` (必填，字符串)
  - `id` (可选，字符串): 如 probe 名称 `256k`、manifest 名称 `bundle`
  - `max_bytes` (可选，默认 256 KB，硬上限 1 MB)
  - `json_path` (可选，字符串): 点分隔提取 JSON 子对象（例如 `service.TS13`），避免在大文件上产生过量 token 消耗。

### 9. `read_bounded_log`
安全读取日志尾部（`worker.log`、`256k.log` 等）。
- **参数**：
  - `source` (必填，字符串): `worker` | `256k` | `128k`
  - `tail_lines` (可选，默认 100，最大 300)
  - `pattern` (可选，字符串): 正则或子串过滤

---

## 部署与连接

### 云端服务管理 (cloud1)

服务已作为 systemd 用户服务安装并开机自启：

```sh
# 查看状态
ssh cloud1 "systemctl --user status motapath-observer.service"

# 查看最近日志
ssh cloud1 "journalctl --user -u motapath-observer.service -n 50 --no-pager"

# 重启服务
ssh cloud1 "systemctl --user restart motapath-observer.service"
```

### 接入网页端 Agent (ChatGPT / Remote MCP)

由于服务器仅监听 `127.0.0.1:8788`，推荐两种连接方式（详见 `deploy/caddy-nginx-reference.md`）：

1. **Secure MCP Tunnel（零公网暴露，推荐）**：
   - 使用 Cloudflare Tunnel：
     ```sh
     cloudflared tunnel --url http://127.0.0.1:8788
     ```
   - 将输出的 `https://<tunnel-domain>.trycloudflare.com/mcp` 填入网页端 Agent 的 MCP Server URL。
2. **Caddy / Nginx HTTPS 反向代理**：
   - 反向代理至 `127.0.0.1:8788`，支持带有 Bearer Token 校验。
   - 网页端 Agent 配置为 `Streamable HTTP` 模式。

### 本地测试与回归

在任何装有 Node.js 的环境中运行回归测试：

```sh
node tools/motapath-observer-mcp/test-observer-mcp.js
```
所有 13 组单元、集成、安全与负向对照测试均保证在 1 秒内执行完毕。
