const CHUNK = 4 * 1024 * 1024;
const hex = (buffer) =>
  [...new Uint8Array(buffer)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const aborted = (signal) => {
  if (signal.aborted) throw new DOMException("上传已暂停", "AbortError");
};
export async function uploadResumable(
  file,
  cid,
  request,
  token,
  { signal, onProgress = () => {} },
) {
  if (!file.size || file.size > 1024 * 1024 * 1024)
    throw Error("文件须为 1 字节至 1 GB");
  const hashes = [],
    count = Math.ceil(file.size / CHUNK);
  for (let i = 0; i < count; i++) {
    aborted(signal);
    hashes.push(
      hex(
        await crypto.subtle.digest(
          "SHA-256",
          await file.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer(),
        ),
      ),
    );
    onProgress({
      stage: "校验文件",
      percent: Math.round(((i + 1) / count) * 100),
    });
  }
  aborted(signal);
  const task = await request("/uploads/init", {
    conversation_id: cid,
    name: file.name,
    size: file.size,
    chunk_hashes: hashes,
  });
  localStorage.setItem(
    "im-resume-upload",
    JSON.stringify({
      name: file.name,
      size: file.size,
      conversation_id: cid,
      id: task.id,
    }),
  );
  if (task.state === "completed") {
    localStorage.removeItem("im-resume-upload");
    return { id: task.id, name: file.name };
  }
  const completed = new Set(task.parts.map((x) => Number(x.part)));
  for (let i = 0; i < count; i++) {
    aborted(signal);
    if (!completed.has(i)) {
      let sent = false;
      for (let attempt = 0; attempt < 4 && !sent; attempt++) {
        aborted(signal);
        try {
          const response = await fetch(
            `/api/uploads/chunk?id=${task.id}&part=${i}`,
            {
              method: "POST",
              headers: {
                Authorization: "Bearer " + token,
                "Content-Type": "application/octet-stream",
              },
              body: file.slice(i * CHUNK, (i + 1) * CHUNK),
              signal,
            },
          );
          const result = await response.json();
          if (!response.ok) {
            const error = Error(
              result.error || `分片上传失败（${response.status}）`,
            );
            error.permanent = response.status < 500 && response.status !== 429;
            throw error;
          }
          sent = true;
        } catch (error) {
          if (error.name === "AbortError" || error.permanent || attempt === 3)
            throw error;
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * 2 ** attempt),
          );
        }
      }
    }
    onProgress({
      stage: "上传分片",
      percent: Math.round(((i + 1) / count) * 100),
    });
  }
  aborted(signal);
  onProgress({ stage: "合并校验", percent: 100 });
  const result = await request("/uploads/complete", { id: task.id });
  localStorage.removeItem("im-resume-upload");
  return result;
}
