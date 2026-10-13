import { TaskError } from './domain.mjs';

export async function getJson(url, { platform, fetchImpl = fetch, timeoutMs = 15000, maxBytes = 24 * 1024 * 1024 }) {
  const prefix = platform.toUpperCase(), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
    if (response.status === 404) throw new TaskError(`${prefix}_NOT_FOUND`, '公司招聘页或岗位已不存在。');
    if (response.status === 429) throw new TaskError(`${prefix}_RATE_LIMIT`, '请求过多，请稍后重试。');
    if (!response.ok) throw new TaskError(`${prefix}_HTTP_ERROR`, `${platform} 返回 HTTP ${response.status}。`);
    if (!response.headers.get('content-type')?.includes('application/json')) throw new TaskError(`${prefix}_DATA_INVALID`, '接口未返回有效岗位数据。');
    let size = 0; const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) { controller.abort(); throw new TaskError(`${prefix}_TOO_LARGE`, '公司岗位数据过大，请改用岗位链接。'); }
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof TaskError) throw error;
    if (controller.signal.aborted) throw new TaskError(`${prefix}_TIMEOUT`, '岗位接口读取超时，请重试。');
    if (error instanceof SyntaxError) throw new TaskError(`${prefix}_DATA_INVALID`, '接口返回的数据无法解析。');
    throw new TaskError(`${prefix}_NETWORK_ERROR`, '无法连接岗位接口，请检查网络后重试。');
  } finally { clearTimeout(timer); }
}
