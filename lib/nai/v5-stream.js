'use strict';

/**
 * NovelAI V5 图片流（/ai/generate-image-stream）的帧解析器。
 *
 * 线格式：每一帧 = 4 字节大端无符号长度 N + N 字节 MessagePack 负载，
 * 整个响应就是把这种帧首尾相接起来，没有分隔符。负载通常是一个 map：
 *   { event_type: 'intermediate' | 'final' | 'error', samp_ix, step, image: <bin>, ... }
 *
 * 解析器是「喂多少解析多少」的增量状态机，必须能扛住真实网络的分片：
 *   - 4 字节长度前缀可能被切在两次 push 之间；
 *   - 帧体可能跨任意多个 chunk；
 *   - 一次 push 也可能同时包含「上一帧的尾巴 + 若干个完整帧 + 下一帧的开头」。
 * 所以内部维护「半截长度前缀」和「未完成帧体」两个状态，只有凑满一帧才解码。
 *
 * 事件形状（server.js / transport.js 直接消费）：
 *   final        { type, image: Buffer, eventType: 'final', sampIx: 0, raw }
 *   intermediate { type, image?: Buffer, step?, eventType: 'intermediate', raw }
 *   error        { type, message: string, statusCode?, raw }
 *   other        { type, raw }
 *
 * 越界保护：单帧超限 / 累计超限 / 帧不是 map / 流断在帧中间都会抛带 code 的错误，
 * 绝不静默吞帧，也绝不因为长度前缀荒谬而挂死。
 */

const { decode, MsgpackError } = require('../msgpack');

const HEADER_BYTES = 4;
const DEFAULT_MAX_FRAME_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 128 * 1024 * 1024;

class V5StreamError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'V5StreamError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function checkLimit(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`V5StreamParser: ${name} 必须是正整数，收到 ${String(value)}`);
  }
  return value;
}

function toBuffer(chunk) {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  throw new TypeError('V5StreamParser.push 需要 Buffer 或 Uint8Array');
}

/** 帧负载必须是 msgpack map，解码后也就是「非 null、非数组、非 Buffer 的对象」。 */
function isFrameMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value);
}

function describeType(value) {
  if (value === null) return 'nil';
  if (Array.isArray(value)) return 'array';
  if (Buffer.isBuffer(value)) return 'bin';
  return typeof value;
}

/**
 * 取 event_type。规范字段是 snake_case；这里顺手容忍 eventType，
 * 避免上游哪天改了序列化命名就整条流无法识别。
 */
