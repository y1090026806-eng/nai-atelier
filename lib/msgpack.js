'use strict';

/**
 * 最小 MessagePack 解码器（纯手写，不引入第三方依赖）。
 *
 * 用途：NovelAI V5 的 /ai/generate-image-stream 用「4 字节大端长度 + MessagePack
 * 负载」重复成帧返回生成进度，server.js（经 lib/nai/v5-stream.js）需要把每帧负载
 * 还原成普通 JS 值。
 *
 * 设计取舍：
 *   - 64 位整数一律用 Number 承载；超过 Number.MAX_SAFE_INTEGER 直接抛错，
 *     避免把 BigInt 漏给上层（JSON.stringify 遇到 BigInt 会直接炸）。
 *   - map 的 key 允许任意标量：数字 / 布尔 / nil 等都用 String() 转成字符串，
 *     因为 JS 对象的 key 只能是字符串（数字 key 会变成 "1"）。
 *   - bin 与 ext.data 以 Buffer.subarray 视图返回，不复制字节；调用方只读即可。
 *   - 任何越界 / 未知类型 / 非法长度都抛 MsgpackError：
 *       error.code 为 MSGPACK_TRUNCATED 或 MSGPACK_INVALID；
 *       error.offset 指向出错字节位置，message 里也带 "offset N" 方便定位。
 */

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
// 嵌套层级上限：正常负载只有几层，限制是为了让恶意深嵌套抛 MsgpackError 而不是栈溢出。
const MAX_DEPTH = 1024;

class MsgpackError extends Error {
  constructor(code, offset, detail) {
    super(`${detail}（offset ${offset}）`);
    this.name = 'MsgpackError';
    this.code = code;
    this.offset = offset;
  }
}

/* ------------------------------------------------------------------ */
/* 读取器：所有越界检查集中在这里，越界时统一抛 MSGPACK_TRUNCATED      */
/* ------------------------------------------------------------------ */

class Reader {
  constructor(buffer, offset) {
    this.buffer = buffer;
    this.offset = offset;
  }

  /**
   * 确保接下来 n 字节存在。
   * 出错时 offset 指向「第一个缺失的字节」，也就是当前缓冲区末尾。
   */
  need(n) {
    if (this.offset + n > this.buffer.length) {
      throw new MsgpackError(
        'MSGPACK_TRUNCATED',
        this.buffer.length,
        `数据被截断：需要 ${n} 字节，只剩 ${this.buffer.length - this.offset} 字节`,
      );
    }
  }

  u8() {
    this.need(1);
    const value = this.buffer[this.offset];
    this.offset += 1;
    return value;
  }

  i8() {
    this.need(1);
    const value = this.buffer.readInt8(this.offset);
    this.offset += 1;
    return value;
  }

