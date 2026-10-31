import React, { useEffect, useRef, useState } from "react";
import AIPanel from "./AIPanel.jsx";
import { CallOverlay, useCall } from "./useCall.jsx";
import MediaMessage, { fileKind } from "./MediaMessage.jsx";
import ProductPanel from "./ProductPanel.jsx";
import { uploadResumable } from "./upload.js";
import { downloadResumable } from "./download.js";
const read = (k, f) => {
  try {
    return JSON.parse(sessionStorage.getItem(k)) ?? f;
  } catch {
    return f;
  }
};
const time = (s) =>
  s
    ? new Date(s.replace(" ", "T") + "Z").toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
export default function App() {
  const [session, setSession] = useState(() => read("im-session", null)),
    [register, setRegister] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [conversations, setConversations] = useState([]),
    [users, setUsers] = useState([]),
    [active, setActive] = useState(null),
    [messages, setMessages] = useState([]),
    [draft, setDraft] = useState(""),
    [connected, setConnected] = useState(false),
    [pending, setPending] = useState(() => read("im-pending", []));
  const [section, setSection] = useState("chats"),
    [filter, setFilter] = useState(""),
    [assistant, setAssistant] = useState(false),
    [mobileChat, setMobileChat] = useState(false),
    [uploading, setUploading] = useState(false),
    [percent, setPercent] = useState(0),
    [recording, setRecording] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [query, setQuery] = useState(""),
    [results, setResults] = useState(null),
    [shared, setShared] = useState(null),
    [emoji, setEmoji] = useState(false);
  const activeRef = useRef(null),
    cursor = useRef(0),
    bottom = useRef(null),
    socket = useRef(null),
    fileInput = useRef(null),
    imageInput = useRef(null),
    videoInput = useRef(null),
    recorder = useRef(null),
    recordStream = useRef(null),
    recordTimer = useRef(null),
    xhrRef = useRef(null),
    lastUpload = useRef(null);
  const [transferStage, setTransferStage] = useState("上传");
  const [downloadPercent, setDownloadPercent] = useState(null),
    downloadController = useRef(null);
  const token = session?.token;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  function showError(e) {
    setError(e.message || String(e));
  }
  async function api(path, options = {}) {
    const r = await fetch("/api" + path, {
      ...options,
      headers: {
        Authorization: "Bearer " + token,
        ...(typeof options.body === "string"
          ? { "Content-Type": "application/json" }
          : {}),
        ...options.headers,
      },
    });
    if (!r.ok) {
      let text = "请求失败（" + r.status + "）";
      try {
        text = (await r.json()).error || text;
      } catch {}
      if (r.status === 401 && token && tokenRef.current === token)
        logout(false);
      throw Error(text);
    }
    return r;
  }
  async function request(path, body) {
    return (
      await api(
        path,
        body === undefined
          ? {}
          : { method: "POST", body: JSON.stringify(body) },
      )
    ).json();
  }
  const calls = useCall(session, request, showError);
  function stopRecording(discard = false) {
    clearTimeout(recordTimer.current);
    if (recorder.current) {
      recorder.current.discard = discard;
      if (recorder.current.state !== "inactive") recorder.current.stop();
    }
    recordStream.current?.getTracks().forEach((t) => t.stop());
    recordStream.current = null;
    setRecording(false);
  }
  function logout(remote = true) {
    tokenRef.current = null;
    calls.finish();
    stopRecording(true);
    xhrRef.current?.abort();
    if (remote) api("/logout", { method: "POST" }).catch(() => {});
    activeRef.current = null;
    socket.current?.close();
    sessionStorage.removeItem("im-session");
    sessionStorage.removeItem("im-pending");
    setSession(null);
    setConversations([]);
    setUsers([]);
    setActive(null);
    setMessages([]);
    setPending([]);
    setShared(null);
  }
  async function login(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const value = await request(register ? "/register" : "/login", {
        username,
        password,
      });
      sessionStorage.setItem("im-session", JSON.stringify(value));
      setSession(value);
      setPassword("");
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const [c, u] = await Promise.all([
      request("/conversations"),
      request("/users"),
    ]);
    setConversations(c);
    setUsers(u);
    if (activeRef.current) {
      const found = c.find((item) => item.id === activeRef.current);
      if (found) setActive(found);
      else {
        activeRef.current = null;
        setActive(null);
        setMessages([]);
      }
    }
  }
  useEffect(() => {
    if (!token) return;
    refresh().catch(showError);
    const t = setInterval(() => refresh().catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [token]);
  useEffect(() => {
    sessionStorage.setItem("im-pending", JSON.stringify(pending));
  }, [pending]);
  function merge(rows, cid = activeRef.current) {
    if (activeRef.current !== cid) return;
    setMessages((old) => {
      const map = new Map(old.map((m) => [m.seq, m]));
      rows.forEach((m) => map.set(m.seq, m));
      return [...map.values()].sort((a, b) => Number(a.seq) - Number(b.seq));
    });
    if (rows.length) {
      cursor.current = Math.max(
        cursor.current,
        ...rows.map((m) => Number(m.seq)),
      );
      setPending((old) =>
        old.filter(
          (p) =>
            !rows.some(
              (m) =>
                m.client_message_id === p.client_message_id &&
                m.sender_id === session.user.id,
            ),
        ),
      );
      request("/read", {
        conversation_id: cid,
        seq: String(cursor.current),
      }).catch(() => {});
    }
  }
  function select(c) {
    stopRecording(true);
    if (!c) {
      activeRef.current = null;
      setActive(null);
      setMessages([]);
      setMobileChat(false);
      return;
    }
    activeRef.current = c.id;
    setActive(c);
    setMobileChat(true);
    setShared(null);
    setResults(null);
    setSearchOpen(false);
    setDraft("");
  }
  useEffect(() => {
    if (!active || !token) return;
    let disposed = false,
      retry,
      attempts = 0,
      syncing = false;
    let eventCursor = 0;
    const cid = active.id;
    activeRef.current = cid;
    cursor.current = 0;
    setMessages([]);
    setError("");
    function connect() {
      if (disposed) return;
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws?conversation_id=${cid}&after=${cursor.current}`,
      );
      socket.current = ws;
      ws.onopen = () => {
        attempts = 0;
        ws.send(JSON.stringify({ type: "auth", token }));
        setConnected(true);
      };
      ws.onmessage = (e) => {
        if (disposed) return;
        try {
          const v = JSON.parse(e.data);
          if (v.type === "messages") merge(v.data, cid);
        } catch {}
      };
      ws.onclose = () => {
        if (!disposed) {
          setConnected(false);
          retry = setTimeout(connect, Math.min(15000, 1000 * 2 ** attempts++));
        }
      };
      ws.onerror = () => ws.close();
    }
    async function sync() {
      if (syncing) return;
      syncing = true;
      try {
        let rows;
        do {
          rows = await request(
            `/messages?conversation_id=${cid}&after=${cursor.current}`,
          );
          if (disposed) return;
          merge(rows, cid);
        } while (rows.length === 100);
      } catch (e) {
        if (!disposed) showError(e);
      } finally {
        syncing = false;
      }
    }
    connect();
    sync();
    const t = setInterval(sync, 4000);
    const changes = setInterval(async () => {
      try {
        const rows = await request(
          `/message-events?conversation_id=${cid}&after=${eventCursor}`,
        );
        if (disposed) return;
        if (rows.length) {
          eventCursor = Math.max(
            eventCursor,
            ...rows.map((row) => Number(row.event_id)),
          );
          merge(rows, cid);
        }
      } catch {}
    }, 2500);
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearInterval(t);
      clearInterval(changes);
      socket.current?.close();
      setConnected(false);
    };
  }, [active?.id, token]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, pending.length]);
  useEffect(
    () => () => {
      recordStream.current?.getTracks().forEach((t) => t.stop());
      clearTimeout(recordTimer.current);
      xhrRef.current?.abort();
    },
    [],
  );
  async function begin(u) {
    try {
      const c = await request("/conversations", { user_id: u.id });
      await refresh();
      select({ id: c.id, username: u.username, peer_id: u.id });
      setSection("chats");
    } catch (e) {
      showError(e);
    }
  }
  async function transmit(item) {
    setPending((old) =>
      old.map((p) =>
        p.client_message_id === item.client_message_id
          ? { ...p, status: "sending" }
          : p,
      ),
    );
    try {
      const saved = await request("/messages", item);
      setPending((old) =>
        old.filter((p) => p.client_message_id !== item.client_message_id),
      );
      merge(
        [{ ...saved, username: session.user.username }],
        item.conversation_id,
      );
      refresh().catch(() => {});
      return true;
    } catch (e) {
      setPending((old) =>
        old.map((p) =>
          p.client_message_id === item.client_message_id
            ? { ...p, status: "failed" }
            : p,
        ),
      );
      showError(e);
      return false;
    }
  }
  function send(content = draft, file_id = "", cid = active?.id) {
    if (!cid || (!content.trim() && !file_id)) return;
    const item = {
      conversation_id: cid,
      client_message_id: crypto.randomUUID(),
      content,
      file_id,
      status: "sending",
      owner: session.user.id,
    };
    setPending((old) => [...old, item]);
    if (!file_id) setDraft("");
    return transmit(item);
  }
  async function uploadFile(file, cid = activeRef.current) {
    if (!file || !cid || uploading) return;
    if (!file.size || file.size > 1024 * 1024 * 1024) {
      showError(Error("文件须为 1 字节至 1 GB"));
      return;
    }
    const controller = new AbortController();
    xhrRef.current = controller;
    lastUpload.current = { file, cid };
    setUploading(true);
    setPercent(0);
    setTransferStage("校验文件");
    setError("");
    try {
      const data = await uploadResumable(file, cid, request, token, {
        signal: controller.signal,
        onProgress: (progress) => {
          setPercent(progress.percent);
          setTransferStage(progress.stage);
        },
      });
      const sent = await send("📎 " + file.name, data.id, cid);
      if (!sent)
        setNotice("文件已上传，但附件消息未确认，请点击失败消息重试。");
      else {
        setNotice("文件已发送。文档和图片正在后台解析索引。");
        lastUpload.current = null;
      }
    } catch (error) {
      if (error.name === "AbortError")
        setNotice(
          "上传已暂停。点击继续上传，或重新选择同一文件，可保留进度续传。",
        );
      else {
        showError(error);
        setNotice("已上传分片会保留；恢复网络后重新选择同一文件继续上传。");
      }
    } finally {
      setUploading(false);
      xhrRef.current = null;
    }
  }
  function upload(e) {
    const f = e.target.files[0];
    e.target.value = "";
    uploadFile(f);
  }
  async function download(id, name) {
    if (window.showSaveFilePicker) {
      const controller = new AbortController();
      downloadController.current = controller;
      setDownloadPercent(0);
      try {
        await downloadResumable(id, name, token, {
          signal: controller.signal,
          onProgress: setDownloadPercent,
        });
        setNotice("文件下载完成并已校验。");
      } catch (error) {
        if (error.name === "AbortError")
          setNotice("下载已暂停，重新点击同一附件可继续。");
        else showError(error);
      } finally {
        setDownloadPercent(null);
        downloadController.current = null;
      }
      return;
    }
    try {
      const blob = await (
          await api("/files?id=" + encodeURIComponent(id))
        ).blob(),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = name.replace(/^📎\s*/, "") || "附件";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      showError(e);
    }
  }
  async function record() {
    if (recording) {
      stopRecording();
      return;
    }
    if (!active || uploading || calls.call) return;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw Error("录音需要支持录音的浏览器及 localhost / HTTPS。");
      const cid = active.id,
        s = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (activeRef.current !== cid) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      recordStream.current = s;
      const mime = [
          "audio/webm;codecs=opus",
          "audio/webm",
          "audio/ogg;codecs=opus",
        ].find((t) => MediaRecorder.isTypeSupported(t)),
        r = new MediaRecorder(s, mime ? { mimeType: mime } : {}),
        parts = [];
      recorder.current = r;
      r.ondataavailable = (e) => {
        if (e.data.size) parts.push(e.data);
      };
      r.onstop = () => {
        s.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (!r.discard)
          uploadFile(
            new File(
              parts,
              `语音-${Date.now()}.${r.mimeType.includes("ogg") ? "ogg" : "voice.webm"}`,
              { type: r.mimeType },
            ),
            cid,
          );
      };
      r.start();
      setRecording(true);
      recordTimer.current = setTimeout(() => stopRecording(), 60000);
    } catch (e) {
      showError(
        Error(e.name === "NotAllowedError" ? "请允许使用麦克风。" : e.message),
      );
    }
  }
  async function search(e) {
    e.preventDefault();
    if (active && query.trim())
      try {
        setResults(
          await request(
            `/search?conversation_id=${active.id}&q=${encodeURIComponent(query)}`,
          ),
        );
      } catch (e) {
        showError(e);
      }
  }
  async function openShared() {
    try {
      setShared(await request("/attachments?conversation_id=" + active.id));
    } catch (e) {
      showError(e);
    }
  }
  if (!session)
    return (
      <main className="login">
        <section className="intro">
          <div className="brand">
            <span className="logo">聊</span> 青聊 <small>QINGLIAO</small>
          </div>
          <div>
            <div className="eyebrow">STAY CLOSE. THINK TOGETHER.</div>
            <h1>
              想说的话，
              <br />
              现在就聊。
            </h1>
            <p>
              文字、图片、文件，或面对面的一声问候。
              <br />
              让沟通简单，让 AI 为讨论多想一步。
            </p>
            <div className="features">
              <span>文字与文件</span>
              <span>语音与视频</span>
              <span>RAG 与 Agent</span>
            </div>
          </div>
          <small>Windows 原生 C++ · 你的智能通信空间</small>
        </section>
        <form className="login-card" onSubmit={login}>
          <span className="tag">连接你和伙伴</span>
          <h2>{register ? "创建账号" : "欢迎回来"}</h2>
          <p>{register ? "创建你的青聊账号。" : "登录，开始今天的对话。"}</p>
          <label>
            用户名
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              minLength={2}
              maxLength={32}
              required
              autoComplete="username"
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              maxLength={128}
              required
              autoComplete={register ? "new-password" : "current-password"}
            />
          </label>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "请稍候…" : register ? "创建账号 →" : "进入会话 →"}
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setRegister(!register);
              setError("");
            }}
          >
            {register ? "已有账号？登录" : "还没有账号？注册"}
          </button>
          <small>可用无痕窗口登录第二个账号测试。</small>
        </form>
      </main>
    );
  return (
    <div
      className={
        "app wechat " +
        (assistant ? "with-assistant " : "") +
        (mobileChat ? "mobile-chat" : "")
      }
    >
      <nav className="rail">
        <span className="rail-avatar">{session.user.username.slice(0, 1)}</span>
        <button
          className={section === "chats" ? "rail-active" : ""}
          title="聊天"
          onClick={() => {
            setSection("chats");
            setMobileChat(false);
          }}
        >
          ☏<small>聊天</small>
        </button>
        <button
          className={section === "contacts" ? "rail-active" : ""}
          title="通讯录"
          onClick={() => {
            setSection("contacts");
            setMobileChat(false);
          }}
        >
          ♙<small>通讯录</small>
        </button>
        <button
          title="智能助手"
          className={assistant ? "rail-active" : ""}
          onClick={() => setAssistant(!assistant)}
        >
          ✦<small>智能助手</small>
        </button>
        <button
          className="rail-logout"
          title="退出登录"
          onClick={() => logout()}
        >
          ↗
        </button>
      </nav>
      <aside className="sidebar">
        <div className="list-title">
          <h2>{section === "contacts" ? "通讯录" : "青聊"}</h2>
          <span className="tag">{session.user.username}</span>
        </div>
        <div className="list-search">
          <span>⌕</span>
          <input
            aria-label="搜索联系人"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索联系人"
          />
          <button title="刷新列表" onClick={() => refresh().catch(showError)}>
            ↻
          </button>
        </div>
        <ProductPanel
          session={session}
          request={request}
          friends={users}
          active={active}
          onRefresh={refresh}
          onSelect={select}
          onSession={(value) => {
            tokenRef.current = value.token;
            sessionStorage.setItem("im-session", JSON.stringify(value));
            setSession(value);
          }}
          onError={showError}
        />
        {section === "chats" ? (
          <>
            <div className="conversation-list">
              {conversations
                .filter((c) =>
                  c.username.toLowerCase().includes(filter.toLowerCase()),
                )
                .map((c) => (
                  <button
                    key={c.id}
                    className={
                      "conversation " + (active?.id === c.id ? "selected" : "")
                    }
                    onClick={() => select(c)}
                  >
                    <span className="avatar">{c.username.slice(0, 1)}</span>
                    <span className="conversation-copy">
                      <strong>{c.username}</strong>
                      <small>
                        {c.last_message?.replace(/^📎\s*/, "[文件] ") ||
                          "开始聊天吧"}
                      </small>
                    </span>
                    <span className="conversation-extra">
                      <time>{time(c.last_time)}</time>
                      {Number(c.unread) > 0 && c.id !== active?.id && (
                        <b>{Number(c.unread) > 99 ? "99+" : c.unread}</b>
                      )}
                    </span>
                  </button>
                ))}
              {!conversations.length && (
                <div className="list-empty">
                  暂无聊天
                  <br />
                  <button
                    className="link"
                    onClick={() => setSection("contacts")}
                  >
                    去通讯录发起对话
                  </button>
                </div>
              )}
            </div>
            <h3>
              发起新会话 <span>{users.length} 位伙伴</span>
            </h3>
            <div className="users">
              {users
                .filter((u) =>
                  u.username.toLowerCase().includes(filter.toLowerCase()),
                )
                .map((u) => (
                  <button key={u.id} onClick={() => begin(u)}>
                    <span className="mini-avatar">
                      {u.username.slice(0, 1)}
                    </span>
                    {u.username}
                    <span>＋</span>
                  </button>
                ))}
              {!users.length && (
                <p className="muted">
                  用无痕窗口注册第二个账号，即可开始聊天。
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="contact-list">
            {users
              .filter((u) =>
                u.username.toLowerCase().includes(filter.toLowerCase()),
              )
              .map((u) => (
                <button
                  className="contact-row"
                  key={u.id}
                  onClick={() => begin(u)}
                >
                  <span className="avatar">{u.username.slice(0, 1)}</span>
                  <span>
                    {u.username}
                    <small>点击发起聊天</small>
                  </span>
                  <span>›</span>
                </button>
              ))}
          </div>
        )}
        <div className="sidebar-footer">
          <span className="online-dot" /> Windows · C++ 通信服务
        </div>
      </aside>
      <main
        className="chat"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!uploading && active) uploadFile(e.dataTransfer.files[0]);
        }}
      >
        <header>
          <div className="chat-title">
            <button
              className="back-button"
              onClick={() => setMobileChat(false)}
            >
              ‹
            </button>
            <div>
              <h2>
                {active?.username || "青聊"}
                {active?.kind === "group" && (
                  <small>（{active.member_count} 人）</small>
                )}
              </h2>
              <small className={"connection " + (connected ? "online" : "")}>
                {active
                  ? connected
                    ? "● 实时连接"
                    : "○ 正在连接"
                  : "选择一位伙伴开始"}
              </small>
            </div>
          </div>
          {active && (
            <div className="header-actions">
              <button
                title="搜索聊天记录"
                onClick={() => {
                  setSearchOpen(!searchOpen);
                  setResults(null);
                }}
              >
                ⌕
              </button>
              <button title="共享文件" onClick={openShared}>
                ▤
              </button>
              <button
                title="语音通话"
                disabled={!!calls.call || recording || active.kind === "group"}
                onClick={() => calls.start(active, "audio")}
              >
                ☎
              </button>
              <button
                title="视频通话"
                disabled={!!calls.call || recording || active.kind === "group"}
                onClick={() => calls.start(active, "video")}
              >
                ▣
              </button>
              <button
                title="打开智能助手"
                onClick={() => setAssistant(!assistant)}
              >
                ✦
              </button>
            </div>
          )}
        </header>
        {error && (
          <div className="error banner" role="alert">
            {error}
            <button onClick={() => setError("")}>×</button>
          </div>
        )}
        {notice && (
          <div className="notice">
            {notice}
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}
        {searchOpen && (
          <form className="message-search" onSubmit={search}>
            <input
              aria-label="搜索聊天记录"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入聊天关键词"
            />
            <button className="primary">搜索</button>
            <button
              type="button"
              onClick={() => {
                setSearchOpen(false);
                setResults(null);
              }}
            >
              关闭
            </button>
          </form>
        )}
        {results && (
          <div className="search-results">
            <strong>找到 {results.length} 条（最多 100 条）</strong>
            {results.map((m) => (
              <div key={m.id}>
                <small>
                  {m.username} · {m.created_at} UTC
                </small>
                <p>{m.content}</p>
              </div>
            ))}
          </div>
        )}
        {active ? (
          <>
            <div className="messages">
              <div className="day-label">
                聊天记录已保存 · 支持拖拽文件与粘贴图片
              </div>
              {messages.length > 0 && Number(messages[0].seq) > 1 && (
                <button
                  className="history"
                  onClick={async () => {
                    const cid = active.id;
                    try {
                      merge(
                        await request(
                          `/messages?conversation_id=${cid}&before=${messages[0].seq}`,
                        ),
                        cid,
                      );
                    } catch (e) {
                      showError(e);
                    }
                  }}
                >
                  加载更早消息
                </button>
              )}
              {messages.map((m) => (
                <article
                  key={m.id}
                  className={
                    "message " + (m.sender_id === session.user.id ? "mine" : "")
                  }
                >
                  <span className="message-avatar">
                    {m.username?.slice(0, 1)}
                  </span>
                  <div className="message-body">
                    <div className="message-meta">
                      {m.username} <time>{time(m.created_at)}</time>
                    </div>
                    <div className={"bubble " + (m.file_id ? "has-media" : "")}>
                      {m.file_id ? (
                        <MediaMessage
                          message={m}
                          token={token}
                          download={download}
                        />
                      ) : (
                        m.content
                      )}
                    </div>
                    <small>
                      #{m.seq}
                      {m.sender_id === session.user.id ? " · 已发送" : ""}
                      {m.sender_id === session.user.id &&
                        m.recalled !== "1" &&
                        Date.now() -
                          new Date(
                            m.created_at.replace(" ", "T") + "Z",
                          ).getTime() <
                          120000 && (
                          <button
                            className="recall-button"
                            onClick={async () => {
                              try {
                                const changed = await request(
                                  "/messages/recall",
                                  { id: m.id },
                                );
                                merge([changed]);
                              } catch (error) {
                                showError(error);
                              }
                            }}
                          >
                            撤回
                          </button>
                        )}
                    </small>
                  </div>
                </article>
              ))}
              {pending
                .filter(
                  (p) =>
                    p.owner === session.user.id &&
                    p.conversation_id === active.id,
                )
                .map((p) => (
                  <article className="message mine" key={p.client_message_id}>
                    <span className="message-avatar">
                      {session.user.username.slice(0, 1)}
                    </span>
                    <div className="message-body">
                      <div className="bubble">{p.content}</div>
                      <small>
                        {p.status === "failed" ? (
                          <button className="link" onClick={() => transmit(p)}>
                            发送失败 · 点击重试
                          </button>
                        ) : (
                          "发送中…"
                        )}
                      </small>
                    </div>
                  </article>
                ))}
              {!messages.length && (
                <div className="empty">
                  <span>☏</span>
                  <h3>从一句你好开始</h3>
                  <p>可以发送消息、图片和文件，也可以直接通话。</p>
                </div>
              )}
              <div ref={bottom} />
            </div>
            <div className="composer">
              <div className="composer-tools">
                <button title="表情" onClick={() => setEmoji(!emoji)}>
                  ☺
                </button>
                <button
                  title="发送文件"
                  disabled={uploading}
                  onClick={() => fileInput.current.click()}
                >
                  ▱
                </button>
                <button
                  title="发送图片"
                  disabled={uploading}
                  onClick={() => imageInput.current.click()}
                >
                  ▧
                </button>
                <button
                  title="发送视频文件"
                  disabled={uploading}
                  onClick={() => videoInput.current.click()}
                >
                  ▷
                </button>
                <button
                  title={recording ? "停止录音并发送" : "录制语音消息"}
                  className={recording ? "recording" : ""}
                  disabled={uploading || !!calls.call}
                  onClick={record}
                >
                  ♩
                </button>
                <span />
                {uploading && (
                  <small>
                    {transferStage} {percent}%{" "}
                    <button onClick={() => xhrRef.current?.abort()}>
                      暂停
                    </button>
                  </small>
                )}
                {!uploading && lastUpload.current && (
                  <button
                    className="link"
                    onClick={() =>
                      uploadFile(
                        lastUpload.current.file,
                        lastUpload.current.cid,
                      )
                    }
                  >
                    继续上传
                  </button>
                )}
                {downloadPercent !== null && (
                  <small>
                    下载 {downloadPercent}%{" "}
                    <button onClick={() => downloadController.current?.abort()}>
                      暂停下载
                    </button>
                  </small>
                )}
                {recording && (
                  <small className="recording">
                    正在录音 · 点击音符停止发送{" "}
                    <button onClick={() => stopRecording(true)}>取消</button>
                  </small>
                )}
              </div>
              {emoji && (
                <div className="emoji-picker">
                  {"😀 😄 😂 😊 🥰 😎 🤔 😭 👍 👏 🙏 🎉 ❤️ ✅"
                    .split(" ")
                    .map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setDraft((d) => d + s);
                          setEmoji(false);
                        }}
                      >
                        {s}
                      </button>
                    ))}
                </div>
              )}
              <input type="file" hidden ref={fileInput} onChange={upload} />
              <input
                type="file"
                hidden
                accept="image/png,image/jpeg,image/gif,image/webp"
                ref={imageInput}
                onChange={upload}
              />
              <input
                type="file"
                hidden
                accept="video/mp4,video/webm,video/quicktime"
                ref={videoInput}
                onChange={upload}
              />
              <textarea
                value={draft}
                maxLength={4000}
                onChange={(e) => setDraft(e.target.value)}
                onPaste={(e) => {
                  const f = [...e.clipboardData.items]
                    .find((i) => i.kind === "file")
                    ?.getAsFile();
                  if (f && !uploading) {
                    e.preventDefault();
                    uploadFile(f);
                  }
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="写点什么…"
              />
              <div className="composer-bottom">
                <small>
                  Enter 发送 · Shift + Enter 换行 · 分片续传最大 1 GB
                </small>
                <button
                  className="primary"
                  disabled={!draft.trim()}
                  onClick={() => send()}
                >
                  发送 ↑
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty welcome">
            <span>☏</span>
            <h2>青聊，随时相连</h2>
            <p>
              文字、图片、文件、语音与视频
              <br />
              选择左侧联系人，开始一段对话。
            </p>
          </div>
        )}
      </main>
      {assistant && (
        <AIPanel
          active={active}
          request={request}
          download={download}
          onError={showError}
          onClose={() => setAssistant(false)}
        />
      )}
      <CallOverlay manager={calls} />
      {shared && (
        <div className="modal-backdrop" onClick={() => setShared(null)}>
          <section
            className="shared-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h3>共享文件</h3>
              <button onClick={() => setShared(null)}>×</button>
            </header>
            {shared.length ? (
              shared.map((f) => (
                <button
                  className="shared-file"
                  key={f.id}
                  onClick={() => download(f.id, f.name)}
                >
                  <span>{fileKind(f.name) === "image" ? "▧" : "▤"}</span>
                  <div>
                    <strong>{f.name}</strong>
                    <small>
                      {(Number(f.size) / 1024).toFixed(1)} KB · {f.created_at}{" "}
                      UTC
                    </small>
                  </div>
                  <span>↓</span>
                </button>
              ))
            ) : (
              <p className="muted">当前会话暂无文件。</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