function normalizeEventType(raw) {
  const value = raw.event_type !== undefined ? raw.event_type : raw.eventType;
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

/* ------------------------------------------------------------------ */
/* 帧负载 → 事件                                                       */
/* ------------------------------------------------------------------ */

function buildIntermediateEvent(raw) {
  const event = { type: 'intermediate', eventType: 'intermediate', raw };
  if (Buffer.isBuffer(raw.image)) event.image = raw.image;
  if (raw.step !== undefined) event.step = raw.step;
  return event;
}

function buildEvent(raw) {
  const eventType = normalizeEventType(raw);

  if (eventType === 'error') {
    const message = raw.message === undefined || raw.message === null
      ? 'NovelAI 返回了未知错误'
      : String(raw.message);
    const event = { type: 'error', message, raw };
    // 上游偶尔用 status_code（snake_case），也兼容 statusCode。
    const statusCode = raw.status_code !== undefined ? raw.status_code : raw.statusCode;
    if (statusCode !== undefined) event.statusCode = statusCode;
    return event;
  }

  if (eventType === 'final') {
    // 一次请求会出多张图（samp_ix = 0..3）。只有 samp_ix 为 0 的那一帧才是整张
    // 最终图；samp_ix 存在且非 0 时即使 event_type 写成 final，也只能当中间结果，
    // 否则会把「第 2 张图的半步结果」误当最终图交给上层。
    const sampIx = raw.samp_ix !== undefined ? raw.samp_ix : 0;
    if (sampIx !== 0) return buildIntermediateEvent(raw);

    if (!Buffer.isBuffer(raw.image)) {
      throw new V5StreamError('V5_STREAM_INVALID_FRAME', 'V5 final 帧缺少 image 二进制字段');
    }
    return { type: 'final', image: raw.image, eventType: 'final', sampIx: 0, raw };
  }

  if (eventType === 'intermediate') return buildIntermediateEvent(raw);

  // 未知 / 缺失 event_type：原样透出，交给上层决定要不要忽略。
  return { type: 'other', raw };
}

/* ------------------------------------------------------------------ */
/* 增量解析器                                                          */
/* ------------------------------------------------------------------ */

class V5StreamParser {
  /**
   * @param {{ maxFrameBytes?: number, maxTotalBytes?: number }} [options]
   *   maxFrameBytes 单帧负载上限；maxTotalBytes 整条流累计收到字节数上限。
   */
  constructor(options = {}) {
    const { maxFrameBytes, maxTotalBytes } = options || {};
    this.maxFrameBytes = checkLimit(
      maxFrameBytes === undefined ? DEFAULT_MAX_FRAME_BYTES : maxFrameBytes,
      'maxFrameBytes',
    );
    this.maxTotalBytes = checkLimit(
      maxTotalBytes === undefined ? DEFAULT_MAX_TOTAL_BYTES : maxTotalBytes,
      'maxTotalBytes',
    );

    this._header = Buffer.alloc(0); // 未凑满的 4 字节长度前缀
    this._frameLength = -1; // -1 表示当前没有进行中的帧体
    this._bodyChunks = []; // 帧体分片（只记账，凑满后一次性 concat）
    this._bodyBytes = 0;
    this._totalBytes = 0; // 整条流累计收到的字节数
    this._frameIndex = 0; // 已完成的帧数（含跳过的空帧），用于报错定位
    this._ended = false;
  }

  /**
   * 喂入一段数据，返回「本次新凑满的帧」对应的事件数组（可能为空数组）。
   * 长度前缀/帧体被切开时不会产生事件，等后续 push 补齐。
   */
  push(chunk) {
    if (this._ended) {
      throw new V5StreamError('V5_STREAM_ENDED', 'V5 流已结束，不能再 push 数据');
    }
    const input = toBuffer(chunk);
    const events = [];
    if (input.length === 0) return events;

    this._totalBytes += input.length;
    if (this._totalBytes > this.maxTotalBytes) {
      throw new V5StreamError(
        'V5_STREAM_TOO_LARGE',
        `V5 流累计收到 ${this._totalBytes} 字节，超过上限 ${this.maxTotalBytes} 字节`,
      );
    }

    let cursor = 0;
    while (cursor < input.length) {
      if (this._frameLength < 0) {
        // 阶段一：读长度前缀。可能只到 1~3 个字节，剩下的等下一次 push。
        const need = HEADER_BYTES - this._header.length;
        const take = Math.min(need, input.length - cursor);
        this._header = Buffer.concat([this._header, input.subarray(cursor, cursor + take)]);
        cursor += take;
        if (this._header.length < HEADER_BYTES) break;

        const frameLength = this._header.readUInt32BE(0);
        this._header = Buffer.alloc(0);

        // 先按长度前缀判断，避免真的去申请/等待一个荒谬大小的帧。
        if (frameLength > this.maxFrameBytes) {
          throw new V5StreamError(
            'V5_FRAME_TOO_LARGE',
            `第 ${this._frameIndex + 1} 帧声明长度 ${frameLength} 字节，` +
              `超过单帧上限 ${this.maxFrameBytes} 字节`,
          );
        }
        if (frameLength === 0) {
          // 0 长度帧：协议里的心跳/占位，跳过且不产生事件，但必须推进游标防死循环。
          this._frameIndex += 1;
          continue;
        }

        this._frameLength = frameLength;
        this._bodyChunks = [];
        this._bodyBytes = 0;
      }

      // 阶段二：继续收集帧体。subarray 只引用不复制，凑满后用 concat 拼一次。
      const remain = this._frameLength - this._bodyBytes;
      const take = Math.min(remain, input.length - cursor);
      if (take > 0) {
        this._bodyChunks.push(input.subarray(cursor, cursor + take));
        this._bodyBytes += take;
        cursor += take;
      }
      if (this._bodyBytes < this._frameLength) break; // 帧体还没收齐，等下一次 push

      const body = Buffer.concat(this._bodyChunks, this._frameLength);
      this._frameLength = -1;
      this._bodyChunks = [];
      this._bodyBytes = 0;
      events.push(this._decodeFrame(body));
      this._frameIndex += 1;
    }

    return events;
  }

  /**
   * 流结束时调用。正常结束返回 []；若还卡在半截长度前缀或半截帧体上，
   * 说明连接被提前掐断，抛 V5_STREAM_TRUNCATED（message 带已收/期望字节数）。
   */
  end() {
    if (this._ended) return [];
    this._ended = true;

    if (this._frameLength >= 0) {
      const received = HEADER_BYTES + this._bodyBytes;
      const expected = HEADER_BYTES + this._frameLength;
      const error = new V5StreamError(
        'V5_STREAM_TRUNCATED',
        `V5 流在帧中间结束：第 ${this._frameIndex + 1} 帧已收 ${received} 字节，` +
          `期望 ${expected} 字节（帧体还差 ${this._frameLength - this._bodyBytes} 字节）`,
      );
      error.received = received;
      error.expected = expected;
      throw error;
    }

    if (this._header.length > 0) {
      const error = new V5StreamError(
        'V5_STREAM_TRUNCATED',
        `V5 流在长度前缀中间结束：已收 ${this._header.length} 字节，期望 ${HEADER_BYTES} 字节长度前缀`,
      );
      error.received = this._header.length;
      error.expected = HEADER_BYTES;
      throw error;
    }

    return [];
  }

  /** 解一帧负载；解码失败或不是 map 都归为 V5_STREAM_INVALID_FRAME。 */
  _decodeFrame(body) {
    let raw;
    try {
      raw = decode(body).value;
    } catch (error) {
      if (!(error instanceof MsgpackError)) throw error;
      const wrapped = new V5StreamError(
        'V5_STREAM_INVALID_FRAME',
        `第 ${this._frameIndex + 1} 帧 MessagePack 解码失败：${error.message}`,
      );
      wrapped.cause = error;
      throw wrapped;
    }

    if (!isFrameMap(raw)) {
      throw new V5StreamError(
        'V5_STREAM_INVALID_FRAME',
        `第 ${this._frameIndex + 1} 帧负载不是 map（实际为 ${describeType(raw)}）`,
      );
    }

    return buildEvent(raw);
  }
}

/**
 * 一次性解析整段 Buffer（内部起一个 parser，喂完再 end）。
 * 适合测试和「响应体已经完整拿到」的场景；真正的网络流请用 V5StreamParser。
 */
function parseV5Frames(buffer, options) {
  const input = toBuffer(buffer);
  const parser = new V5StreamParser(options);
  const events = parser.push(input);
  return events.concat(parser.end());
}

module.exports = {
  V5StreamParser,
  parseV5Frames,
};
