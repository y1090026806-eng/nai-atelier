'use strict';

/**
 * NovelAI 请求的错误分类。
 *
 * 关键区分：**请求是否已经被上游受理**。
 * - 「未受理」（本地参数校验、鉴权失败、402、连接没建立）→ 重试安全；
 * - 「已受理但结果未知」（超时、流中断）→ 重试可能重复扣 Anlas，默认不重试；
 * - 「明确拒绝」（400/422）→ 重试没有意义，把原始信息带回去给用户。
 *
 * 前端用 code 做本地化与「要不要显示重试按钮」，日志里用 code 做统计。
 */

const ERROR_KINDS = {
  input: { retryable: false, label: '请求参数不合法' },
  auth: { retryable: false, label: '鉴权失败' },
  quota: { retryable: false, label: '额度/订阅不足' },
  busy: { retryable: true, label: '上游繁忙' },
  network: { retryable: true, label: '网络错误' },
  timeout: { retryable: false, label: '请求超时' },
  parse: { retryable: true, label: '响应解析失败' },
  provider: { retryable: true, label: '上游服务错误' },
  config: { retryable: false, label: '配置缺失' },
  aborted: { retryable: false, label: '已取消' },
  unknown: { retryable: false, label: '未知错误' },
};

class NaiError extends Error {
  constructor(message, { kind = 'unknown', code = 'NAI_UNKNOWN', status = 502, retryable, detail = '', cause } = {}) {
    super(message);
    this.name = 'NaiError';
    this.kind = ERROR_KINDS[kind] ? kind : 'unknown';
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.retryable = typeof retryable === 'boolean' ? retryable : ERROR_KINDS[this.kind].retryable;
    if (cause) this.cause = cause;
  }

  toJSON() {
    return {
      kind: this.kind,
      code: this.code,
      status: this.status,
      retryable: this.retryable,
      detail: this.detail,
      message: this.message,
    };
  }
}

/** HTTP 状态码 → 错误分类。detail 是上游返回的错误文本（可为空）。 */
function classifyHttpStatus(status, detail = '') {
  const suffix = detail ? `：${detail}` : '';
  if (status === 400 || status === 422) {
    return new NaiError(`NovelAI 拒绝了这次请求（HTTP ${status}）${suffix}`, {
      kind: 'input',
      code: 'NAI_BAD_REQUEST',
      status,
      detail,
    });
  }
  if (status === 401 || status === 403) {
    return new NaiError(`NovelAI API Key 无效或无权限（HTTP ${status}）${suffix}`, {
      kind: 'auth',
      code: 'NAI_AUTH',
      status,
      detail,
    });
  }
  if (status === 402) {
    return new NaiError(`NovelAI Anlas 余额不足或订阅不可用（HTTP 402）${suffix}`, {
      kind: 'quota',
      code: 'NAI_QUOTA',
      status,
      detail,
    });
  }
  if (status === 429) {
    return new NaiError(`NovelAI 请求过于频繁，请稍后再试（HTTP 429）${suffix}`, {
      kind: 'busy',
      code: 'NAI_BUSY',
      status,
      detail,
    });
  }
  if (status === 503 || status === 502 || status === 504) {
    return new NaiError(`NovelAI 服务暂时不可用（HTTP ${status}）${suffix}`, {
      kind: 'provider',
      code: 'NAI_UNAVAILABLE',
      status,
      detail,
    });
  }
  if (status >= 500) {
    return new NaiError(`NovelAI 服务错误（HTTP ${status}）${suffix}`, {
      kind: 'provider',
      code: 'NAI_UPSTREAM_ERROR',
      status,
      detail,
    });
  }
  return new NaiError(`NovelAI 请求失败（HTTP ${status}）${suffix}`, {
    kind: 'unknown',
    code: 'NAI_HTTP_ERROR',
    status,
    detail,
  });
}

/** 网络层错误分类（axios / fetch 的 error）。 */
function classifyNetworkError(error, { timeoutSeconds = 0 } = {}) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');

  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout/i.test(message)) {
    return new NaiError(
      `NovelAI 请求超时（${timeoutSeconds || '?'}s）。注意：超时可能已经生成并扣费，重试前请先确认。`,
      { kind: 'timeout', code: 'NAI_TIMEOUT', status: 504, retryable: false, cause: error },
    );
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new NaiError('无法解析 NovelAI 域名，请检查网络或 Base URL。', {
      kind: 'network',
      code: 'NAI_DNS',
      status: 502,
      retryable: true,
      cause: error,
    });
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EPIPE') {
    return new NaiError('与 NovelAI 的连接被拒绝或中断。', {
      kind: 'network',
      code: 'NAI_CONNECTION',
      status: 502,
      retryable: true,
      cause: error,
    });
  }
  return new NaiError(`NovelAI 网络请求失败：${message || '未知错误'}`, {
    kind: 'network',
    code: 'NAI_NETWORK',
    status: 502,
    retryable: true,
    cause: error,
  });
}

/**
 * 重试策略（对齐 LittleWhiteBox）：
 * - 429：最多重试 2 次，延迟线性递增（base * (attempt+1)）；
 * - 5xx：只重试 1 次；
 * - 其余不重试。
 */
function retryDecision(error, attempt) {
  if (!(error instanceof NaiError)) return { retry: false, delayMs: 0 };
  if (error.kind === 'busy' && attempt < 2) {
    return { retry: true, delayMs: 1500 * (attempt + 1) };
  }
  if (error.kind === 'provider' && attempt < 1) {
    return { retry: true, delayMs: 2000 };
  }
  return { retry: false, delayMs: 0 };
}

module.exports = {
  ERROR_KINDS,
  NaiError,
  classifyHttpStatus,
  classifyNetworkError,
  retryDecision,
};
