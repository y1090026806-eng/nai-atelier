'use strict';

const crypto = require('node:crypto');
const axios = require('axios');
const { NaiError, classifyHttpStatus, classifyNetworkError, retryDecision } = require('./errors');
const { V5StreamParser } = require('./v5-stream');

/**
 * NovelAI 传输层。
 *
 * 两种协议共用 axios（保留系统代理 / 自签证书 / 重定向的既有行为）：
 * - 旧模型：JSON POST，`responseType:'arraybuffer'`，响应是 ZIP；
 * - V5：multipart POST，`responseType:'stream'`，边收边解析 msgpack 帧，
 *   这样中间帧可以用来更新进度，最终帧一到就可以结束，不必等连接关闭。
 *
 * 重试只发生在「还没拿到任何业务数据」的阶段：429 / 5xx / 连接错误。
 * 流已经开始之后出错不重试 —— 重试等于再扣一次 Anlas。
 */

function buildNaiUrl(baseUrl, capabilities) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new NaiError('请先填写 NovelAI Base URL。', {
      kind: 'config',
      code: 'NAI_BASE_URL_MISSING',
      status: 400,
    });
  }
  if (!/^https?:\/\//i.test(base)) {
    throw new NaiError('NovelAI Base URL 必须是 http(s) 地址。', {
      kind: 'config',
      code: 'NAI_BASE_URL_INVALID',
      status: 400,
    });
  }
  const path = capabilities?.endpoint || '/ai/generate-image';
  if (base.endsWith(path)) return base;
  return `${base}${path}`;
}

/** 手写 multipart：只有一个字段，比引入 form-data 依赖更可控。 */
function buildMultipartBody(jsonBody, boundary) {
  const json = Buffer.from(JSON.stringify(jsonBody), 'utf8');
  const head = Buffer.from(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="request"; filename="blob"\r\n' +
      'Content-Type: application/json\r\n\r\n',
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return Buffer.concat([head, json, tail]);
}

function extractErrorDetail(buffer) {
  if (!buffer || !buffer.length) return '';
  const text = buffer.toString('utf8').trim();
  if (!text) return '';
  try {
    const parsed = JSON.parse(text);
    const message = parsed?.message || parsed?.error?.message || parsed?.detail;
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 400);
    if (parsed?.error && typeof parsed.error === 'string') return parsed.error.slice(0, 400);
  } catch {
    // 不是 JSON，退回纯文本。
  }
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return Buffer.alloc(0);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new NaiError('已取消。', { kind: 'aborted', code: 'NAI_ABORTED', status: 499 }));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new NaiError('已取消。', { kind: 'aborted', code: 'NAI_ABORTED', status: 499 }));
    };
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function canceledError() {
  return new NaiError('已取消。', { kind: 'aborted', code: 'NAI_ABORTED', status: 499 });
}

