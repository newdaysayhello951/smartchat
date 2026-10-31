# Windows / VS / VS Code 使用

## 本机已经配置好的运行方式

开发机已使用 VS 2022 的 MSVC x64 成功编译，并启动真实 C++、MySQL、Python、React 服务。无需 Linux 和 Docker。

```powershell
# 项目根目录，启动服务并打开浏览器
powershell -ExecutionPolicy Bypass -File scripts/start-windows.ps1

# 停止项目服务（不停止系统 MySQL80）
powershell -ExecutionPolicy Bypass -File scripts/stop-windows.ps1
```

访问 http://localhost:8080 。普通窗口和无痕窗口分别注册账号，即可互相选择并聊天。点击聊天标题右侧电话或摄像机开始通话，对方即使未打开该聊天也会收到来电。浏览器提示时允许麦克风 / 摄像头；系统权限、独占设备和网络可能影响连接。

### AI Key

在项目 `.env` 中填写 DeepSeek 官方 `DEEPSEEK_API_KEY=`。Windows AI 服务每次模型请求读取最新的密钥、模型和接口地址，无需重启聊天或分享隧道。密钥仅在 Python 后端使用，不发给前端。标准配置为 `LLM_BASE_URL=https://api.deepseek.com`、`LLM_MODEL=deepseek-flash`，请求体使用 `thinking: {"type":"disabled"}`。需要单独重启 AI 时执行 `powershell -ExecutionPolicy Bypass -File scripts/restart-ai.ps1`。

### VS Code

打开项目文件夹，安装推荐的 C/C++、CMake Tools、Python 扩展。从“终端 → 运行任务”选择：

- `青聊：启动所有服务`
- `青聊：停止所有服务`
- `青聊：编译 C++`（修改 C++ 后先停止服务，编译，再启动）
- `青聊：完整浏览器验收`

调试菜单提供 C++ 附加到 `im_server.exe`、Edge 前端和 FastAPI。需要 C++ 行号断点时先用 `cmake --build build/windows --config Debug` 构建 Debug，再手动用项目环境启动对应程序；Release 构建主要用于功能验收。

Visual Studio 也可打开生成的 `build/windows/smart_im.sln`。项目依赖路径在 CMake 缓存中；当前机器使用现有 Boost / OpenSSL 和 MySQL 客户端开发库。

## 移到另一台 Windows 机器

需要 VS 2022 的“使用 C++ 的桌面开发”、Windows SDK、CMake、Python 3.12、Node.js、MySQL 8 安装目录（包括 `bin/mysqld.exe`、`include/mysql.h` 和 `lib/libmysql.lib`）。

还需 Boost / OpenSSL 开发库。当前脚本可检测 Anaconda 的 `Library` 目录；也可显式指定：

```powershell
python scripts/configure.py
powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1 `
  -MySqlRoot D:/MySQL `
  -DependencyRoot D:/anaconda/Library
```

若通过 vcpkg 安装依赖，可安装 `boost-beast:x64-windows openssl:x64-windows nlohmann-json:x64-windows libmariadb:x64-windows`，然后给 CMake 指定 vcpkg toolchain。数据库服务器仍需 MySQL；vcpkg 的 Connector/C 只负责 C++ 链接。此路径未在本机运行，优先使用已验收的本机配置。

## 数据位置与端口

| 项目 | 位置 / 端口 |
| --- | --- |
| 前端与本机反向代理 | `127.0.0.1:8080`，Vite 原生开发服务器 |
| C++ | `127.0.0.1:8081` |
| AI | `127.0.0.1:8000` |
| 项目独立 MySQL | `127.0.0.1:3307` |
| MySQL 数据 | `%LOCALAPPDATA%/QingLiao/<项目路径哈希>/mysql` |
| 文件 / 索引 / 日志 | 项目 `data/files`、`data/index`、`data/logs` |

本机 MySQL 对中文目录的启动处理有问题，所以数据库单独存到标准 AppData ASCII 路径。原系统 MySQL80 服务与数据不会被初始化脚本修改。首次初始化短暂使用无密码 root，仅监听本机，随后设置 `.env` 里的随机 root 密码，应用使用独立 `im` 用户；启动和初始化后检查日志可确认。

脚本将 `.env` 导入当前进程，再传给子进程。C++ 本身不会自动读取 `.env`。Windows 服务不需要 Nginx，Vite 将 `/api`、`/ws` 转发到 C++。

## 跨设备及公网通话

默认只供本机使用。两台设备间使用需部署可信 HTTPS / WSS 入口，并开放实际部署的入口地址；手机访问 `http://电脑IP` 不是安全上下文，浏览器通常不会允许摄像头和麦克风。

WebRTC 在同机和可直连局域网可直接建立媒体连接。跨运营商或严格 NAT 场景需要你可用的 TURN 服务；仅配置 STUN 无法保证任意网络互通。项目支持：

```dotenv
RTC_STUN_URL=stun:stun.l.google.com:19302
TURN_URL=turn:your-host:3478
TURN_SECRET=与你的coturn共享的密钥
```

服务端根据 TURN shared secret 生成有效期 1 小时的临时凭据。项目不附带可凭空使用的公网 TURN 账号，不会假装已完成公网网络部署。配置并重启后，新通话会使用这些参数。
