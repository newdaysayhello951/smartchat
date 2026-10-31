import React, { useEffect, useRef, useState } from "react";
import RtcDiagnostics from "./RtcDiagnostics.jsx";

export default function ProductPanel({
  session,
  request,
  friends,
  active,
  onRefresh,
  onSelect,
  onSession,
  onError,
}) {
  const [view, setView] = useState(""),
    [requests, setRequests] = useState([]),
    [query, setQuery] = useState(""),
    [people, setPeople] = useState([]),
    [note, setNote] = useState(""),
    [title, setTitle] = useState(""),
    [chosen, setChosen] = useState([]),
    [group, setGroup] = useState(null),
    [old, setOld] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false);
  const api = useRef(request);
  api.current = request;
  useEffect(() => {
    let closed = false;
    async function refresh() {
      try {
        const rows = await api.current("/friend-requests");
        if (!closed) setRequests(rows);
      } catch {}
    }
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => {
      closed = true;
      clearInterval(timer);
    };
  }, [session.token]);
  const pending = requests.filter(
    (x) => x.state === "pending" && x.target_id === session.user.id,
  );
  async function perform(action) {
    setBusy(true);
    try {
      await action();
      await onRefresh();
      setRequests(await api.current("/friend-requests"));
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  async function search(e) {
    e.preventDefault();
    perform(async () =>
      setPeople(await api.current("/directory?q=" + encodeURIComponent(query))),
    );
  }
  async function openGroup() {
    perform(async () => {
      setGroup(
        await api.current("/group-members?conversation_id=" + active.id),
      );
      setView("members");
    });
  }
  async function groupAction(action, extra = {}) {
    await api.current("/group-members", {
      conversation_id: active.id,
      action,
      ...extra,
    });
    if (action === "leave") {
      setView("");
      onSelect(null);
    } else {
      const value = await api.current(
        "/group-members?conversation_id=" + active.id,
      );
      setGroup(value);
    }
  }
  const owner = group?.owner_id === session.user.id;
  return (
    <>
      <div className="product-buttons">
        <button onClick={() => setView("friends")}>
          ＋ 添加好友{pending.length > 0 && <b>{pending.length}</b>}
        </button>
        <button
          onClick={() => {
            setChosen([]);
            setTitle("");
            setView("create");
          }}
        >
          ♙ 新建群聊
        </button>
        <button onClick={() => setView("password")}>⚙ 修改密码</button>
        <button onClick={() => setView("network")}>音视频网络诊断</button>
        {active?.kind === "group" && (
          <button onClick={openGroup}>群成员 / 管理</button>
        )}
      </div>
      {view && (
        <div className="modal-backdrop" onClick={() => setView("")}>
          <section
            className="product-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h3>
                {
                  {
                    friends: "好友申请与添加",
                    create: "创建群聊",
                    members: "群成员与管理",
                    password: "修改密码",
                    network: "音视频网络诊断",
                  }[view]
                }
              </h3>
              <button onClick={() => setView("")}>×</button>
            </header>
            {view === "network" && <RtcDiagnostics request={request} />}
            {view === "friends" && (
              <>
                <form className="inline-form" onSubmit={search}>
                  <input
                    aria-label="查找用户"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="输入用户名查找用户"
                    minLength={2}
                    required
                  />
                  <button className="primary" disabled={busy}>
                    查找
                  </button>
                </form>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="好友申请留言（可选）"
                  maxLength={80}
                />
                {people.map((person) => (
                  <div className="person-row" key={person.id}>
                    <span className="avatar">
                      {person.username.slice(0, 1)}
                    </span>
                    <span>{person.username}</span>
                    <button
                      className="primary"
                      disabled={busy || person.is_friend === "1"}
                      onClick={() =>
                        perform(async () => {
                          const result = await api.current("/friend-requests", {
                            user_id: person.id,
                            note,
                          });
                          onError("");
                          setPeople((old) =>
                            old.map((p) =>
                              p.id === person.id
                                ? { ...p, requested: true }
                                : p,
                            ),
                          );
                        })
                      }
                    >
                      {person.is_friend === "1"
                        ? "已是好友"
                        : person.requested
                          ? "已申请"
                          : "申请添加"}
                    </button>
                  </div>
                ))}
                <h4>收到的好友申请</h4>
                {pending.length ? (
                  pending.map((item) => (
                    <div className="request-row" key={item.id}>
                      <strong>{item.sender_name}</strong>
                      <p>{item.note || "对方申请添加你为好友"}</p>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          perform(() =>
                            api.current("/friend-requests", {
                              action: "accept",
                              id: item.id,
                            }),
                          )
                        }
                      >
                        同意
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          perform(() =>
                            api.current("/friend-requests", {
                              action: "reject",
                              id: item.id,
                            }),
                          )
                        }
                      >
                        拒绝
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="muted">暂无待处理申请。</p>
                )}
                <h4>最近申请记录</h4>
                {requests.slice(0, 10).map((item) => (
                  <p className="request-status" key={item.id}>
                    {item.sender_name} → {item.target_name} ·{" "}
                    {
                      {
                        pending: "待处理",
                        accepted: "已同意",
                        rejected: "已拒绝",
                      }[item.state]
                    }
                  </p>
                ))}
              </>
            )}
            {view === "create" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  perform(async () => {
                    const value = await api.current("/groups", {
                      title,
                      user_ids: chosen,
                    });
                    onSelect(value);
                    setView("");
                  });
                }}
              >
                <label>
                  群名称
                  <input
                    aria-label="群名称"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    maxLength={40}
                  />
                </label>
                <p className="muted">
                  选择好友入群，最多 50 人。新成员可查看群内历史。
                </p>
                <div className="member-choices">
                  {friends.map((friend) => (
                    <label key={friend.id}>
                      <input
                        type="checkbox"
                        checked={chosen.includes(friend.id)}
                        onChange={(e) =>
                          setChosen((old) =>
                            e.target.checked
                              ? [...old, friend.id]
                              : old.filter((id) => id !== friend.id),
                          )
                        }
                      />
                      {friend.username}
                    </label>
                  ))}
                </div>
                {!friends.length && <p>请先添加好友。</p>}
                <button className="primary" disabled={busy || !chosen.length}>
                  创建群聊（{chosen.length + 1} 人）
                </button>
              </form>
            )}
            {view === "members" && group && (
              <>
                <p>
                  {group.title} · {group.members.length} 人
                </p>
                {group.members.map((person) => (
                  <div className="person-row" key={person.id}>
                    <span className="avatar">
                      {person.username.slice(0, 1)}
                    </span>
                    <span>
                      {person.username}
                      {person.id === group.owner_id ? "（群主）" : ""}
                    </span>
                    {owner && person.id !== session.user.id && (
                      <>
                        <button
                          onClick={() =>
                            perform(() =>
                              groupAction("remove", { user_id: person.id }),
                            )
                          }
                        >
                          移出
                        </button>
                        <button
                          onClick={() =>
                            perform(() =>
                              groupAction("transfer", { user_id: person.id }),
                            )
                          }
                        >
                          转让群主
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {owner && (
                  <>
                    <form
                      className="inline-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        perform(() => groupAction("rename", { title }));
                      }}
                    >
                      <input
                        aria-label="新群名称"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="输入新群名称"
                        required
                        maxLength={40}
                      />
                      <button className="primary">改名</button>
                    </form>
                    <h4>邀请好友</h4>
                    {friends
                      .filter((f) => !group.members.some((m) => m.id === f.id))
                      .map((friend) => (
                        <div className="person-row" key={friend.id}>
                          <span>{friend.username}</span>
                          <button
                            disabled={busy}
                            onClick={() =>
                              perform(() =>
                                groupAction("add", { user_id: friend.id }),
                              )
                            }
                          >
                            邀请入群
                          </button>
                        </div>
                      ))}
                  </>
                )}
                <button
                  className="danger"
                  disabled={busy || owner}
                  onClick={() => perform(() => groupAction("leave"))}
                >
                  {owner ? "群主需先转让再退出" : "退出群聊"}
                </button>
              </>
            )}
            {view === "password" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (password !== confirmation) {
                    onError(Error("两次输入的新密码不一致"));
                    return;
                  }
                  (async () => {
                    setBusy(true);
                    try {
                      const value = await api.current("/password", {
                        old_password: old,
                        new_password: password,
                      });
                      onSession(value);
                      setOld("");
                      setPassword("");
                      setConfirmation("");
                      setView("");
                      onError("");
                    } catch (error) {
                      onError(error);
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                <p className="muted">
                  修改后其他设备会退出登录，当前窗口更新登录凭据。
                </p>
                <label>
                  原密码
                  <input
                    aria-label="原密码"
                    type="password"
                    value={old}
                    onChange={(e) => setOld(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </label>
                <label>
                  新密码
                  <input
                    aria-label="新密码"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    maxLength={128}
                    required
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  确认新密码
                  <input
                    aria-label="确认新密码"
                    type="password"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    minLength={8}
                    required
                    autoComplete="new-password"
                  />
                </label>
                <button className="primary" disabled={busy}>
                  确认修改
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </>
  );
}
