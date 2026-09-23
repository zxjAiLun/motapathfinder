# motapath-observer-mcp 网络暴露与网页端 Agent 连接指南

`motapath-observer-mcp` 默认仅监听服务器 loopback (`127.0.0.1:8788`)，严格保证不向公网直接暴露裸端口。

针对不同场景（安全隧道 vs 独立域名 HTTPS），推荐以下两种连接模式：

---

## 模式 1：Secure Tunnel（推荐：无需域名与公网开放端口）

OpenAI 官方支持 **Secure MCP Tunnel** 连接私网/本地 MCP 服务器，避免将数据库或搜索服务器直接暴露给互联网。

### 方案 A：Cloudflare Tunnel（零公网端口，极佳安全性）

在 `cloud1` 上运行 cloudflared，仅将 `127.0.0.1:8788` 映射为受 Cloudflare 保护的 HTTPS 端点：

```sh
# 1. 安装 cloudflared（ARM64）
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb

# 2. 快速临时隧道（用于即时测试验证）
cloudflared tunnel --url http://127.0.0.1:8788
# 将输出一个 https://<random-subdomain>.trycloudflare.com 地址
# 该地址的 /mcp 即可直接填入 ChatGPT
```

### 方案 B：SSH Local Tunnel（本机中转）

如果只需要在本机让本地 Agent（Claude Desktop / Cursor / 本机脚本）使用：

```sh
ssh -N -o ServerAliveInterval=30 -L 127.0.0.1:8788:127.0.0.1:8788 cloud1
```

本地 MCP 客户端直接访问 `http://127.0.0.1:8788/mcp` 或 `http://127.0.0.1:8788/sse`。

### 方案 C：SSH Stdio 管道（零端口）

在 Claude Desktop 或支持 command transport 的 MCP 客户端中，可直接通过 SSH 执行 stdio：

```json
{
  "mcpServers": {
    "motapath-observer": {
      "command": "ssh",
      "args": [
        "cloud1",
        "/home/ubuntu/.local/share/motapath-solver/node/bin/node /home/ubuntu/motapath-solver/observer-mcp/server.js --stdio"
      ]
    }
  }
}
```

---

## 模式 2：Caddy / Nginx HTTPS 反向代理（适合稳定网页端 Agent）

如果你有服务器域名，并希望在网页端 ChatGPT / Web Reviewer 中作为固定远程 MCP 长期使用：

### 选项 1：Caddy（自动 HTTPS，推荐）

```caddy
mcp.your-domain.com {
    reverse_proxy 127.0.0.1:8788 {
        # 禁用缓冲以保证 Streamable HTTP / SSE 实时推送
        flush_interval -1
    }
}
```

### 选项 2：Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name mcp.your-domain.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8788;
        proxy_http_version 1.1;

        # 保持连接与流式传输
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 禁用代理缓冲（SSE / Streamable HTTP 必需）
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
```

---

## 鉴权配置（Bearer Token）

为了防止任何未授权访问，强烈建议启用 Bearer Token：

1. 在服务器 `/home/ubuntu/motapath-solver/observer-mcp/.env` 中设置：
   ```env
   OBSERVER_MCP_AUTH_TOKEN=your-high-entropy-secret-token-here
   ```
2. 重启服务：
   ```sh
   systemctl --user restart motapath-observer.service
   ```
3. 在网页端 Agent / ChatGPT 配置 MCP 时，在 Authorization 请求头填写：
   ```text
   Authorization: Bearer your-high-entropy-secret-token-here
   ```

---

## 网页端 Agent（ChatGPT / Reviewer）配置方法

在 ChatGPT / OpenAI 客户端中添加 Remote MCP Server：

- **Transport**: `Streamable HTTP`
- **Server URL**: `https://mcp.your-domain.com/mcp`（或 Cloudflare Tunnel 提供的 HTTPS 地址）
- **Authentication**: `Bearer Token`
- **Token**: `your-high-entropy-secret-token-here`

连接成功后，Agent 将自动列出 9 个只读工具：
1. `get_runtime_status`
2. `list_durable_nodes`
3. `get_durable_node`
4. `get_attempt_history`
5. `get_search_diagnostics`
6. `read_artifact`
7. `analyze_stage_candidates`
8. `inspect_frontier_snapshot`
9. `read_bounded_log`
