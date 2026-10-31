# DeepSeek 官方商用接口配置

当前已从校园 Qwen 网关迁移到 DeepSeek 官方 API，旧网关密钥已停用。请在项目 `.env` 填写 `DEEPSEEK_API_KEY`，密钥仅由 Python 后端读取。Windows 每次请求自动读取新值，Docker 部署需重新创建 AI 容器以更新环境变量。

```dotenv
DEEPSEEK_API_KEY=
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-flash
```

用户描述的 `dsv4.1flash` 对应当前官方 DeepSeek V4.1 Flash，官方 API ID 为 `deepseek-flash`。后端会规范该简写，避免将非官方 ID 原样提交。官方来源：https://api-docs.deepseek.com/quick_start/agent_integrations/ 。

```http
POST https://api.deepseek.com/chat/completions
Authorization: Bearer <DEEPSEEK_API_KEY>
Content-Type: application/json
```

```json
{
  "model": "deepseek-flash",
  "messages": [{"role":"user","content":"你好"}],
  "temperature": 0.2,
  "thinking": {"type":"disabled"},
  "stream": false,
  "max_tokens": 2400
}
```

问答和摘要读取 `choices[0].message.content`。Agent 在同一请求中添加 `tools` 与 `tool_choice:"auto"`，读取 `message.tool_calls`，然后以 `role:"tool"`、`tool_call_id` 回传真实工具结果。当前关闭思考模式，以保持低延迟，不使用 Qwen 专用的 `enable_thinking` 字段。

请求规范：https://api-docs.deepseek.com/api/create-chat-completion/ 。

MockTransport 和独立本地模拟模型已验证标准请求头、官方端点、模型 ID、工具调用、错误分类与 RAG/Agent 链路。用户填写官方密钥后，2026-10-28 通过真实官方接口验证：Agent 执行 search_conversation，从合成聊天中检索“每人两千元”的预算，经过两次模型请求返回正确答案和一条引用。测试没有发送私人聊天，也没有记录密钥。
