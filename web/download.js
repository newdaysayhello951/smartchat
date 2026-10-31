const CHUNK = 4 * 1024 * 1024;
const hex = (b) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
function db() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("qingliao-downloads", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function stored(id, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
        "files",
        value ? "readwrite" : "readonly",
      ),
      store = transaction.objectStore("files"),
      request = value ? store.put(value, id) : store.get(id);
    request.onsuccess = () => {
      const result = request.result;
      transaction.oncomplete = () => {
        database.close();
        resolve(result);
      };
    };
    request.onerror = () => {
      database.close();
      reject(request.error);
    };
  });
}
export async function downloadResumable(
  id,
  name,
  token,
  { signal, onProgress = () => {} },
) {
  let entry = await stored(id);
  let handle = entry?.handle;
  if (
    handle &&
    handle.queryPermission &&
    (await handle.queryPermission({ mode: "readwrite" })) !== "granted" &&
    (await handle.requestPermission({ mode: "readwrite" })) !== "granted"
  )
    handle = null;
  if (!handle) {
    handle = await window.showSaveFilePicker({
      suggestedName: name.replace(/^📎\s*/, ""),
    });
    entry = { handle, offset: 0 };
  }
  const headers = { Authorization: "Bearer " + token };
  const metaResponse = await fetch("/api/file-info?id=" + id, {
    headers,
    signal,
  });
  if (!metaResponse.ok) throw Error("无法获取下载信息，请检查会话权限");
  const info = await metaResponse.json();
  const total = Number(info.size);
  const file = await handle.getFile();
  let offset = file.size === entry.offset ? entry.offset : 0;
  const hashes = info.chunk_hashes ? JSON.parse(info.chunk_hashes) : null;
  // Validate every saved complete chunk before trusting a resumed partial file.
  if (offset && hashes) {
    for (let part = 0; part < Math.ceil(offset / CHUNK); part++) {
      if (signal.aborted) throw new DOMException("已暂停", "AbortError");
      const content = await file
        .slice(part * CHUNK, Math.min((part + 1) * CHUNK, offset))
        .arrayBuffer();
      if (
        hex(await crypto.subtle.digest("SHA-256", content)) !== hashes[part]
      ) {
        offset = 0;
        break;
      }
    }
  }
  const writable = await handle.createWritable({
    keepExistingData: offset > 0,
  });
  await writable.seek(offset);
  try {
    while (offset < total) {
      if (signal.aborted) throw new DOMException("下载已暂停", "AbortError");
      const end = Math.min(offset + CHUNK, total) - 1;
      const response = await fetch("/api/files?id=" + id, {
        headers: { ...headers, Range: `bytes=${offset}-${end}` },
        signal,
      });
      if (response.status !== 206) throw Error("下载分片响应异常，请稍后继续");
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== end - offset + 1)
        throw Error("下载连接中断，可重新点击该文件继续");
      if (
        hashes &&
        hex(await crypto.subtle.digest("SHA-256", bytes)) !==
          hashes[Math.floor(offset / CHUNK)]
      )
        throw Error("下载校验失败，请重试");
      await writable.write(bytes);
      offset = end + 1;
      onProgress(Math.round((offset / total) * 100));
    }
  } finally {
    await writable.close();
    await stored(id, { handle, offset });
  }
  return { completed: offset === total };
}
