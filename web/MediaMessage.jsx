import React, { useEffect, useState } from "react";
export function fileKind(name) {
  return /\.voice\.webm$|\.(mp3|wav|ogg|m4a)$/i.test(name)
    ? "audio"
    : /\.(png|jpe?g|gif|webp)$/i.test(name)
      ? "image"
      : /\.(mp4|webm|mov)$/i.test(name)
        ? "video"
        : "file";
}
export default function MediaMessage({ message, token, download }) {
  const name = message.content.replace(/^📎\s*/, ""),
    kind = fileKind(name);
  const [url, setUrl] = useState(""),
    [expanded, setExpanded] = useState(false),
    [failed, setFailed] = useState(false),
    [large, setLarge] = useState(false);
  useEffect(() => {
    if (kind === "file") return;
    const controller = new AbortController();
    let objectUrl = "";
    fetch(`/api/file-info?id=${message.file_id}`, {
      headers: { Authorization: "Bearer " + token },
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error("加载失败");
        const info = await r.json();
        if (Number(info.size) > 32 * 1024 * 1024) {
          setLarge(true);
          return;
        }
        const response = await fetch(
          `/api/files?id=${message.file_id}&inline=1`,
          {
            headers: { Authorization: "Bearer " + token },
            signal: controller.signal,
          },
        );
        if (!response.ok) throw Error("加载失败");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [message.file_id, token, kind]);
  useEffect(() => {
    if (!expanded) return;
    const f = (e) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [expanded]);
  return (
    <div className={"media-message " + kind}>
      {kind === "image" && url && (
        <button
          className="image-preview"
          onClick={() => setExpanded(true)}
          aria-label={"查看图片 " + name}
        >
          <img src={url} alt={name} />
        </button>
      )}
      {kind === "video" && url && (
        <video
          src={url}
          controls
          playsInline
          preload="metadata"
          aria-label={name}
        />
      )}
      {kind === "audio" && url && (
        <audio src={url} controls aria-label="语音消息" />
      )}
      {kind !== "file" && !url && (
        <small>
          {large
            ? "大于 32 MB 的媒体请下载后查看，避免占用过多浏览器内存"
            : failed
              ? "预览失败，可下载查看"
              : "正在加载媒体…"}
        </small>
      )}
      {kind === "file" && (
        <div className="file-card">
          <span>▤</span>
          <div>
            <strong>{name}</strong>
            <small>{name.split(".").pop().toUpperCase()} · 文件</small>
          </div>
        </div>
      )}
      <button
        className="file-link"
        onClick={() => download(message.file_id, name)}
      >
        ↓ {kind === "file" ? "下载文件" : name}
      </button>
      {expanded && (
        <div
          className="image-lightbox"
          role="dialog"
          aria-label="图片预览"
          onClick={() => setExpanded(false)}
        >
          <button>✕ 关闭</button>
          <img src={url} alt={name} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
