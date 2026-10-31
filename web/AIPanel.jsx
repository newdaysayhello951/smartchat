import React, { useEffect, useRef, useState } from "react";
export default function AIPanel({
  active,
  request,
  download,
  onError,
  onClose,
}) {
  const [tab, setTab] = useState("ask"),
    [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState(null),
    [job, setJob] = useState(null),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const timer = useRef(null),
    generation = useRef(0),
    api = useRef(request);
  api.current = request;
  useEffect(() => {
    generation.current++;
    clearTimeout(timer.current);
    setAnswer(null);
    setJob(null);
    return () => {
      generation.current++;
      clearTimeout(timer.current);
    };
  }, [active?.id]);
  const working =
    job && ["submitting", "queued", "running"].includes(job.status);
  async function start(mode) {
    if (!active) return;
    const version = generation.current;
    onError("");
    setAnswer(null);
    setJob({ status: "submitting" });
    try {
      const task = await api.current("/ai", {
        conversation_id: active.id,
        mode,
        question,
        from: from ? from.replace("T", " ") + ":00" : "1970-01-01 00:00:00",
        to: to ? to.replace("T", " ") + ":59" : "2099-12-31 23:59:59",
      });
      if (version !== generation.current) return;
      setJob(task);
      let failures = 0;
      async function poll() {
        if (version !== generation.current) return;
        try {
          const state = await api.current("/jobs?id=" + task.id);
          if (version !== generation.current) return;
          setJob(state);
          failures = 0;
          if (state.status === "done") {
            setAnswer(state.result);
            return;
          }
          if (state.status === "failed") {
            onError(new Error(state.result.error));
            return;
          }
        } catch (e) {
          if (++failures >= 5) {
            onError(e);
            setJob({ status: "failed" });
            return;
          }
        }
        timer.current = setTimeout(poll, 1200);
      }
      poll();
    } catch (e) {
      if (version === generation.current) {
        setJob({ status: "failed" });
        onError(e);
      }
    }
  }
  return (
    <aside className="assistant">
      <div className="assistant-heading">
        <span className="ai-mark">✦</span>
        <div>
          <h3>智能助手</h3>
          <small>RAG · 会话资料 · Agent</small>
        </div>
        <button className="icon" title="关闭助手" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="ai-tabs">
        {[
          ["ask", "资料问答"],
          ["summary", "聊天摘要"],
          ["agent", "Agent"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "chosen" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="ai-body">
        <div className="ai-intro">
          <span>✦</span>
          <h2>
            {tab === "ask"
              ? "从会话中寻找答案"
              : tab === "summary"
                ? "把讨论整理成行动"
                : "交给 Agent 来处理"}
          </h2>
          <p>
            {tab === "ask"
              ? "检索当前聊天和文件，回答附带可展开的来源。"
              : tab === "summary"
                ? "按 UTC 时间范围整理讨论的决定、待办和分歧。"
                : "自主检索资料、总结文件和聊天、生成旅行草案；可查看只读工具执行过程。"}
          </p>
        </div>
        {tab === "summary" ? (
          <div className="date-range">
            <label>
              开始时间（UTC，可选）
              <input
                type="datetime-local"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              结束时间（UTC，可选）
              <input
                type="datetime-local"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
        ) : (
          <label>
            {tab === "agent"
              ? "描述你希望完成的任务"
              : "关于这段会话，你想了解什么？"}
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={2000}
              placeholder={
                tab === "agent"
                  ? "总结出行需求，结合攻略生成一份行程草案。"
                  : "例如：大家讨论的预算是多少？"
              }
            />
          </label>
        )}
        <button
          className="primary ai-button"
          disabled={
            !active || working || (tab !== "summary" && !question.trim())
          }
          onClick={() => start(tab)}
        >
          {working
            ? "处理中 · " + job.status
            : tab === "ask"
              ? "查找资料并回答 ↗"
              : tab === "summary"
                ? "生成聊天摘要 ↗"
                : "执行 Agent 任务 ↗"}
        </button>
        <button
          className="link reindex"
          disabled={!active || working}
          onClick={() => start("index")}
        >
          ↻ 重建资料索引
        </button>
        {answer && (
          <section className="answer">
            <div className="eyebrow">ASSISTANT RESPONSE</div>
            <div className="answer-text">{answer.answer}</div>
            {answer.citation_check && (
              <div
                className={
                  "citation-check " +
                  (["invalid", "missing"].includes(
                    answer.citation_check.status,
                  ) || answer.citation_check.grounding === "needs_review"
                    ? "warning"
                    : "")
                }
              >
                <strong>
                  引用校验：
                  {
                    {
                      passed: "编号有效",
                      invalid: "存在无效引用",
                      missing: "缺少引用标记",
                      no_sources: "没有引用来源",
                    }[answer.citation_check.status]
                  }
                </strong>
                {answer.citation_check.grounding && (
                  <p>
                    事实依据核验：
                    {
                      {
                        supported: "找到原文证据",
                        needs_review: "需要人工复核",
                        unchecked: "未完成自动核验",
                      }[answer.citation_check.grounding]
                    }
                  </p>
                )}
                <small>自动核验可能出错，重要结论请展开原文确认。</small>
              </div>
            )}
            {answer.steps?.length > 0 && (
              <div className="agent-trace">
                <h4>工具执行记录</h4>
                {answer.steps.map((s, i) => (
                  <details key={i}>
                    <summary>
                      {i + 1}. {s.tool} ·{" "}
                      {s.status === "done" ? "完成" : "失败"}
                    </summary>
                    {s.arguments && (
                      <pre>{JSON.stringify(s.arguments, null, 2)}</pre>
                    )}
                    <p>{s.preview}</p>
                  </details>
                ))}
              </div>
            )}
            {answer.citations?.length > 0 && <h4>检索来源 · 请核对原文</h4>}
            {answer.citations?.map((c) => (
              <details key={c.id}>
                <summary>
                  [{c.id}] {c.name} ·{" "}
                  {c.page
                    ? "第 " + c.page + " 页"
                    : c.file_id
                      ? "片段 " + c.chunk
                      : "消息 #" + c.seq}
                  <small>相关度 {c.score}</small>
                </summary>
                <p>{c.text}</p>
                {c.file_id && (
                  <button
                    className="link"
                    onClick={() => download(c.file_id, c.name)}
                  >
                    下载原文件 ↓
                  </button>
                )}
              </details>
            ))}
          </section>
        )}
      </div>
      <div className="ai-footer">
        ◈ 仅访问当前会话中你有权限的资料
        <br />
        <small>AI 可能出错，请核对引用；行程工具不查实时价格。</small>
      </div>
    </aside>
  );
}
