import React, { useCallback, useEffect, useRef, useState } from "react";

export function useCall(session, request, report) {
  const [call, setCall] = useState(null);
  const [local, setLocal] = useState(null),
    [remote, setRemote] = useState(null);
  const [muted, setMuted] = useState(false),
    [cameraOff, setCameraOff] = useState(false);
  const [seconds, setSeconds] = useState(0),
    [relay, setRelay] = useState(false);
  const current = useRef(null),
    pc = useRef(null),
    stream = useRef(null),
    remoteStream = useRef(null);
  const api = useRef(request),
    error = useRef(report),
    epoch = useRef(0),
    outgoing = useRef([]),
    incoming = useRef(new Map());
  const started = useRef(0),
    processed = useRef(new Set()),
    acceptPending = useRef(false);
  api.current = request;
  error.current = report;
  const change = useCallback((value) => {
    current.current = value;
    setCall(value);
  }, []);
  const cleanup = useCallback(() => {
    epoch.current++;
    acceptPending.current = false;
    if (pc.current) {
      pc.current.onconnectionstatechange = null;
      pc.current.onicecandidate = null;
      pc.current.ontrack = null;
      pc.current.close();
      pc.current = null;
    }
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    remoteStream.current = null;
    outgoing.current = [];
    incoming.current.clear();
    setLocal(null);
    setRemote(null);
    change(null);
    setMuted(false);
    setCameraOff(false);
    setSeconds(0);
    started.current = 0;
  }, [change]);
  const signal = useCallback(
    (action, extra = {}, id = current.current?.id) =>
      id
        ? api.current("/calls", { action, call_id: id, ...extra })
        : Promise.resolve(),
    [],
  );
  const finish = useCallback(
    async (reject = false) => {
      const id = current.current?.id;
      cleanup();
      if (id) {
        try {
          await signal(reject ? "reject" : "hangup", {}, id);
        } catch (e) {
          error.current(e);
        }
      }
    },
    [cleanup, signal],
  );
  async function flushOutgoing(id) {
    const queued = outgoing.current.splice(0);
    for (const candidate of queued)
      await signal("candidate", { candidate }, id);
  }
  async function flushIncoming(id) {
    if (!pc.current?.remoteDescription) return;
    const queued = incoming.current.get(id) || [];
    incoming.current.delete(id);
    for (const candidate of queued)
      await pc.current?.addIceCandidate(candidate);
  }
  async function makePeer(kind, ticket) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error("语音视频需要 localhost 或 HTTPS 安全连接。");
    const config = await api.current("/rtc-config");
    const media = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video:
        kind === "video"
          ? {
              width: { ideal: 960 },
              height: { ideal: 540 },
              facingMode: "user",
            }
          : false,
    });
    if (ticket !== epoch.current) {
      media.getTracks().forEach((t) => t.stop());
      throw new Error("呼叫已取消");
    }
    stream.current = media;
    setLocal(media);
    setRelay(config.relayConfigured);
    const peer = new RTCPeerConnection({ iceServers: config.iceServers });
    pc.current = peer;
    const remoteMedia = new MediaStream();
    remoteStream.current = remoteMedia;
    setRemote(remoteMedia);
    media.getTracks().forEach((track) => peer.addTrack(track, media));
    peer.ontrack = (event) => {
      if (!remoteMedia.getTracks().some((t) => t.id === event.track.id))
        remoteMedia.addTrack(event.track);
      setRemote(new MediaStream(remoteMedia.getTracks()));
    };
    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      const candidate = event.candidate.toJSON(),
        id = current.current?.id;
      if (id)
        signal("candidate", { candidate }, id).catch((e) => error.current(e));
      else outgoing.current.push(candidate);
    };
    peer.onconnectionstatechange = () => {
      if (ticket !== epoch.current) return;
      if (peer.connectionState === "connected") {
        started.current ||= Date.now();
        change({ ...current.current, phase: "connected" });
      }
      if (peer.connectionState === "failed") {
        error.current(
          new Error("通话连接失败。跨网络通话可能需要配置 TURN 中继。"),
        );
        finish();
      }
      if (peer.connectionState === "disconnected")
        change({ ...current.current, phase: "reconnecting" });
    };
    return peer;
  }
  async function start(conversation, kind) {
    if (current.current) return;
    const ticket = ++epoch.current;
    change({
      phase: "preparing",
      kind,
      conversation_id: conversation.id,
      peer: conversation.username,
    });
    try {
      const peer = await makePeer(kind, ticket);
      await peer.setLocalDescription(await peer.createOffer());
      if (ticket !== epoch.current) return;
      const created = await api.current("/calls", {
        action: "invite",
        conversation_id: conversation.id,
        kind,
        offer: peer.localDescription.toJSON(),
      });
      if (ticket !== epoch.current) {
        signal("hangup", {}, created.id).catch(() => {});
        return;
      }
      change({ ...created, peer: conversation.username, phase: "outgoing" });
      await flushOutgoing(created.id);
    } catch (e) {
      if (ticket === epoch.current) {
        cleanup();
        error.current(
          new Error(
            e.name === "NotAllowedError"
              ? "请允许使用麦克风和摄像头。"
              : e.message,
          ),
        );
      }
    }
  }
  async function accept() {
    const initial = current.current;
    if (!initial || initial.phase !== "incoming" || acceptPending.current)
      return;
    acceptPending.current = true;
    const ticket = ++epoch.current;
    change({ ...initial, phase: "connecting" });
    try {
      const peer = await makePeer(initial.kind, ticket);
      await peer.setRemoteDescription(JSON.parse(initial.offer));
      await flushIncoming(initial.id);
      await peer.setLocalDescription(await peer.createAnswer());
      if (ticket !== epoch.current) return;
      const result = await signal(
        "accept",
        { answer: peer.localDescription.toJSON() },
        initial.id,
      );
      if (result.status && result.status !== "active")
        throw new Error("对方已结束呼叫");
      await flushOutgoing(initial.id);
    } catch (e) {
      if (ticket === epoch.current) {
        error.current(e);
        finish();
      }
    } finally {
      acceptPending.current = false;
    }
  }
  const handler = useRef(null);
  handler.current = async (event) => {
    const id = event.call_id;
    if (event.event === "candidate") {
      if (current.current?.id !== id) return;
      const candidate = JSON.parse(event.payload);
      if (pc.current?.remoteDescription)
        await pc.current.addIceCandidate(candidate);
      else
        incoming.current.set(id, [
          ...(incoming.current.get(id) || []),
          candidate,
        ]);
    } else if (event.event === "invite") {
      const data = await api.current("/calls?id=" + id);
      if (data.status !== "ringing" || data.callee_id !== session?.user.id)
        return;
      if (current.current) {
        if (current.current.id !== id) signal("reject", {}, id).catch(() => {});
        return;
      }
      change({ ...data, peer: data.caller_name, phase: "incoming" });
    } else if (event.event === "accept" && current.current?.id === id) {
      const data = await api.current("/calls?id=" + id);
      if (data.status !== "active" || !pc.current) return;
      if (!pc.current.remoteDescription)
        await pc.current.setRemoteDescription(JSON.parse(data.answer));
      await flushIncoming(id);
      if (current.current?.phase === "outgoing")
        change({ ...current.current, phase: "connecting" });
    } else if (event.event === "end" && current.current?.id === id) cleanup();
  };
  useEffect(() => {
    if (!session?.token) {
      cleanup();
      return;
    }
    let disposed = false,
      ws,
      timer,
      retry,
      cursor = 0,
      chain = Promise.resolve();
    processed.current.clear();
    function consume(rows) {
      if (disposed) return;
      for (const event of rows) {
        cursor = Math.max(cursor, Number(event.id));
        if (processed.current.has(event.id)) continue;
        processed.current.add(event.id);
        chain = chain
          .then(() => !disposed && handler.current(event))
          .catch((e) => error.current(e));
      }
      if (processed.current.size > 2000)
        processed.current = new Set([...processed.current].slice(-500));
    }
    function connect() {
      if (disposed) return;
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws?events=1&after=${cursor}`,
      );
      ws.onopen = () =>
        ws.send(JSON.stringify({ type: "auth", token: session.token }));
      ws.onmessage = (event) => {
        try {
          const value = JSON.parse(event.data);
          if (value.type === "events") consume(value.data);
        } catch {}
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (!disposed) retry = setTimeout(connect, 2500);
      };
    }
    async function bootstrap() {
      try {
        const value = await api.current("/calls");
        if (disposed) return;
        cursor = Number(value.cursor);
        // A page reload cannot recover a lost RTCPeerConnection. End stale active calls explicitly.
        if (
          value.active?.status === "ringing" &&
          value.active.callee_id === session.user.id
        )
          change({
            ...value.active,
            peer: value.active.caller_name,
            phase: "incoming",
          });
        else if (value.active) await signal("hangup", {}, value.active.id);
        connect();
        timer = setInterval(
          () =>
            api
              .current("/events?after=" + cursor)
              .then(consume)
              .catch(() => {}),
          1500,
        );
      } catch (e) {
        if (!disposed) error.current(e);
      }
    }
    bootstrap();
    return () => {
      disposed = true;
      clearInterval(timer);
      clearTimeout(retry);
      ws?.close();
      const id = current.current?.id;
      if (id) signal("hangup", {}, id).catch(() => {});
      cleanup();
    };
  }, [session?.token, cleanup, change, signal]);
  useEffect(() => {
    if (!call) return;
    let ticks = 0;
    const timer = setInterval(() => {
      if (started.current)
        setSeconds(Math.floor((Date.now() - started.current) / 1000));
      const c = current.current;
      if (!c?.id) return;
      if (++ticks % 5 === 0)
        api
          .current("/calls?id=" + c.id)
          .then((data) => {
            if (
              current.current?.id === c.id &&
              !["ringing", "active"].includes(data.status)
            ) {
              cleanup();
              if (data.status === "missed")
                error.current(new Error("对方未接听或通话连接已超时"));
            }
          })
          .catch(() => {});
      if (ticks % 10 === 0) signal("heartbeat").catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [call?.id, cleanup, signal]);
  function toggleMute() {
    const value = !muted;
    stream.current?.getAudioTracks().forEach((t) => (t.enabled = !value));
    setMuted(value);
  }
  function toggleCamera() {
    const value = !cameraOff;
    stream.current?.getVideoTracks().forEach((t) => (t.enabled = !value));
    setCameraOff(value);
  }
  return {
    call,
    local,
    remote,
    muted,
    cameraOff,
    seconds,
    relay,
    start,
    accept,
    finish,
    toggleMute,
    toggleCamera,
  };
}

export function CallOverlay({ manager }) {
  const { call, local, remote } = manager;
  const localVideo = useRef(null),
    remoteVideo = useRef(null);
  useEffect(() => {
    if (localVideo.current) localVideo.current.srcObject = local;
  }, [local, call?.kind]);
  useEffect(() => {
    if (remoteVideo.current) {
      remoteVideo.current.srcObject = remote;
      remoteVideo.current.play().catch(() => {});
    }
  }, [remote, call?.kind]);
  if (!call) return null;
  const phase = {
    preparing: "正在打开设备…",
    incoming: "邀请你进行" + (call.kind === "video" ? "视频" : "语音") + "通话",
    outgoing: "等待对方接听…",
    connecting: "正在建立连接…",
    connected: "通话中",
    reconnecting: "网络波动，正在重连…",
  }[call.phase];
  const duration = `${Math.floor(manager.seconds / 60)
    .toString()
    .padStart(2, "0")}:${(manager.seconds % 60).toString().padStart(2, "0")}`;
  return (
    <div
      className="call-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={call.kind === "video" ? "视频通话" : "语音通话"}
    >
      <div
        className={"call-window " + (call.kind === "video" ? "video-call" : "")}
      >
        <div className="call-top">
          <span>{call.kind === "video" ? "▣ 视频通话" : "☎ 语音通话"}</span>
          <span data-testid="call-phase">{phase}</span>
        </div>
        <div className="call-stage">
          <video
            ref={remoteVideo}
            autoPlay
            playsInline
            className={
              "remote-video " + (call.kind === "audio" ? "audio-only" : "")
            }
          />
          {(call.phase !== "connected" || call.kind === "audio") && (
            <div className="call-person">
              <div className="call-avatar">{call.peer?.slice(0, 1)}</div>
              <h2>{call.peer}</h2>
              <p>{phase}</p>
            </div>
          )}
          {call.kind === "video" && local && (
            <video
              ref={localVideo}
              autoPlay
              playsInline
              muted
              className="local-video"
            />
          )}
        </div>
        <div className="call-duration">{manager.seconds ? duration : ""}</div>
        <div className="call-actions">
          {call.phase === "incoming" ? (
            <>
              <button
                className="call-control decline"
                onClick={() => manager.finish(true)}
              >
                ✕<small>拒绝</small>
              </button>
              <button className="call-control accept" onClick={manager.accept}>
                ☎<small>接听</small>
              </button>
            </>
          ) : (
            <>
              <button
                className={"call-control " + (manager.muted ? "toggled" : "")}
                onClick={manager.toggleMute}
                aria-label="切换麦克风"
              >
                {manager.muted ? "♩" : "♫"}
                <small>{manager.muted ? "取消静音" : "静音"}</small>
              </button>
              <button
                className="call-control decline"
                onClick={() => manager.finish()}
              >
                ☎<small>挂断</small>
              </button>
              {call.kind === "video" && (
                <button
                  className={
                    "call-control " + (manager.cameraOff ? "toggled" : "")
                  }
                  onClick={manager.toggleCamera}
                >
                  ▣
                  <small>
                    {manager.cameraOff ? "开启摄像头" : "关闭摄像头"}
                  </small>
                </button>
              )}
            </>
          )}
        </div>
        {!manager.relay && (
          <small className="call-network-note">
            使用点对点连接；跨网络连接失败时需配置 TURN 中继。
          </small>
        )}
      </div>
    </div>
  );
}