/** 读完整响应体（旧模型 / 错误响应）。 */
async function readAll(stream, limitBytes, signal) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    if (signal?.aborted) throw canceledError();
    const buffer = toBuffer(chunk);
    total += buffer.length;
    if (total > limitBytes) {
      throw new NaiError(`NovelAI 响应超过 ${Math.round(limitBytes / 1024 / 1024)}MiB 上限。`, {
        kind: 'parse',
        code: 'NAI_RESPONSE_TOO_LARGE',
        status: 502,
        retryable: false,
      });
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** V5：边收边解析。返回最后一帧的图片。 */
async function consumeV5Stream(stream, { onFrame, maxFrameBytes, maxTotalBytes, signal }) {
  const parser = new V5StreamParser({ maxFrameBytes, maxTotalBytes });
  let image = null;
  let frameCount = 0;
  let bytes = 0;

  try {
    for await (const chunk of stream) {
      if (signal?.aborted) throw canceledError();
      const buffer = toBuffer(chunk);
      if (!buffer.length) continue;
      bytes += buffer.length;
      const events = parser.push(buffer);
      for (const event of events) {
        frameCount += 1;
        if (event.type === 'final' && event.image?.length) image = event.image;
        if (typeof onFrame === 'function') {
          try {
            onFrame(event, { bytes, frameCount });
          } catch {
            // 进度回调失败不能影响出图。
          }
        }
        if (event.type === 'error') {
          throw new NaiError(`NovelAI 流式返回错误：${event.message || '未知错误'}`, {
            kind: 'provider',
            code: 'NAI_STREAM_ERROR',
            status: 502,
            retryable: false,
          });
        }
      }
      if (image) break;
    }
    // 拿到最终帧就提前收工：此时连接尾部可能还有未读完的字节，不能当作截断。
    if (!image) parser.end();
  } catch (error) {
    if (error instanceof NaiError) throw error;
    if (isCancelError(error)) throw canceledError();
    throw new NaiError(`解析 NovelAI 流式响应失败：${error.message || error}`, {
      kind: 'parse',
      code: error.code || 'NAI_STREAM_PARSE',
      status: 502,
      retryable: false,
      cause: error,
    });
  }

  if (!image) {
    throw new NaiError('NovelAI 流式响应结束，但没有收到最终图片帧。', {
      kind: 'parse',
      code: 'NAI_STREAM_NO_IMAGE',
      status: 502,
      retryable: false,
    });
  }

  return { image, frameCount, bytes };
}

function isCancelError(error) {
  return (
    axios.isCancel?.(error) ||
    error?.code === 'ERR_CANCELED' ||
    error?.name === 'CanceledError' ||
    error?.name === 'AbortError'
  );
}

async function attemptOnce({ novai, request, capabilities, signal, onFrame, timeoutMs }) {
  const url = buildNaiUrl(novai.baseUrl, capabilities);
  const isV5 = request.transport === 'msgpack-stream';
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener?.('abort', onOuterAbort, { once: true });

  // 自己管超时：axios 的 timeout 对流式响应不可靠，而且我们想区分
  // 「连不上」和「收了一半断掉」。
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const headers = {
      Authorization: `Bearer ${novai.apiKey}`,
      Accept: isV5 ? 'application/x-msgpack, application/octet-stream, application/json' : 'application/zip, image/png, application/json',
    };

    let response;
    if (isV5) {
      const boundary = `----naiform${crypto.randomBytes(8).toString('hex')}`;
      const body = buildMultipartBody(request.payload, boundary);
      headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
      response = await axios.post(url, body, {
        headers,
        responseType: 'stream',
        timeout: 0,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        decompress: true,
        signal: controller.signal,
        validateStatus: () => true,
      });
    } else {
      headers['Content-Type'] = 'application/json';
      response = await axios.post(url, request.payload, {
        headers,
        responseType: 'arraybuffer',
        timeout: timeoutMs,
        maxBodyLength: Infinity,
        maxContentLength: 128 * 1024 * 1024,
        signal: controller.signal,
        validateStatus: () => true,
      });
    }

    if (response.status < 200 || response.status >= 300) {
      const detailBuffer = isV5 ? await readAll(response.data, 1024 * 1024, controller.signal) : toBuffer(response.data);
      throw classifyHttpStatus(response.status, extractErrorDetail(detailBuffer));
    }

    if (isV5) {
      const result = await consumeV5Stream(response.data, {
        onFrame,
        signal: controller.signal,
        maxFrameBytes: 64 * 1024 * 1024,
        maxTotalBytes: 128 * 1024 * 1024,
      });
      return {
        image: result.image,
        meta: {
          transport: 'msgpack-stream',
          status: response.status,
          frames: result.frameCount,
          bytes: result.bytes,
          elapsedMs: Date.now() - startedAt,
          contentType: String(response.headers?.['content-type'] || ''),
        },
      };
    }

    const buffer = toBuffer(response.data);
    return {
      buffer,
      meta: {
        transport: 'image',
        status: response.status,
        frames: 1,
        bytes: buffer.length,
        elapsedMs: Date.now() - startedAt,
        contentType: String(response.headers?.['content-type'] || ''),
      },
    };
  } catch (error) {
    if (error instanceof NaiError) throw error;
    if (controller.signal.aborted && !signal?.aborted) {
      throw new NaiError(
        `NovelAI 请求超时（${Math.round(timeoutMs / 1000)}s）。注意：超时可能已经生成并扣费，重试前请先确认。`,
        { kind: 'timeout', code: 'NAI_TIMEOUT', status: 504, retryable: false },
      );
    }
    if (signal?.aborted) throw canceledError();
    throw classifyNetworkError(error, { timeoutSeconds: Math.round(timeoutMs / 1000) });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onOuterAbort);
  }
}

/**
 * 对外入口：带重试的图片请求。
 *
 * @returns {Promise<{image?:Buffer, buffer?:Buffer, meta:object, attempts:number}>}
 */
async function requestImage({ novai, request, capabilities, signal, onFrame, onRetry }) {
  if (!novai.apiKey) {
    throw new NaiError('请先在设置里填写 NovelAI API Key。', {
      kind: 'config',
      code: 'NAI_API_KEY_MISSING',
      status: 400,
    });
  }

  const timeoutMs = Math.max(30, Number(novai.timeoutSeconds) || 300) * 1000;
  let attempt = 0;
  const startedAt = Date.now();

  for (;;) {
    try {
      const result = await attemptOnce({
        novai,
        request,
        capabilities,
        signal,
        onFrame,
        timeoutMs,
      });
      return {
        ...result,
        attempts: attempt + 1,
        meta: { ...result.meta, attempts: attempt + 1, totalElapsedMs: Date.now() - startedAt },
      };
    } catch (error) {
      const decision = retryDecision(error, attempt);
      if (!decision.retry) {
        if (error instanceof NaiError) {
          error.attempts = attempt + 1;
          error.elapsedMs = Date.now() - startedAt;
        }
        throw error;
      }
      attempt += 1;
      if (typeof onRetry === 'function') {
        try {
          onRetry({ attempt, delayMs: decision.delayMs, error });
        } catch {
          // 忽略回调异常。
        }
      }
      await sleep(decision.delayMs, signal);
    }
  }
}

module.exports = {
  buildNaiUrl,
  buildMultipartBody,
  extractErrorDetail,
  requestImage,
  consumeV5Stream,
  readAll,
  isCancelError,
};
