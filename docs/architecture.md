# 实现约束与协议

## C++ 网络与并发

Asio `io_context` 由 3 个 I/O 线程运行；每条 TCP 连接使用 strand 串行化回调。Linux 下默认由 Asio 选择 epoll。Beast 负责 HTTP 和 WebSocket 帧解析，异步读写自行处理部分传输和 EAGAIN。

数据库访问、密码哈希、磁盘文件读写以及调用内部 AI 服务进入 8 线程工作池，排队与执行任务合计最多 128。超过上限 HTTP 返回 503；WebSocket 聊天返回 busy。最多 512 条 HTTP / WebSocket 连接；超额新连接直接关闭。HTTP 请求读写超时 30 秒，最大请求体 50 MB，头部 16 KB。WebSocket 输入最大 20 KB，待发队列最多 64 条；超过后断开，客户端依靠数据库补拉恢复。WebSocket 使用 Beast 建议的服务端心跳和超时。

每个 WebSocket 每 700 ms 在工作池查询当前会话增量，每批 100 条。它提供实时接收，但属于轮询数据库的简化实现；大量在线用户应改成内存连接注册表、提交事务后事件广播，并在多实例间增加消息总线。前端另有 4 秒 HTTP 补拉以应对代理异常。

SIGINT / SIGTERM 停止接入并保留 10 秒退出窗口；之后停止 I/O 并等待已提交工作完成。当前没有跨服务的分布式任务取消。

## 可靠消息

发送接口 `POST /api/messages` 接受：

```json
{"conversation_id":"1","client_message_id":"uuid","content":"你好","file_id":"可选，空字符串表示无附件"}
```

数据库 ID 在 JSON 中采用字符串，避免浏览器大整数精度损失。持有会话行锁后检查 `(sender_id,client_message_id)`，相同请求返回原消息，不同内容复用 ID 返回 409。只有插入新消息才增加会话 `sequence`。事务提交后返回消息 ID 和 `seq`，客户端显示“已发送”；这表示服务器已持久化，不表示对方已读。

`GET /api/messages?conversation_id=1&after=42` 按序升序取 100 条；`before=42` 返回更早 100 条（降序），前端按序号合并排序。断线后客户端使用本地最大已接收序号继续拉取。本版不实现已读回执和多设备统一阅读游标。

WebSocket 地址 `/ws?conversation_id=1&after=0`，首帧必须是 `{"type":"auth","token":"..."}`。令牌不放 URL。鉴权与会话校验成功后推送 `{"type":"messages","data":[...]}`。还可发送 `{"type":"chat",...}` 并接收 `ack`；主前端使用 HTTP 发送确认、WebSocket 接收，避免忙时的未确认消息处理分叉。

## 文件与 AI

上传 `POST /api/files?conversation_id=1&name=...` 使用原始字节；下载 `GET /api/files?id=...` 使用 Bearer 鉴权。文件路径由随机 ID 生成，原名称不会参与磁盘路径。上传和文件消息发送是两步操作，第二步失败可重试。若 AI 服务不可用，上传仍成功，界面可以“重建资料索引”恢复。

AI `POST /api/ai` 接受 `mode=ask|summary|index|agent`，返回任务 ID；`GET /api/jobs?id=...` 限制为提交者访问，并复查会话权限。C++ 将已验证会话 ID 与消息快照传给不对外暴露的 Python 服务，Python 通过共享内部密钥验证来源并按会话 ID 过滤索引。每用户每分钟最多 6 个显式 AI 任务（并发边界是近似值），Python 全局最多 32 个已提交任务、同时运行 2 个。

SQLite 持久化索引与任务状态；内存执行队列不持久化，重启后未完成任务改为失败。解析在线程中运行，超时可以结束等待但不能强制终止正在执行的 Python 解析线程；不适合接收互联网上任意不可信 PDF。摘要最多 20 次分段调用再 1 次汇总，并有 5 分钟总等待上限。用户资料会作为上下文发送到配置的模型提供方。

## API 一览

| 接口 | 方法 | 鉴权 |
| --- | --- | --- |
| `/api/health` | GET | 无 |
| `/api/register`, `/api/login` | POST | 无 |
| `/api/logout` | POST | Bearer |
| `/api/users` | GET | Bearer |
| `/api/conversations` | GET / POST | Bearer |
| `/api/messages` | GET / POST | 会话成员 |
| `/api/files` | GET / POST | 会话成员 |
| `/api/ai` | POST | 会话成员 |
| `/api/jobs` | GET | 提交者 + 会话成员 |

错误统一 JSON `{"error":"说明"}`；前端支持 401、403、409、413、429、503 等错误展示。Nginx 对 API 实施每 IP 每秒 15 次、突发 40 次的全局基础限流。


## Windows、媒体与通话扩展

Windows 由 IOCP/Asio 驱动，原生 Vite 入口为 8080、C++ 为 8081、Python 为 8000，独立 MySQL 为 3307。变量通过 scripts/common.ps1 导入，不依赖 Docker。

文件最大 50 MB，任意附件均可传输；只为 PNG/JPEG/GIF/WebP、常见音频和视频返回已知媒体 MIME，其他一律 attachment/octet-stream。下载复查会话权限，支持单段 HTTP Range、后缀范围与 416。前端使用 Bearer 获取 Blob，令牌不进入媒体 URL。

通话由 calls 持久化状态，call_events 保存每用户独立的信令事件。新建呼叫在事务内按顺序锁定两位用户，避免并发互拨产生两条有效呼叫；只允许对方接听/拒绝，双方均可挂断，ICE 转发最多 300 条。来电通过独立 /ws?events=1 通道全局推送，并用 HTTP 补拉；每条事件仍检查身份。媒体经 WebRTC 点对点或 TURN，服务器不存储通话音视频。

呼叫 45 秒未接听会失效，通话后每 10 秒心跳刷新各自 last_seen；以两端较早的时间加 45 秒为过期时间，单端持续心跳不能永久占用离线对方的忙线状态。通话结束会在当前会话产生普通聊天记录。刷新页面无法恢复浏览器原有 RTCPeerConnection，会显式结束失效通话。

TURN 使用服务端 shared secret 生成一小时临时用户名和 HMAC-SHA1 密码，不将 shared secret 发给前端。部署方仍需提供 TURN URL、secret 和 HTTPS 入口。

## Agent

Python 使用同一 OpenAI 兼容接口的 tools/tool_choice 字段，最多 4 轮、6 次工具、8 次总模型请求；任务仍受 300 秒超时限制。工具不接受用户/会话参数，始终使用 C++ 授权的会话快照与文件白名单。summarize_file 必须命中当前会话文件 ID；未知工具和越权 ID 返回工具错误。工具只读，不替用户发送消息或修改任何资料。

执行记录含工具名称、参数、状态与截断结果预览，和答案一起持久化到任务结果。旅行工具没有实时票价/预订能力。模型回答中的引用仍需人工核验。
