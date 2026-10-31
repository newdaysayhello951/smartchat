import React, { useState } from "react";
export default function RtcDiagnostics({ request }) {
  const [result, setResult] = useState(null),
    [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    let peer;
    try {
      const config = await request("/rtc-config");
      peer = new RTCPeerConnection({
        iceServers: config.iceServers,
        iceTransportPolicy: config.relayConfigured ? "relay" : "all",
      });
      const types = new Set(),
        errors = [];
      peer.onicecandidate = (e) => {
        if (e.candidate) types.add(e.candidate.type);
      };
      peer.onicecandidateerror = (e) =>
        errors.push({ code: e.errorCode, message: e.errorText });
      peer.createDataChannel("connectivity-test");
      await peer.setLocalDescription(await peer.createOffer());
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 12000);
        peer.onicegatheringstatechange = () => {
          if (peer.iceGatheringState === "complete") {
            clearTimeout(timer);
            resolve();
          }
        };
      });
      setResult({
        secureContext: window.isSecureContext,
        mediaSupported: !!navigator.mediaDevices?.getUserMedia,
        turnConfigured: config.relayConfigured,
        candidateTypes: [...types],
        relayAllocation: types.has("relay"),
        errors,
        note: config.relayConfigured
          ? types.has("relay")
            ? "已成功分配 TURN 中继候选；还需两台设备实际通话验收。"
            : "已配置 TURN，但没有分配到中继候选，请检查账号、端口和服务器。"
          : "尚未配置 TURN。当前只能测试直连候选，不能保证跨运营商通话。",
      });
    } catch (error) {
      setResult({ error: error.message });
    } finally {
      peer?.close();
      setBusy(false);
    }
  }
  return (
    <div className="rtc-diagnostics">
      <p>
        此检查不打开摄像头或麦克风。配置中继后会强制只收集中继候选，验证 TURN
        是否可用。
      </p>
      <button className="primary" disabled={busy} onClick={run}>
        {busy ? "正在检查（最多 12 秒）…" : "检查音视频网络"}
      </button>
      {result && (
        <>
          <p>{result.note || result.error}</p>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </>
      )}
    </div>
  );
}
