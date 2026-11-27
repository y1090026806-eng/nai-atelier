'use strict';

/**
 * MessagePack 解码器 + V5 图片流解析器的自检脚本（不启动服务、不读写数据目录）。
 * 运行：node scripts/test-msgpack.js
 *
 * 不引入任何依赖：脚本里自带一个「只覆盖测试所需类型」的最小 MessagePack 编码器，
 * 这样测试数据不依赖被测解码器本身，避免自己编码自己解码互相糊弄。
 */

const assert = require('node:assert/strict');
const { decode, decodeAll, MsgpackError } = require('../lib/msgpack');
const { V5StreamParser, parseV5Frames } = require('../lib/nai/v5-stream');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${error && error.message ? error.message : error}`);
  }
}

/* ================================================================== */
/* 测试专用最小 MessagePack 编码器                                     */
/* ================================================================== */

class Ext {
  constructor(type, data) {
    this.type = type;
    this.data = data;
  }
}

function be(value, size) {
  const buffer = Buffer.alloc(size);
  if (size === 1) buffer.writeUInt8(value, 0);
  else if (size === 2) buffer.writeUInt16BE(value, 0);
  else if (size === 4) buffer.writeUInt32BE(value, 0);
  else throw new Error(`be 不支持 ${size} 字节`);
  return buffer;
}

function signedBe(value, size) {
  const buffer = Buffer.alloc(size);
  if (size === 1) buffer.writeInt8(value, 0);
  else if (size === 2) buffer.writeInt16BE(value, 0);
  else if (size === 4) buffer.writeInt32BE(value, 0);
  else if (size === 8) buffer.writeBigInt64BE(BigInt(value), 0);
  else throw new Error(`signedBe 不支持 ${size} 字节`);
  return buffer;
}

function uint64Be(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value), 0);
  return buffer;
}

function encodeNumber(value) {
  // 注意 1e300 这类值 Number.isInteger() 也是 true，测试整数分支必须用 isSafeInteger。
  if (!Number.isSafeInteger(value)) {
    const buffer = Buffer.alloc(9);
    buffer[0] = 0xcb; // float64
    buffer.writeDoubleBE(value, 1);
    return buffer;
  }
  if (value >= 0 && value <= 0x7f) return Buffer.from([value]); // positive fixint
  if (value < 0 && value >= -32) return Buffer.from([0x100 + value]); // negative fixint
  if (value >= 0 && value <= 0xff) return Buffer.concat([be(0xcc, 1), be(value, 1)]);
  if (value >= 0 && value <= 0xffff) return Buffer.concat([be(0xcd, 1), be(value, 2)]);
  if (value >= 0 && value <= 0xffffffff) return Buffer.concat([be(0xce, 1), be(value, 4)]);
  if (value >= 0 && value <= Number.MAX_SAFE_INTEGER) {
    return Buffer.concat([be(0xcf, 1), uint64Be(value)]);
  }
  if (value >= -0x80 && value < 0) return Buffer.concat([be(0xd0, 1), signedBe(value, 1)]);
  if (value >= -0x8000 && value < 0) return Buffer.concat([be(0xd1, 1), signedBe(value, 2)]);
  if (value >= -0x80000000 && value < 0) return Buffer.concat([be(0xd2, 1), signedBe(value, 4)]);
  if (value >= -Number.MAX_SAFE_INTEGER && value < 0) {
    return Buffer.concat([be(0xd3, 1), signedBe(value, 8)]);
  }
  throw new RangeError(`测试编码器不支持整数 ${value}`);
}

function encodeString(value) {
  const data = Buffer.from(value, 'utf8');
  if (data.length <= 31) return Buffer.concat([Buffer.from([0xa0 | data.length]), data]); // fixstr
  if (data.length <= 0xff) return Buffer.concat([Buffer.from([0xd9]), be(data.length, 1), data]);
  if (data.length <= 0xffff) return Buffer.concat([Buffer.from([0xda]), be(data.length, 2), data]);
  return Buffer.concat([Buffer.from([0xdb]), be(data.length, 4), data]);
}

function encodeBin(data) {
  if (data.length <= 0xff) return Buffer.concat([Buffer.from([0xc4]), be(data.length, 1), data]);
  if (data.length <= 0xffff) return Buffer.concat([Buffer.from([0xc5]), be(data.length, 2), data]);
  return Buffer.concat([Buffer.from([0xc6]), be(data.length, 4), data]);
}

function encodeExt(value) {
  const { type, data } = value;
  const typeByte = Buffer.from([type & 0xff]);
  if (data.length === 1) return Buffer.concat([Buffer.from([0xd4]), typeByte, data]);
  if (data.length === 2) return Buffer.concat([Buffer.from([0xd5]), typeByte, data]);
  if (data.length === 4) return Buffer.concat([Buffer.from([0xd6]), typeByte, data]);
  if (data.length === 8) return Buffer.concat([Buffer.from([0xd7]), typeByte, data]);
  if (data.length === 16) return Buffer.concat([Buffer.from([0xd8]), typeByte, data]);
  if (data.length <= 0xff) {
    return Buffer.concat([Buffer.from([0xc7]), be(data.length, 1), typeByte, data]);
  }
  if (data.length <= 0xffff) {
    return Buffer.concat([Buffer.from([0xc8]), be(data.length, 2), typeByte, data]);
  }
  return Buffer.concat([Buffer.from([0xc9]), be(data.length, 4), typeByte, data]);
}

function encodeArray(items) {
  const length = items.length;
  let head;
  if (length <= 15) head = Buffer.from([0x90 | length]); // fixarray
  else if (length <= 0xffff) head = Buffer.concat([Buffer.from([0xdc]), be(length, 2)]);
  else head = Buffer.concat([Buffer.from([0xdd]), be(length, 4)]);
  return Buffer.concat([head, ...items.map(encode)]);
}

function encodeMap(value) {
  const entries = value instanceof Map ? Array.from(value.entries()) : Object.entries(value);
  const length = entries.length;
  let head;
  if (length <= 15) head = Buffer.from([0x80 | length]); // fixmap
  else if (length <= 0xffff) head = Buffer.concat([Buffer.from([0xde]), be(length, 2)]);
  else head = Buffer.concat([Buffer.from([0xdf]), be(length, 4)]);
  const parts = [head];
  for (const [key, item] of entries) {
    parts.push(encode(key), encode(item));
  }
  return Buffer.concat(parts);
}

/** 把 JS 值编码成 MessagePack（只覆盖测试用到的类型与区间）。 */
function encode(value) {
  if (value === null) return Buffer.from([0xc0]);
  if (value === true) return Buffer.from([0xc3]);
  if (value === false) return Buffer.from([0xc2]);
  if (typeof value === 'number') return encodeNumber(value);
  if (typeof value === 'string') return encodeString(value);
  if (Buffer.isBuffer(value)) return encodeBin(value);
  if (Array.isArray(value)) return encodeArray(value);
  if (value instanceof Ext) return encodeExt(value);
  if (typeof value === 'object') return encodeMap(value);
  throw new TypeError(`测试编码器不支持的值：${typeof value}`);
}

/* ================================================================== */
/* lib/msgpack.js                                                      */
/* ================================================================== */

/* 1. nil / 布尔 */
check('nil / true / false', () => {
  assert.equal(decode(encode(null)).value, null);
  assert.equal(decode(encode(true)).value, true);
  assert.equal(decode(encode(false)).value, false);
  assert.equal(decode(encode(null)).offset, 1);
});

/* 2. positive / negative fixint 边界 */
check('fixint 边界：0 / 127 / -1 / -32', () => {
  for (const value of [0, 1, 127, -1, -32]) {
    const buffer = encode(value);
    assert.equal(buffer.length, 1);
    assert.equal(decode(buffer).value, value);
  }
});

/* 3. 各整数区间边界 round-trip */
check('整数区间边界：uint8/16/32、int8/16/32/64', () => {
  const cases = [
    128, 255, 256, 65535, 65536, 4294967295, 4294967296,
    -33, -128, -129, -32768, -32769, -2147483648, -2147483649,
    Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER,
  ];
  for (const value of cases) {
    const buffer = encode(value);
    const result = decode(buffer);
    assert.equal(result.value, value, `值 ${value} 未正确 round-trip`);
    assert.equal(result.offset, buffer.length, `值 ${value} 的 offset 不对`);
  }
});

/* 4. 编码标记落在规范区间（确认测的是真的边界，而不是编码器偷懒） */
check('整数使用正确的类型标记', () => {
  const markers = [
    [0, 0x00], [127, 0x7f],
    [128, 0xcc], [255, 0xcc], [256, 0xcd], [65535, 0xcd],
    [65536, 0xce], [4294967295, 0xce], [4294967296, 0xcf],
    [-1, 0xff], [-32, 0xe0], [-33, 0xd0], [-128, 0xd0],
    [-129, 0xd1], [-32768, 0xd1], [-32769, 0xd2],
    [-2147483648, 0xd2], [-2147483649, 0xd3],
  ];
  for (const [value, marker] of markers) {
    assert.equal(encode(value)[0], marker, `值 ${value} 的首字节应为 0x${marker.toString(16)}`);
    assert.equal(decode(encode(value)).value, value);
  }
});

/* 5. uint64 / int64 的安全整数边界可解 */
check('uint64 / int64 的安全整数边界', () => {
  const cases = [
    [0xcf, Number.MAX_SAFE_INTEGER, 0xcf, uint64Be(Number.MAX_SAFE_INTEGER)],
    [0xd3, -Number.MAX_SAFE_INTEGER, 0xd3, signedBe(-Number.MAX_SAFE_INTEGER, 8)],
  ];
  for (const [, value, marker, payload] of cases) {
    const buffer = Buffer.concat([Buffer.from([marker]), payload]);
    assert.equal(decode(buffer).value, value);
  }
});

/* 6. uint64 超出安全整数必须报错 */
check('uint64 超出 Number.MAX_SAFE_INTEGER 抛 MSGPACK_INVALID', () => {
  const buffer = Buffer.alloc(9);
  buffer[0] = 0xcf;
  buffer.writeBigUInt64BE(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 1);
  assert.throws(
    () => decode(buffer),
    (error) =>
      error instanceof MsgpackError &&
      error.code === 'MSGPACK_INVALID' &&
      error.offset === 0 &&
      /offset 0/.test(error.message),
  );
});

/* 7. int64 低于安全整数必须报错 */
check('int64 低于安全整数范围抛 MSGPACK_INVALID', () => {
  const buffer = Buffer.alloc(9);
  buffer[0] = 0xd3;
  buffer.writeBigInt64BE(-(BigInt(Number.MAX_SAFE_INTEGER) + 1n), 1);
  assert.throws(
    () => decode(buffer),
    (error) => error instanceof MsgpackError && error.code === 'MSGPACK_INVALID',
  );
});

/* 8. float32 / float64 */
check('float32 / float64', () => {
  const doubles = [0.5, -1.25, Math.PI, 1e300, Number.MIN_VALUE];
  for (const value of doubles) {
    const buffer = encode(value);
    assert.equal(buffer[0], 0xcb);
    assert.equal(decode(buffer).value, value);
  }
  const f32 = Buffer.alloc(5);
  f32[0] = 0xca;
  f32.writeFloatBE(1.5, 1);
  assert.equal(decode(f32).value, 1.5);

  const negZero = Buffer.alloc(9);
  negZero[0] = 0xcb;
  negZero.writeDoubleBE(-0, 1);
  assert.ok(Object.is(decode(negZero).value, -0));
});

/* 9. str 长度 31/32 的边界（fixstr → str8） */
check('str 长度边界 31/32', () => {
  const s31 = 'a'.repeat(31);
  const s32 = 'a'.repeat(32);
  assert.equal(encode(s31)[0], 0xbf);
  assert.equal(encode(s32)[0], 0xd9);
  assert.equal(decode(encode(s31)).value, s31);
  assert.equal(decode(encode(s32)).value, s32);
  assert.equal(encode('')[0], 0xa0);
  assert.equal(decode(encode('')).value, '');
});

/* 10. str16 / str32 */
check('str16 / str32 长字符串', () => {
  const s256 = 'b'.repeat(256);
  const s70000 = 'c'.repeat(70000);
  assert.equal(encode(s256)[0], 0xda);
  assert.equal(encode(s70000)[0], 0xdb);
  assert.equal(decode(encode(s256)).value, s256);
  assert.equal(decode(encode(s70000)).value, s70000);
});

/* 11. UTF-8 中文 / emoji round-trip */
check('UTF-8 中文与 emoji round-trip', () => {
  const text = '中文标签：赛博朋克，蓝色长发，霓虹灯🎨';
  const buffer = encode(text);
  const result = decode(buffer);
  assert.equal(result.value, text);
  assert.equal(result.offset, buffer.length);
});

/* 12. bin8 / bin16 / bin32 都还原成 Buffer */
check('bin8 / bin16 / bin32', () => {
  const small = Buffer.from([0, 1, 2, 250, 255]);
  assert.equal(encode(small)[0], 0xc4);
  const smallResult = decode(encode(small));
  assert.ok(Buffer.isBuffer(smallResult.value));
  assert.deepEqual(smallResult.value, small);

  const medium = Buffer.alloc(300, 0xab);
  assert.equal(encode(medium)[0], 0xc5);
  assert.deepEqual(decode(encode(medium)).value, medium);

  const large = Buffer.alloc(70000, 0x5a);
  assert.equal(encode(large)[0], 0xc6);
  assert.deepEqual(decode(encode(large)).value, large);
});

/* 13. fixext1/2/4/8/16 与负 type */
check('fixext 形状 { type, data }', () => {
  const data4 = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
  const buffer4 = encode(new Ext(5, data4));
  assert.equal(buffer4[0], 0xd6);
  const result4 = decode(buffer4);
  assert.equal(result4.value.type, 5);
  assert.ok(Buffer.isBuffer(result4.value.data));
  assert.deepEqual(result4.value.data, data4);

  const buffer1 = encode(new Ext(-1, Buffer.from([9])));
  assert.equal(buffer1[0], 0xd4);
  assert.equal(decode(buffer1).value.type, -1);
});

/* 14. ext8 / ext16 / ext32 */
check('ext8 / ext16 / ext32', () => {
  const ext8 = encode(new Ext(3, Buffer.from([1, 2, 3])));
  assert.equal(ext8[0], 0xc7);
  assert.equal(decode(ext8).value.data.length, 3);

  const data300 = Buffer.alloc(300, 7);
  const ext16 = encode(new Ext(1, data300));
  assert.equal(ext16[0], 0xc8);
  assert.deepEqual(decode(ext16).value.data, data300);

  const data70000 = Buffer.alloc(70000, 3);
  const ext32 = encode(new Ext(2, data70000));
  assert.equal(ext32[0], 0xc9);
  assert.deepEqual(decode(ext32).value.data, data70000);
});

/* 15. map / array 嵌套 */
check('map / array 嵌套 round-trip', () => {
  const value = {
    a: [1, 2, { b: '中文' }],
    d: { e: true, f: null },
    g: false,
    h: [true, [-1, -32]],
  };
  assert.deepEqual(decode(encode(value)).value, value);
});

/* 16. array16 / map16（超过 fix 上限） */
check('array16 / map16', () => {
  const array = Array.from({ length: 16 }, (_, index) => index);
  assert.equal(encode(array)[0], 0xdc);
  assert.deepEqual(decode(encode(array)).value, array);

  const map = {};
  for (let index = 0; index < 16; index += 1) map[`k${index}`] = index;
  assert.equal(encode(map)[0], 0xde);
  assert.deepEqual(decode(encode(map)).value, map);
});

/* 17. map 的数字 key 转字符串 */
check('map 数字 key 转成字符串 key', () => {
  const encoded = encode(new Map([[1, 'one'], [0, 'zero'], [-1, 'minus']]));
  const decoded = decode(encoded).value;
  assert.deepEqual(decoded, { 1: 'one', 0: 'zero', '-1': 'minus' });
});

/* 18. __proto__ key 不能污染原型 */
check('map 的 __proto__ key 不污染原型', () => {
  const decoded = decode(encode(new Map([['__proto__', 'safe'], ['x', 1]]))).value;
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(decoded, '__proto__'), true);
  assert.equal(decoded.__proto__, 'safe');
  assert.equal({}.safe, undefined);
});

/* 19. decode 支持从 offset 开始 */
check('decode 从指定 offset 解第二个值', () => {
  const first = encode(1);
  const second = encode('two');
  const joined = Buffer.concat([first, second]);
  const result = decode(joined, first.length);
  assert.equal(result.value, 'two');
  assert.equal(result.offset, joined.length);
});

/* 20. decodeAll */
check('decodeAll 连续解码与空 buffer', () => {
  const joined = Buffer.concat([encode(1), encode('two'), encode([true])]);
  assert.deepEqual(decodeAll(joined), [1, 'two', [true]]);
  assert.deepEqual(decodeAll(Buffer.alloc(0)), []);
});

/* 21. decodeAll 末尾半截值不能静默丢弃 */
check('decodeAll 末尾半截值抛 MSGPACK_TRUNCATED', () => {
  const buffer = Buffer.concat([encode(1), Buffer.from([0xcc])]);
  assert.throws(
    () => decodeAll(buffer),
    (error) => error instanceof MsgpackError && error.code === 'MSGPACK_TRUNCATED',
  );
});

/* 22. 各类截断输入：code、offset、message 都要合理 */
check('截断输入统一抛 MSGPACK_TRUNCATED 且 offset 合理', () => {
  const cases = [
    ['空 buffer', Buffer.alloc(0)],
    ['uint8 缺值', Buffer.from([0xcc])],
    ['uint32 缺 2 字节', Buffer.from([0xce, 0x00, 0x00])],
    ['uint64 缺 4 字节', Buffer.from([0xcf, 0x00, 0x00, 0x00, 0x00])],
    ['float64 缺 4 字节', Buffer.from([0xcb, 0x00, 0x00, 0x00, 0x00])],
    ['str8 缺长度', Buffer.from([0xd9])],
    ['fixstr 缺内容', Buffer.from([0xa5, 0x61, 0x62])],
    ['fixarray 缺元素', Buffer.from([0x92, 0x01])],
    ['fixmap 缺 value', Buffer.from([0x81, 0xa1, 0x61])],
    ['array16 缺元素', Buffer.from([0xdc, 0x00, 0x10])],
    ['ext8 缺 data', Buffer.from([0xc7, 0x04, 0x01, 0x00])],
  ];
  for (const [label, buffer] of cases) {
    assert.throws(
      () => decode(buffer),
      (error) => {
        assert.ok(error instanceof MsgpackError, `${label}：错误类型不是 MsgpackError`);
        assert.equal(error.code, 'MSGPACK_TRUNCATED', `${label}：code 不对`);
        assert.equal(error.offset, buffer.length, `${label}：offset 应指向缺失字节处`);
        assert.ok(error.message.includes(`offset ${buffer.length}`), `${label}：message 缺少 offset`);
        return true;
      },
      label,
    );
  }
});

/* 23. 未知类型标记 */
check('未知类型 0xc1 抛 MSGPACK_INVALID', () => {
  assert.throws(
    () => decode(Buffer.from([0xc1])),
    (error) =>
      error instanceof MsgpackError &&
      error.code === 'MSGPACK_INVALID' &&
      error.offset === 0 &&
      error.message.includes('offset 0'),
  );
});

/* 24. 嵌套里的未知类型：offset 指向出事字节 */
check('嵌套中的未知类型 offset 指向出错字节', () => {
  assert.throws(
    () => decode(Buffer.from([0x92, 0x01, 0xc1])),
    (error) =>
      error instanceof MsgpackError &&
      error.code === 'MSGPACK_INVALID' &&
      error.offset === 2,
  );
});

/* ================================================================== */
/* lib/nai/v5-stream.js                                                */
/* ================================================================== */

const IMAGE_FINAL = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);
const IMAGE_PREVIEW = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xaa, 0xbb]);

function v5Header(length) {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(length, 0);
  return header;
}

/** 按协议拼一帧：4 字节大端长度 + msgpack 负载。 */
function v5Frame(payload) {
  const body = encode(payload);
  return Buffer.concat([v5Header(body.length), body]);
}

function finalPayload(extra = {}) {
  return { event_type: 'final', samp_ix: 0, step: 28, image: IMAGE_FINAL, ...extra };
}

/* 25. 单帧 final 的完整事件形状 */
check('单帧 final：完整事件形状', () => {
  const payload = finalPayload();
  const events = parseV5Frames(v5Frame(payload));
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.type, 'final');
  assert.equal(event.eventType, 'final');
  assert.equal(event.sampIx, 0);
  assert.ok(Buffer.isBuffer(event.image));
  assert.deepEqual(event.image, IMAGE_FINAL);
  assert.deepEqual(event.raw, payload);
});

/* 26. final 缺少 samp_ix 时默认 0 */
check('final 缺少 samp_ix 时按 0 处理', () => {
  const events = parseV5Frames(v5Frame({ event_type: 'final', image: IMAGE_FINAL }));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'final');
  assert.equal(events[0].sampIx, 0);
});

/* 27. 多帧：intermediate + final */
check('多帧 intermediate + final', () => {
  const stream = Buffer.concat([
    v5Frame({ event_type: 'intermediate', samp_ix: 0, step: 4, image: IMAGE_PREVIEW }),
    v5Frame({ event_type: 'intermediate', samp_ix: 0, step: 8 }),
    v5Frame(finalPayload()),
  ]);
  const events = parseV5Frames(stream);
  assert.deepEqual(events.map((event) => event.type), ['intermediate', 'intermediate', 'final']);
  assert.equal(events[0].step, 4);
  assert.deepEqual(events[0].image, IMAGE_PREVIEW);
  assert.equal(events[1].step, 8);
  assert.equal('image' in events[1], false);
  assert.equal(events[2].type, 'final');
  assert.deepEqual(events[2].image, IMAGE_FINAL);
});

/* 28. 长度前缀跨 chunk（逐字节喂入） */
check('长度前缀跨 chunk：逐字节喂入', () => {
  const frame = v5Frame(finalPayload());
  const parser = new V5StreamParser();
  const events = [];
  for (let index = 0; index < frame.length; index += 1) {
    events.push(...parser.push(frame.subarray(index, index + 1)));
  }
  events.push(...parser.end());
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'final');
  assert.deepEqual(events[0].image, IMAGE_FINAL);
});

/* 29. 帧体跨 chunk（长度前缀、帧体各切一刀） */
check('帧体跨 chunk：不规则切分', () => {
  const frame = v5Frame(finalPayload());
  const parser = new V5StreamParser();
  let events = [];
  let cursor = 0;
  for (const cut of [2, 5, 6, 11, frame.length]) {
    events = events.concat(parser.push(frame.subarray(cursor, cut)));
    cursor = cut;
  }
  events = events.concat(parser.end());
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'final');
  assert.deepEqual(events[0].image, IMAGE_FINAL);
});

/* 30. 任意切分位置结果一致（穷举双段切分） */
check('任意切分位置解析结果一致', () => {
  const stream = Buffer.concat([
    v5Frame({ event_type: 'intermediate', samp_ix: 0, step: 2 }),
    v5Frame({ event_type: 'intermediate', samp_ix: 0, step: 6, image: IMAGE_PREVIEW }),
    v5Frame(finalPayload()),
  ]);
  const whole = parseV5Frames(stream);
  for (let cut = 1; cut < stream.length; cut += 1) {
    const parser = new V5StreamParser();
    const events = parser
      .push(stream.subarray(0, cut))
      .concat(parser.push(stream.subarray(cut)))
      .concat(parser.end());
    assert.equal(events.length, whole.length, `切在 ${cut} 时事件数不对`);
    assert.deepEqual(events.map((event) => event.type), whole.map((event) => event.type));
    assert.deepEqual(events[events.length - 1].image, IMAGE_FINAL);
  }
});

/* 31. samp_ix !== 0 的 final 必须降级成 intermediate */
check('samp_ix=1/2/3 的 final 降级为 intermediate', () => {
  for (const sampIx of [1, 2, 3]) {
    const events = parseV5Frames(
      v5Frame({ event_type: 'final', samp_ix: sampIx, step: 12, image: IMAGE_PREVIEW }),
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'intermediate');
    assert.equal(events[0].eventType, 'intermediate');
    assert.equal(events[0].step, 12);
    assert.deepEqual(events[0].image, IMAGE_PREVIEW);
    assert.equal(events[0].raw.event_type, 'final');
  }
});

/* 32. error 事件 */
check('error 事件（message / statusCode / raw）', () => {
  const payload = { event_type: 'error', message: 'Insufficient Anlas', status_code: 402 };
  const events = parseV5Frames(v5Frame(payload));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].message, 'Insufficient Anlas');
  assert.equal(events[0].statusCode, 402);
  assert.deepEqual(events[0].raw, payload);
});

/* 33. error 没有 status_code 时不伪造字段 */
check('error 事件缺少 status_code 时不带 statusCode', () => {
  const events = parseV5Frames(v5Frame({ event_type: 'error', message: 'boom' }));
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].message, 'boom');
  assert.equal('statusCode' in events[0], false);
});

/* 34. 未知 event_type 归 other */
check('未知 event_type 归为 other', () => {
  const payload = { event_type: 'progress', step: 3 };
  const events = parseV5Frames(v5Frame(payload));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'other');
  assert.deepEqual(events[0].raw, payload);
});

/* 35. 缺 event_type 归 other */
check('缺少 event_type 归为 other', () => {
  const events = parseV5Frames(v5Frame({ step: 1 }));
  assert.equal(events[0].type, 'other');
});

/* 36. 0 长度帧跳过且不影响后续帧 */
check('0 长度帧跳过', () => {
  const events = parseV5Frames(
    Buffer.concat([v5Header(0), v5Frame(finalPayload()), v5Header(0)]),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'final');
  assert.deepEqual(events[0].image, IMAGE_FINAL);
});

/* 37. 只有 0 长度帧的流正常结束 */
check('只有 0 长度帧时正常结束', () => {
  assert.deepEqual(parseV5Frames(Buffer.concat([v5Header(0), v5Header(0)])), []);
});

/* 38. 未完成的长度前缀在 end() 报错 */
check('未完成的长度前缀在 end() 抛 V5_STREAM_TRUNCATED', () => {
  const parser = new V5StreamParser();
  assert.deepEqual(parser.push(Buffer.from([0x00, 0x00])), []);
  assert.throws(
    () => parser.end(),
    (error) =>
      error.code === 'V5_STREAM_TRUNCATED' &&
      error.received === 2 &&
      error.expected === 4 &&
      /已收 2 字节/.test(error.message) &&
      /期望 4 字节/.test(error.message),
  );
});

/* 39. 未完成的帧体在 end() 报错，带已收/期望字节数 */
check('未完成的帧体在 end() 抛 V5_STREAM_TRUNCATED', () => {
  const body = encode(finalPayload());
  const expected = 4 + body.length;
  const parser = new V5StreamParser();
  assert.deepEqual(parser.push(Buffer.concat([v5Header(body.length), body.subarray(0, 3)])), []);
  assert.throws(
    () => parser.end(),
    (error) => {
      assert.equal(error.code, 'V5_STREAM_TRUNCATED');
      assert.equal(error.received, 7);
      assert.equal(error.expected, expected);
      assert.ok(error.message.includes('已收 7 字节'));
      assert.ok(error.message.includes(`期望 ${expected} 字节`));
      return true;
    },
  );
});

/* 40. parseV5Frames 空 buffer */
check('parseV5Frames 空 buffer 返回空数组', () => {
  assert.deepEqual(parseV5Frames(Buffer.alloc(0)), []);
});

/* 41. 单帧超过 maxFrameBytes 立刻报错 */
check('单帧长度超过 maxFrameBytes 抛 V5_FRAME_TOO_LARGE', () => {
  const parser = new V5StreamParser({ maxFrameBytes: 32 });
  assert.throws(
    () => parser.push(v5Header(33)),
    (error) => error.code === 'V5_FRAME_TOO_LARGE' && error.message.includes('33'),
  );
});

/* 42. 荒谬长度前缀（0xffffffff）不能挂死 */
check('荒谬长度前缀 0xffffffff 抛 V5_FRAME_TOO_LARGE', () => {
  const parser = new V5StreamParser();
  assert.throws(
    () => parser.push(v5Header(0xffffffff)),
    (error) => error.code === 'V5_FRAME_TOO_LARGE',
  );
});

/* 43. 累计字节超 maxTotalBytes */
check('累计字节超过 maxTotalBytes 抛 V5_STREAM_TOO_LARGE', () => {
  const parser = new V5StreamParser({ maxTotalBytes: 32 });
  assert.throws(
    () => parser.push(v5Frame(finalPayload())),
    (error) => error.code === 'V5_STREAM_TOO_LARGE' && /超过上限/.test(error.message),
  );
});

/* 44. 帧负载不是 map：字符串 */
check('字符串负载抛 V5_STREAM_INVALID_FRAME', () => {
  const body = encode('这不是 map');
  const frame = Buffer.concat([v5Header(body.length), body]);
  assert.throws(
    () => parseV5Frames(frame),
    (error) => error.code === 'V5_STREAM_INVALID_FRAME' && /不是 map/.test(error.message),
  );
});

/* 45. 帧负载不是 map：数组 */
check('数组负载抛 V5_STREAM_INVALID_FRAME', () => {
  const body = encode([1, 2, 3]);
  const frame = Buffer.concat([v5Header(body.length), body]);
  assert.throws(
    () => parseV5Frames(frame),
    (error) => error.code === 'V5_STREAM_INVALID_FRAME',
  );
});

/* 46. 帧内 msgpack 损坏：包一层 V5_STREAM_INVALID_FRAME 并保留 cause */
check('帧内 MessagePack 损坏抛 V5_STREAM_INVALID_FRAME', () => {
  // fixmap(1) + fixstr 'a'，value 缺失 → msgpack 截断
  const frame = Buffer.concat([v5Header(3), Buffer.from([0x81, 0xa1, 0x61])]);
  assert.throws(
    () => parseV5Frames(frame),
    (error) =>
      error.code === 'V5_STREAM_INVALID_FRAME' &&
      error.cause &&
      error.cause.code === 'MSGPACK_TRUNCATED',
  );
});

/* 47. 结束后再 push 明确报错 */
check('结束后再 push 抛 V5_STREAM_ENDED', () => {
  const parser = new V5StreamParser();
  parser.push(v5Frame(finalPayload()));
  assert.deepEqual(parser.end(), []);
  assert.throws(
    () => parser.push(Buffer.alloc(1)),
    (error) => error.code === 'V5_STREAM_ENDED',
  );
});

/* 48. 真实形状：多张图各自的 final 帧（samp_ix 1..3）+ 整张图的 final */
check('真实形状：samp_ix 1..3 帧 + samp_ix 0 final', () => {
  const frames = [1, 2, 3].map((sampIx) =>
    v5Frame({ event_type: 'final', samp_ix: sampIx, step: 28, image: IMAGE_PREVIEW }),
  );
  frames.push(v5Frame(finalPayload()));
  const events = parseV5Frames(Buffer.concat(frames));
  assert.deepEqual(
    events.map((event) => event.type),
    ['intermediate', 'intermediate', 'intermediate', 'final'],
  );
  assert.ok(events.slice(0, 3).every((event) => Buffer.isBuffer(event.image)));
  assert.deepEqual(events[events.length - 1].image, IMAGE_FINAL);
});

/* ================================================================== */
/* 汇总                                                                */
/* ================================================================== */

console.log(`\n${passed}/${passed + failed} 项通过`);
process.exit(failed > 0 ? 1 : 0);
