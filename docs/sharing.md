# 临时公网分享

已使用 Cloudflare Quick Tunnel，将公网 HTTPS 转发到本机 `127.0.0.1:8787` 的分享网关。网关直接提供 `web/dist` 生产资源，仅转发 `/api/` 和 `/ws` 到 C++，不暴露 Vite 开发服务器、MySQL 或 Python 内部端口。

## 使用

1. 本机先运行 `Start-QingLiao.cmd`。
2. 双击 `Start-Sharing.cmd`，终端会显示临时 HTTPS 地址和随机分享口令。
3. 将地址和分享口令发给朋友。朋友先输入分享口令，再注册或登录自己的青聊账号。
4. 不需要分享时，双击 `Stop-Sharing.cmd`。只关闭外网访问，本机应用仍可使用。

当前地址保存在 `data/share-url.txt`，分享口令保存在 `data/share-access.json`。两者均在被 Git 忽略的目录中。重开分享会创建新的口令，重新创建 Quick Tunnel 通常也会改变地址。

电脑、C++/AI 服务、分享网关及 cloudflared 都需要持续运行。`Stop-QingLiao.cmd` 会先关闭公网分享。没有安装系统服务，没有修改路由器端口映射，也没有开放数据库端口。

## 已验证

`scripts/share-smoke.py` 实际通过公网域名验证：

- 未输入分享口令不能访问应用 API；错误口令被拒绝。
- 成功后使用 Secure / HttpOnly / SameSite Cookie，随后应用仍使用自己的账号鉴权。
- 生产页面和 API 可访问，隐藏配置文件路径返回 404。
- WebSocket 通过真实公网 WSS 建立连接，两个测试账号完成实时消息传递。

分享网关包含基础请求限流、口令尝试限制、请求大小限制以及媒体 Blob 所需的 CSP。不要将分享口令当作永久账号体系；仅将它提供给参与测试的人。

## 音视频与限制

HTTPS 允许浏览器请求麦克风和摄像头，但 HTTP 内网穿透不替代 WebRTC 的 TURN 中继。不同网络的双方仍可能因 NAT 无法直连，需要在 `.env` 设置 `TURN_URL` 和 `TURN_SECRET`，并提供真实可用的 TURN 服务。

Cloudflare Quick Tunnel 适合临时测试，没有稳定性保证、不支持 SSE，有并发限制。当前 AI 采用任务查询，因此不依赖 SSE。长期使用应改为正式域名及命名隧道或服务器部署。

官方说明：https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/

工具版本：cloudflared 2026.10.0，官方下载 SHA256：
`86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c`。