  u16() {
    this.need(2);
    const value = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  i16() {
    this.need(2);
    const value = this.buffer.readInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  u32() {
    this.need(4);
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  i32() {
    this.need(4);
    const value = this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  u64() {
    this.need(8);
    const value = this.buffer.readBigUInt64BE(this.offset);
    this.offset += 8;
    return value;
  }

  i64() {
    this.need(8);
    const value = this.buffer.readBigInt64BE(this.offset);
    this.offset += 8;
    return value;
  }

  f32() {
    this.need(4);
    const value = this.buffer.readFloatBE(this.offset);
    this.offset += 4;
    return value;
  }

  f64() {
    this.need(8);
    const value = this.buffer.readDoubleBE(this.offset);
    this.offset += 8;
    return value;
  }

  /** 读取 n 字节原始数据（bin / ext.data），返回视图而不复制。 */
  take(n) {
    this.need(n);
    const start = this.offset;
    this.offset = start + n;
    return this.buffer.subarray(start, this.offset);
  }

  /** 读取 n 字节 UTF-8 字符串。非法字节序列会被 Buffer 替换成 U+FFFD。 */
  str(n) {
    this.need(n);
    const start = this.offset;
    this.offset = start + n;
    return this.buffer.toString('utf8', start, this.offset);
  }
}

/* ------------------------------------------------------------------ */
/* 各类复合结构                                                        */
/* ------------------------------------------------------------------ */

function readArray(reader, length, depth) {
  if (depth >= MAX_DEPTH) {
    throw new MsgpackError('MSGPACK_INVALID', reader.offset, `嵌套层级超过 ${MAX_DEPTH} 层`);
  }
  const out = new Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = readValue(reader, depth + 1);
  }
  return out;
}

/** map 的 key 统一转字符串；__proto__ 用 defineProperty 写成普通自有属性，避免污染原型。 */
function setMapKey(target, key, value) {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  } else {
    target[key] = value;
  }
}

function readMap(reader, length, depth) {
  if (depth >= MAX_DEPTH) {
    throw new MsgpackError('MSGPACK_INVALID', reader.offset, `嵌套层级超过 ${MAX_DEPTH} 层`);
  }
  const out = {};
  for (let i = 0; i < length; i += 1) {
    const key = readValue(reader, depth + 1);
    const value = readValue(reader, depth + 1);
    setMapKey(out, typeof key === 'string' ? key : String(key), value);
  }
  return out;
}

/** ext 统一形状：{ type: number, data: Buffer }；type 是 msgpack 的有符号 int8。 */
function readExt(reader, length) {
  const type = reader.i8();
  return { type, data: reader.take(length) };
}

/**
 * uint64 / int64 → Number。超出安全整数范围时抛 MsgpackError：
 * 静默丢失精度比报错更危险（图片 id / 时间戳会算错）。
 */
function readUint64(reader, start) {
  const raw = reader.u64();
  if (raw > MAX_SAFE_INTEGER_BIGINT) {
    throw new MsgpackError(
      'MSGPACK_INVALID',
      start,
      `uint64 值 ${raw} 超过 Number.MAX_SAFE_INTEGER，拒绝解码`,
    );
  }
  return Number(raw);
}

function readInt64(reader, start) {
  const raw = reader.i64();
  if (raw > MAX_SAFE_INTEGER_BIGINT || raw < -MAX_SAFE_INTEGER_BIGINT) {
    throw new MsgpackError(
      'MSGPACK_INVALID',
      start,
      `int64 值 ${raw} 超出 Number 安全整数范围，拒绝解码`,
    );
  }
  return Number(raw);
}

/* ------------------------------------------------------------------ */
/* 主解码循环                                                          */
/* ------------------------------------------------------------------ */

function readValue(reader, depth) {
  const start = reader.offset; // 类型标记的位置，非法类型时报它
  const type = reader.u8();

  // positive fixint：0x00 - 0x7f
  if (type <= 0x7f) return type;
  // negative fixint：0xe0 - 0xff（补码，减 0x100 得到 -32..-1）
  if (type >= 0xe0) return type - 0x100;
  // fixstr：0xa0 - 0xbf，低 5 位是长度
  if (type >= 0xa0 && type <= 0xbf) return reader.str(type & 0x1f);
  // fixarray：0x90 - 0x9f，低 4 位是元素个数
  if (type >= 0x90 && type <= 0x9f) return readArray(reader, type & 0x0f, depth);
  // fixmap：0x80 - 0x8f，低 4 位是键值对个数
  if (type >= 0x80 && type <= 0x8f) return readMap(reader, type & 0x0f, depth);

  switch (type) {
    case 0xc0:
      return null;
    case 0xc2:
      return false;
    case 0xc3:
      return true;
    case 0xc4:
      return reader.take(reader.u8()); // bin8
    case 0xc5:
      return reader.take(reader.u16()); // bin16
    case 0xc6:
      return reader.take(reader.u32()); // bin32
    case 0xc7:
      return readExt(reader, reader.u8()); // ext8
    case 0xc8:
      return readExt(reader, reader.u16()); // ext16
    case 0xc9:
      return readExt(reader, reader.u32()); // ext32
    case 0xca:
      return reader.f32(); // float32
    case 0xcb:
      return reader.f64(); // float64
    case 0xcc:
      return reader.u8(); // uint8
    case 0xcd:
      return reader.u16(); // uint16
    case 0xce:
      return reader.u32(); // uint32
    case 0xcf:
      return readUint64(reader, start); // uint64
    case 0xd0:
      return reader.i8(); // int8
    case 0xd1:
      return reader.i16(); // int16
    case 0xd2:
      return reader.i32(); // int32
    case 0xd3:
      return readInt64(reader, start); // int64
    case 0xd4:
      return readExt(reader, 1); // fixext1
    case 0xd5:
      return readExt(reader, 2); // fixext2
    case 0xd6:
      return readExt(reader, 4); // fixext4
    case 0xd7:
      return readExt(reader, 8); // fixext8
    case 0xd8:
      return readExt(reader, 16); // fixext16
    case 0xd9:
      return reader.str(reader.u8()); // str8
    case 0xda:
      return reader.str(reader.u16()); // str16
    case 0xdb:
      return reader.str(reader.u32()); // str32
    case 0xdc:
      return readArray(reader, reader.u16(), depth); // array16
    case 0xdd:
      return readArray(reader, reader.u32(), depth); // array32
    case 0xde:
      return readMap(reader, reader.u16(), depth); // map16
    case 0xdf:
      return readMap(reader, reader.u32(), depth); // map32
    default:
      // 0xc1 是 msgpack 规范里保留的「never used」，其余未知字节同样拒绝。
      throw new MsgpackError(
        'MSGPACK_INVALID',
        start,
        `未知的 MessagePack 类型标记 0x${type.toString(16).padStart(2, '0')}`,
      );
  }
}

/* ------------------------------------------------------------------ */
/* 对外 API                                                            */
/* ------------------------------------------------------------------ */

/**
 * 从 buffer 的 offset 处解码一个值。
 * @returns {{ value: any, offset: number }} offset 是读完后的新位置
 */
function decode(buffer, offset = 0) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('msgpack.decode 需要 Buffer');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new MsgpackError('MSGPACK_INVALID', 0, `offset 必须是非负整数，收到 ${String(offset)}`);
  }
  if (offset > buffer.length) {
    throw new MsgpackError(
      'MSGPACK_TRUNCATED',
      buffer.length,
      `offset ${offset} 超出缓冲区长度 ${buffer.length}`,
    );
  }

  const reader = new Reader(buffer, offset);
  const value = readValue(reader, 0);
  return { value, offset: reader.offset };
}

/**
 * 从 buffer 开头连续解码，直到末尾，返回值数组。
 * 末尾有半截值时抛 MSGPACK_TRUNCATED（不会静默丢弃）。
 */
function decodeAll(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('msgpack.decodeAll 需要 Buffer');
  }
  const values = [];
  let offset = 0;
  while (offset < buffer.length) {
    const result = decode(buffer, offset);
    values.push(result.value);
    offset = result.offset;
  }
  return values;
}

module.exports = {
  decode,
  decodeAll,
  MsgpackError,
};
