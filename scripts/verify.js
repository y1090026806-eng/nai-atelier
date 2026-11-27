#!/usr/bin/env node
'use strict';

/**
 * NAI Atelier 自检脚本（npm run verify）
 *
 * 用临时数据目录和本地假上游（假 LLM / 假 NovelAI）启动真实 server.js，
 * 验证配置、标签生成、提示词拼接、模型拉取、重绘、错误处理和重启恢复。
 *
 * - 不会读取或修改真实 data/ 、outputs/ 和 API Key
 * - 不会访问外网，不消耗任何额度
 * - 全部使用临时目录，结束时自动删除
 */

const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const AdmZip = require('adm-zip');

const ROOT = path.resolve(__dirname, '..');
const { normalizeConfig } = require(path.join(ROOT, 'server.js'));
const APP_VERSION = require(path.join(ROOT, 'package.json')).version;
const TEMP_ROOT = path.join(os.tmpdir(), `nai-atelier-verify-${process.pid}-${Date.now()}`);
const DATA_DIR = path.join(TEMP_ROOT, 'data');
const OUTPUTS_DIR = path.join(TEMP_ROOT, 'outputs');

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  if (condition) {
    results.push(`  ok   ${name}`);
  } else {
    failures += 1;
    results.push(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/* ----------------------------------------------------------------------- */
/* Mock upstream                                                            */
/* ----------------------------------------------------------------------- */

const mock = {
  port: 0,
  server: null,
  llmMode: 'ok', // ok | error
  naiMode: 'ok', // ok | error | no-image | slow
  llmRequests: [],
  modelRequests: [],
  naiRequests: [],
  naiAborts: 0, // aborted NovelAI requests (used to verify job cancellation)
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const MOCK_LLM_TAGS =
  'Here are the tags:\n```\n1girl, solo, rain, city_lights\n```\nTITLE: 雨夜电车月台';

const MOCK_LLM_STRUCTURED = JSON.stringify({
  title: '双人雨夜',
  scene: '2girls, rain, city_lights, night',
  characters: [
    { name: '少女', prompt: '1girl, silver hair, school uniform', center: { x: 0.33, y: 0.5 } },
    { name: '同伴', prompt: '1girl, black hair, coat', center: { x: 0.67, y: 0.5 } },
  ],
  negative: 'lowres, bad anatomy',
});

function buildZip(entries) {
  const zip = new AdmZip();
  for (const [name, buffer] of entries) zip.addFile(name, buffer);
  return zip.toBuffer();
}

/* ----------------------------------------------------------------------- */
/* 极简 MessagePack 编码器 —— 只用于 mock 的 V5 流式响应                     */
/* ----------------------------------------------------------------------- */

function encodeMsgpack(value) {
  if (value === null || value === undefined) return Buffer.from([0xc0]);
  if (typeof value === 'boolean') return Buffer.from([value ? 0xc3 : 0xc2]);

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      const buf = Buffer.alloc(9);
      buf[0] = 0xcb;
      buf.writeDoubleBE(value, 1);
      return buf;
    }
    if (value >= 0) {
      if (value < 0x80) return Buffer.from([value]);
      if (value < 0x100) return Buffer.from([0xcc, value]);
      if (value < 0x10000) {
        const buf = Buffer.alloc(3);
        buf[0] = 0xcd;
        buf.writeUInt16BE(value, 1);
        return buf;
      }
      const buf = Buffer.alloc(5);
      buf[0] = 0xce;
      buf.writeUInt32BE(value, 1);
      return buf;
    }
    if (value >= -32) return Buffer.from([0x100 + value]);
    const buf = Buffer.alloc(3);
    buf[0] = 0xd1;
    buf.writeInt16BE(value, 1);
    return buf;
  }

  if (typeof value === 'string') {
    const text = Buffer.from(value, 'utf8');
    if (text.length < 32) return Buffer.concat([Buffer.from([0xa0 | text.length]), text]);
    if (text.length < 0x100) return Buffer.concat([Buffer.from([0xd9, text.length]), text]);
    const head = Buffer.alloc(3);
    head[0] = 0xda;
    head.writeUInt16BE(text.length, 1);
    return Buffer.concat([head, text]);
  }

  if (Buffer.isBuffer(value)) {
    if (value.length < 0x100) return Buffer.concat([Buffer.from([0xc4, value.length]), value]);
    const head = Buffer.alloc(3);
    head[0] = 0xc5;
    head.writeUInt16BE(value.length, 1);
    return Buffer.concat([head, value]);
  }

  if (Array.isArray(value)) {
    const head = value.length < 16 ? Buffer.from([0x90 | value.length]) : null;
    const parts = value.map(encodeMsgpack);
    if (head) return Buffer.concat([head, ...parts]);
    const big = Buffer.alloc(3);
    big[0] = 0xdc;
    big.writeUInt16BE(value.length, 1);
    return Buffer.concat([big, ...parts]);
  }

  const entries = Object.entries(value);
  const parts = [];
  for (const [key, item] of entries) {
    parts.push(encodeMsgpack(key), encodeMsgpack(item));
  }
  if (entries.length < 16) return Buffer.concat([Buffer.from([0x80 | entries.length]), ...parts]);
  const head = Buffer.alloc(3);
  head[0] = 0xde;
  head.writeUInt16BE(entries.length, 1);
  return Buffer.concat([head, ...parts]);
}

/** 一帧 = 4 字节大端长度 + msgpack 负载。 */
function msgpackFrame(value) {
  const payload = encodeMsgpack(value);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(payload.length, 0);
  return Buffer.concat([head, payload]);
}

/** V5 请求是 multipart，只有一个字段 request，内容是 JSON。 */
function parseMultipartRequest(body) {
  const marker = body.indexOf('name="request"');
  if (marker < 0) return null;
  const bodyStart = body.indexOf('\r\n\r\n', marker);
  if (bodyStart < 0) return null;
  const bodyEnd = body.lastIndexOf('\r\n--');
  const json = body
    .subarray(bodyStart + 4, bodyEnd < 0 ? body.length : bodyEnd)
    .toString('utf8');
  return JSON.parse(json);
}

async function startMock() {
  mock.port = await freePort();
  mock.server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${mock.port}`);
    const body = await readBody(req);

    if (url.pathname === '/__mode' && req.method === 'POST') {
      const parsed = JSON.parse(body.toString('utf8') || '{}');
      if (parsed.llmMode) mock.llmMode = parsed.llmMode;
      if (parsed.naiMode) mock.naiMode = parsed.naiMode;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }

    if (/\/chat\/completions$/i.test(url.pathname)) {
      mock.llmRequests.push({ body: JSON.parse(body.toString('utf8')), auth: req.headers.authorization });
      if (mock.llmMode === 'error') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end('{"error":{"message":"mock bad key"}}');
        return;
      }
      const content = mock.llmMode === 'structured' ? MOCK_LLM_STRUCTURED : MOCK_LLM_TAGS;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content }, finish_reason: 'stop' }],
        }),
      );
      return;
    }

    if (/\/models$/i.test(url.pathname)) {
      mock.modelRequests.push({ auth: req.headers.authorization });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'mock-chat' }, { id: 'models/gemini-mock' }, { id: 'z-alt' }],
        }),
      );
      return;
    }

    if (url.pathname === '/ai/generate-image-stream') {
      const parsed = parseMultipartRequest(body);
      mock.naiRequests.push(parsed);
      if (mock.naiMode === 'error') {
        res.writeHead(402, { 'Content-Type': 'application/json' });
        res.end('{"message":"mock anlas shortage"}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/x-msgpack' });
      if (mock.naiMode === 'no-image') {
        res.end(msgpackFrame({ event_type: 'error', message: 'mock no image' }));
        return;
      }
      if (mock.naiMode === 'slow') {
        let responded = false;
        const noteAbort = () => {
          if (!responded) mock.naiAborts += 1;
        };
        req.on('aborted', noteAbort);
        res.on('close', noteAbort);
        await sleep(2500);
        if (res.destroyed || res.writableEnded) return;
        responded = true;
      }
      res.write(msgpackFrame({ event_type: 'intermediate', samp_ix: 0, step_ix: 1, image: PNG_1PX }));
      res.end(msgpackFrame({ event_type: 'final', samp_ix: 0, step_ix: 2, image: PNG_1PX }));
      return;
    }

    if (url.pathname === '/ai/generate-image') {
      mock.naiRequests.push(JSON.parse(body.toString('utf8')));
      if (mock.naiMode === 'error') {
        res.writeHead(402, { 'Content-Type': 'application/json' });
        res.end('{"message":"mock anlas shortage"}');
        return;
      }
      if (mock.naiMode === 'no-image') {
        res.writeHead(200, { 'Content-Type': 'application/zip' });
        res.end(buildZip([['readme.txt', Buffer.from('no images')]]));
        return;
      }
      if (mock.naiMode === 'slow') {
        // Slow ZIP so the verify suite can cancel a job while it is running.
        // `responded` guards the abort counter: closing after a normal response
        // must not be counted as an aborted upstream request.
        let responded = false;
        const noteAbort = () => {
          if (!responded) mock.naiAborts += 1;
        };
        req.on('aborted', noteAbort);
        res.on('close', noteAbort);
        await sleep(2500);
        if (res.destroyed || res.writableEnded) return;
        responded = true;
        res.writeHead(200, { 'Content-Type': 'application/zip' });
        res.end(buildZip([['image_0.png', PNG_1PX]]));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      res.end(buildZip([['image_0.png', PNG_1PX]]));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"mock route not found"}');
  });

  await new Promise((resolve) => mock.server.listen(mock.port, '127.0.0.1', resolve));
  return `http://127.0.0.1:${mock.port}`;
}

/* ----------------------------------------------------------------------- */
/* App process                                                              */
/* ----------------------------------------------------------------------- */

const app = { process: null, port: 0, base: '' };

async function startApp() {
  app.port = await freePort();
  app.base = `http://127.0.0.1:${app.port}`;

  const stdout = fs.openSync(path.join(TEMP_ROOT, 'app.out.log'), 'a');
  const stderr = fs.openSync(path.join(TEMP_ROOT, 'app.err.log'), 'a');

  app.process = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(app.port),
      HOST: '127.0.0.1',
      DATA_DIR,
      OUTPUTS_DIR,
    },
    stdio: ['ignore', stdout, stderr],
    windowsHide: true,
  });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${app.base}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return;
    } catch {
      /* still booting */
    }
    await sleep(120);
  }
  throw new Error('server.js 未能在超时时间内启动');
}

async function stopApp() {
  if (!app.process) return;
  const proc = app.process;
  app.process = null;
  proc.kill();
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (proc.exitCode !== null) return;
    await sleep(60);
  }
  proc.kill('SIGKILL');
}

/* ----------------------------------------------------------------------- */
/* HTTP helpers                                                             */
/* ----------------------------------------------------------------------- */

async function request(method, route, { body, headers = {}, raw = false } = {}) {
  const options = {
    method,
    headers: { ...headers },
    signal: AbortSignal.timeout(20_000),
  };
  if (body !== undefined) {
    options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const response = await fetch(`${app.base}${route}`, options);
  const text = await response.text();
  if (raw) return { status: response.status, text, headers: response.headers };

  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { status: response.status, body: payload, text, headers: response.headers };
}

function parseSse(text) {
  const events = [];
  for (const block of text.split('\n\n')) {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (data.length) {
      try {
        events.push({ event, data: JSON.parse(data.join('\n')) });
      } catch {
        /* ignore malformed frame */
      }
    }
  }
  return events;
}

const generate = (text, { stream = false, albumId = null } = {}) =>
  request('POST', '/api/generate', {
    body: albumId ? { text, albumId } : { text },
    headers: { Accept: stream ? 'text/event-stream' : 'application/json' },
  });

const rerender = (id, options = {}, { stream = false } = {}) =>
  request('POST', `/api/history/${encodeURIComponent(id)}/rerender`, {
    body: options,
    headers: { Accept: stream ? 'text/event-stream' : 'application/json' },
  });

const createAlbum = (name) => request('POST', '/api/albums', { body: { name } });
const renameAlbum = (id, name) =>
  request('POST', `/api/albums/${encodeURIComponent(id)}`, { body: { name } });
const deleteAlbum = (id) =>
  request('DELETE', `/api/albums/${encodeURIComponent(id)}`);
const moveHistoryItem = (id, albumId) =>
  request('POST', `/api/history/${encodeURIComponent(id)}/album`, {
    body: { albumId },
  });
const deleteHistory = (id) =>
  request('DELETE', `/api/history/${encodeURIComponent(id)}`);

const setConfig = (partial) => request('POST', '/api/config', { body: partial });

/* 1.6.0 新功能用到的 HTTP 辅助函数 */
const setMockMode = (patch) =>
  fetch(`http://127.0.0.1:${mock.port}/__mode`, {
    method: 'POST',
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(5000),
  });

const getHistory = () => request('GET', '/api/history');
const getAlbums = () => request('GET', '/api/albums');
const getTrash = () => request('GET', '/api/trash');
const getPrompts = () => request('GET', '/api/prompts');
const getJobs = () => request('GET', '/api/jobs');
const getRecords = () => request('GET', '/api/records');
const updateVariant = (recordId, variantId, body) =>
  request(
    'PATCH',
    `/api/records/${encodeURIComponent(recordId)}/variants/${encodeURIComponent(variantId)}`,
    { body },
  );

const setAlbumCover = (albumId, historyId) =>
  request('POST', `/api/albums/${encodeURIComponent(albumId)}/cover`, {
    body: { historyId },
  });
const reorderHistory = (ids) =>
  request('POST', '/api/history/order', { body: { ids } });
const batchMoveHistory = (ids, albumId) =>
  request('POST', '/api/history/batch-album', { body: { ids, albumId } });
const batchDeleteHistory = (ids) =>
  request('POST', '/api/history/batch-delete', { body: { ids } });
const restoreTrashItem = (id) =>
  request('POST', `/api/trash/${encodeURIComponent(id)}/restore`);
const deleteTrashItem = (id) =>
  request('DELETE', `/api/trash/${encodeURIComponent(id)}`);
const emptyTrashBin = () => request('DELETE', '/api/trash');

const savePrompt = (body) => request('POST', '/api/prompts', { body });
const removePrompt = (id) =>
  request('DELETE', `/api/prompts/${encodeURIComponent(id)}`);

const enqueueJob = (body) => request('POST', '/api/jobs', { body });
const cancelJob = (id) =>
  request('POST', `/api/jobs/${encodeURIComponent(id)}/cancel`);
const cancelAllJobs = () => request('POST', '/api/jobs/cancel-all');
const removeJob = (id) =>
  request('DELETE', `/api/jobs/${encodeURIComponent(id)}`);

const readDataJson = async (name) =>
  JSON.parse(await fsp.readFile(path.join(DATA_DIR, name), 'utf8'));

const historyIds = async () =>
  ((await getHistory()).body?.items || []).map((item) => item.id);

const findTrashEntry = async (predicate) =>
  ((await getTrash()).body?.items || []).find(predicate) || null;

/** Poll GET /api/jobs until the job reaches a terminal state (or timeout). */
async function waitForJob(id, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const list = await getJobs();
    last = (list.body?.jobs || []).find((job) => job.id === id) || last;
    if (last && ['done', 'error', 'canceled'].includes(last.status)) return last;
    await sleep(80);
  }
  return last;
}

/** Poll GET /api/jobs until the job satisfies `predicate` (or timeout). */
async function waitForJobCondition(id, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const list = await getJobs();
    last = (list.body?.jobs || []).find((job) => job.id === id) || last;
    if (last && predicate(last)) return last;
    await sleep(50);
  }
  return last;
}

/* ----------------------------------------------------------------------- */
/* 1.8.0 metadata helpers: sidecar JSON + PNG tEXt/iTXt chunks             */
/* ----------------------------------------------------------------------- */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IMAGE_EXTENSION_RE = /\.(png|jpe?g|webp)$/i;
const OUTPUT_ROOT = OUTPUTS_DIR;
const OWN_METADATA_KEYWORDS = new Set(['parameters', 'NAI-Atelier']);

let verifyCrcTable = null;

function verifyCrc32(buffer) {
  if (!verifyCrcTable) {
    verifyCrcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let value = n;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      verifyCrcTable[n] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = verifyCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Walk a PNG and return every chunk (length/type/data/crc validity). */
function readPngChunks(buffer) {
  const info = {
    signatureValid:
      buffer.length >= PNG_SIGNATURE.length &&
      buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE),
    structValid: true,
    chunks: [],
  };
  if (!info.signatureValid) return info;

  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= buffer.length) {
    const chunkStart = offset;
    const length = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.length) {
      info.structValid = false;
      break;
    }
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const storedCrc = buffer.readUInt32BE(offset + 8 + length);
    const crcValid =
      storedCrc === verifyCrc32(Buffer.concat([Buffer.from(type, 'ascii'), data]));
    info.chunks.push({ type, data, crcValid, offset: chunkStart });
    offset = chunkEnd;
    if (type === 'IEND') break;
  }
  // A well-formed file ends exactly after IEND (no trailing garbage).
  info.structValid = info.structValid && offset === buffer.length;
  return info;
}

/** Decode one tEXt/iTXt payload; iTXt text is read as UTF-8. */
function parsePngTextChunkData(type, data) {
  const keywordEnd = data.indexOf(0);
  if (keywordEnd < 0) return null;
  const keyword = data.subarray(0, keywordEnd).toString('latin1');

  if (type === 'tEXt') {
    return { type, keyword, text: data.subarray(keywordEnd + 1).toString('latin1') };
  }
  if (type !== 'iTXt') return null;

  // keyword + NUL + compression flag + method + language tag + NUL
  // + translated keyword + NUL + UTF-8 text (our writer emits five NULs).
  const compressionFlag = data[keywordEnd + 1];
  const compressionMethod = data[keywordEnd + 2];
  const languageEnd = data.indexOf(0, keywordEnd + 3);
  if (languageEnd < 0) return null;
  const translatedEnd = data.indexOf(0, languageEnd + 1);
  if (translatedEnd < 0) return null;
  return {
    type,
    keyword,
    compressed: compressionFlag === 1,
    compressionMethod,
    languageTag: data.subarray(keywordEnd + 3, languageEnd).toString('latin1'),
    translatedKeyword: data.subarray(languageEnd + 1, translatedEnd).toString('latin1'),
    text: data.subarray(translatedEnd + 1).toString('utf8'),
    keywordEnd,
  };
}

/** Parse our own `parameters` + `NAI-Atelier` metadata out of a PNG buffer. */
function parseEmbeddedPngMetadata(buffer) {
  const png = readPngChunks(buffer);
  const textChunks = [];
  png.chunks.forEach((chunk, index) => {
    if (chunk.type !== 'tEXt' && chunk.type !== 'iTXt') return;
    const parsed = parsePngTextChunkData(chunk.type, chunk.data);
    if (parsed) textChunks.push({ ...parsed, index });
  });
  const own = textChunks.filter(
    (entry) => entry.keyword === 'parameters' || entry.keyword === 'NAI-Atelier',
  );
  const parametersChunk = own.find((entry) => entry.keyword === 'parameters') || null;
  const jsonChunk = own.find((entry) => entry.keyword === 'NAI-Atelier') || null;
  let metadata = null;
  if (jsonChunk) {
    try {
      metadata = JSON.parse(jsonChunk.text);
    } catch {
      metadata = null;
    }
  }
  const chunkTypes = png.chunks.map((chunk) => chunk.type);
  return {
    png,
    textChunks,
    own,
    parametersChunk,
    jsonChunk,
    metadata,
    chunkTypes,
    iendIndex: chunkTypes.indexOf('IEND'),
    structureValid:
      png.signatureValid &&
      png.structValid &&
      png.chunks.length >= 3 &&
      chunkTypes[0] === 'IHDR' &&
      chunkTypes[chunkTypes.length - 1] === 'IEND' &&
      png.chunks.every((chunk) => chunk.crcValid),
  };
}

/** Remove only NAI Atelier's own text chunks, keeping every other chunk byte-identical. */
function stripOwnPngChunks(buffer) {
  const png = readPngChunks(buffer);
  if (!png.signatureValid) return buffer;
  const parts = [PNG_SIGNATURE];
  for (const chunk of png.chunks) {
    if (chunk.type === 'tEXt' || chunk.type === 'iTXt' || chunk.type === 'zTXt') {
      const parsed = parsePngTextChunkData(chunk.type, chunk.data);
      if (parsed && OWN_METADATA_KEYWORDS.has(parsed.keyword)) continue;
    }
    parts.push(buffer.subarray(chunk.offset, chunk.offset + 12 + chunk.data.length));
  }
  return Buffer.concat(parts);
}

function sidecarPathFor(relativePath) {
  const jsonRelative = String(relativePath ?? '').replace(IMAGE_EXTENSION_RE, '.json');
  return path.join(OUTPUT_ROOT, ...jsonRelative.split('/'));
}

const readOutputFile = (relativePath) =>
  fsp.readFile(path.join(OUTPUT_ROOT, ...String(relativePath).split('/')));

const readSidecar = async (relativePath) =>
  JSON.parse(await fsp.readFile(sidecarPathFor(relativePath), 'utf8'));

const getIdMetadata = (id, query = '') =>
  request('GET', `/api/history/${encodeURIComponent(id)}/metadata${query}`);

const syncMetadata = (ids) =>
  request('POST', '/api/metadata/sync', { body: ids === undefined ? {} : { ids } });

const getHistoryRow = async (id) =>
  ((await getHistory()).body?.items || []).find((item) => item.id === id) || null;

/** Count sidecars that exist for current history records. */
async function countHistorySidecars() {
  const items = (await getHistory()).body?.items || [];
  let count = 0;
  for (const item of items) {
    const relative = item.relativePath || item.filename;
    if (fs.existsSync(sidecarPathFor(relative))) count += 1;
  }
  return count;
}

/** All files under outputs/ (hidden .trash and album folders included by path). */
async function listOutputFiles(directory = OUTPUT_ROOT, prefix = '') {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listOutputFiles(path.join(directory, entry.name), relative)));
    } else {
      files.push(relative);
    }
  }
  return files.sort();
}

const fetchMetadataArchive = () =>
  fetch(`${app.base}/api/metadata/archive`, { signal: AbortSignal.timeout(20_000) });

const IDAT_HEX = (png) =>
  png.chunks
    .filter((chunk) => chunk.type === 'IDAT')
    .map((chunk) => chunk.data.toString('hex'));


/* ----------------------------------------------------------------------- */
/* Tests                                                                    */
/* ----------------------------------------------------------------------- */

async function run() {
  const mockBase = await startMock();
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(OUTPUTS_DIR, { recursive: true });
  await startApp();

  /* Health + default config */
  const health = await request('GET', '/api/health');
  check('健康检查', health.status === 200 && health.body.ok === true);
  check(
    `健康检查返回 ${APP_VERSION} 版本`,
    health.body?.version === APP_VERSION,
    JSON.stringify(health.body?.version),
  );

  const initial = await request('GET', '/api/config');
  const initialLlm = initial.body?.config?.llm || {};
  check(
    '默认配置包含新的 LLM 参数',
    initialLlm.timeoutSeconds === 120 &&
      initialLlm.reasoningEffort === '' &&
      initialLlm.maxTokens === 1024 &&
      initialLlm.topP === 1 &&
      initialLlm.temperature === 0.4,
    JSON.stringify(initialLlm),
  );
  check('默认配置已无 provider 字段', !('provider' in initialLlm));
  check(
    '默认配置包含一个 System 提示词块',
    Array.isArray(initialLlm.promptBlocks) &&
      initialLlm.promptBlocks.length === 1 &&
      initialLlm.promptBlocks[0].role === 'system' &&
      initialLlm.promptBlocks[0].position === 'before' &&
      initialLlm.promptBlocks[0].content.includes('Danbooru'),
    JSON.stringify(initialLlm.promptBlocks),
  );
  check(
    '默认配置预设与模型列表为空',
    Array.isArray(initialLlm.presets) &&
      initialLlm.presets.length === 0 &&
      Array.isArray(initialLlm.availableModels) &&
      initialLlm.availableModels.length === 0,
  );
  check(
    '默认 NovelAI 预设为空',
    Array.isArray(initial.body?.config?.novelai?.presets) &&
      initial.body.config.novelai.presets.length === 0,
  );

  const migratedLegacy = normalizeConfig({
    llm: {
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash',
      apiKey: 'legacy-key',
      systemPrompt: 'LEGACY SYSTEM PROMPT',
    },
  });
  check(
    '旧 systemPrompt 迁移为提示词块',
    migratedLegacy.llm.promptBlocks.length === 1 &&
      migratedLegacy.llm.promptBlocks[0].content === 'LEGACY SYSTEM PROMPT' &&
      migratedLegacy.llm.baseUrl ===
        'https://generativelanguage.googleapis.com/v1beta/openai',
    JSON.stringify(migratedLegacy.llm),
  );

  /* Legacy Gemini migration over HTTP */
  const migrated = await setConfig({
    llm: {
      provider: 'gemini',
      apiKey: 'dummy-gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash',
    },
  });
  check(
    '旧 Gemini 配置迁移到 OpenAI 兼容端点',
    migrated.body?.config?.llm?.baseUrl ===
      'https://generativelanguage.googleapis.com/v1beta/openai' &&
      migrated.body?.config?.llm?.model === 'gemini-2.5-flash' &&
      migrated.body?.config?.llm?.apiKey === 'dummy-gemini',
    JSON.stringify(migrated.body?.config?.llm),
  );

  /* Save the working config */
  const saved = await setConfig({
    llm: {
      apiKey: 'dummy-llm',
      baseUrl: `${mockBase}/v1`,
      model: 'mock-chat',
      temperature: 0.8,
      topP: 0.9,
      maxTokens: 2048,
      reasoningEffort: 'high',
      timeoutSeconds: 45,
      promptBlocks: [
        { role: 'system', position: 'before', content: 'SYSTEM-A' },
        { role: 'user', position: 'before', content: 'USER-B' },
        { role: 'assistant', position: 'after', content: 'ASSIST-C' },
      ],
    },
    novelai: {
      apiKey: 'dummy-nai',
      baseUrl: mockBase,
      model: 'nai-diffusion-4-5-full',
      sampler: 'k_euler_ancestral',
      noiseSchedule: 'karras',
      steps: 24,
      scale: 5.5,
      cfgRescale: 0.2,
      width: 832,
      height: 1216,
      seed: -1,
      qualityToggle: true,
      basePositive: 'cinematic lighting, 1girl',
      artistPrompt: 'artist:wlop',
      negativePrompt: 'lowres, bad hands',
    },
  });
  check(
    '配置保存并归一化',
    saved.status === 200 &&
      saved.body.config.llm.reasoningEffort === 'high' &&
      saved.body.config.llm.timeoutSeconds === 45 &&
      saved.body.config.novelai.steps === 24,
  );

  const clamped = await setConfig({
    llm: { temperature: -5, topP: 5, maxTokens: 999999, timeoutSeconds: 2 },
    novelai: { width: -9999, steps: 'abc' },
  });
  check(
    '非法参数被安全钳制',
    clamped.body.config.llm.temperature === 0 &&
      clamped.body.config.llm.topP === 1 &&
      clamped.body.config.llm.maxTokens === 32768 &&
      clamped.body.config.llm.timeoutSeconds === 10 &&
      clamped.body.config.novelai.width === 64 &&
      clamped.body.config.novelai.steps === 28,
    JSON.stringify({ llm: clamped.body.config.llm, nai: clamped.body.config.novelai }),
  );

  // Restore the test config after the clamp test.
  await setConfig({
    llm: {
      temperature: 0.8,
      topP: 0.9,
      maxTokens: 2048,
      reasoningEffort: 'high',
      timeoutSeconds: 45,
    },
    novelai: { width: 832, height: 1216, steps: 24 },
  });

  /* Presets + saved model list */
  const presetSaved = await setConfig({
    llm: {
      presets: [
        {
          name: 'Relay A',
          baseUrl: `${mockBase}/v1`,
          apiKey: 'preset-key',
          model: 'preset-model',
          temperature: 1.5,
          topP: 5,
          maxTokens: 999999,
          timeoutSeconds: 2,
          reasoningEffort: 'ultra',
          availableModels: ['relay-a', 'relay-a', 42, 'relay-b'],
          availableModelsBaseUrl: `${mockBase}/v1`,
          promptBlocks: [{ role: 'assistant', position: 'after', content: 'PRESET BLOCK' }],
        },
        { name: '   ' },
        'not-an-object',
      ],
    },
  });
  const preset = presetSaved.body?.config?.llm?.presets?.[0];
  check(
    'LLM 预设保存并归一化',
    presetSaved.body?.config?.llm?.presets?.length === 1 &&
      preset.name === 'Relay A' &&
      preset.model === 'preset-model' &&
      preset.temperature === 1.5 &&
      preset.topP === 1 &&
      preset.maxTokens === 32768 &&
      preset.timeoutSeconds === 10 &&
      preset.reasoningEffort === '' &&
      preset.promptBlocks.length === 1 &&
      preset.promptBlocks[0].role === 'assistant' &&
      preset.promptBlocks[0].position === 'after',
    JSON.stringify(preset),
  );
  check(
    '预设内的模型列表去重并保序',
    JSON.stringify(preset.availableModels) === JSON.stringify(['relay-a', 'relay-b']),
    JSON.stringify(preset.availableModels),
  );

  const savedModels = await setConfig({
    llm: { availableModels: ['a', 'a', 'b', 7, 'c'], availableModelsBaseUrl: `${mockBase}/v1` },
  });
  check(
    '已保存模型列表去重',
    JSON.stringify(savedModels.body?.config?.llm?.availableModels) === JSON.stringify(['a', 'b', 'c']),
    JSON.stringify(savedModels.body?.config?.llm?.availableModels),
  );

  /* NovelAI presets */
  const naiPresetSaved = await setConfig({
    novelai: {
      presets: [
        {
          name: 'V5 竖图',
          model: 'nai-diffusion-5-full',
          sampler: 'k_euler',
          noiseSchedule: 'native',
          steps: 33,
          scale: 6,
          cfgRescale: 0.5,
          width: 832,
          height: 1216,
          seed: 7,
          qualityToggle: false,
          basePositive: 'BP-TEXT',
          artistPrompt: 'AP-TEXT',
          negativePrompt: 'NP-TEXT',
          apiKey: 'must-not-be-stored',
          baseUrl: 'https://example.com',
        },
        { name: '   ' },
        'not-an-object',
      ],
    },
  });
  const naiPreset = naiPresetSaved.body?.config?.novelai?.presets?.[0];
  check(
    'NovelAI 预设保存并归一化',
    naiPresetSaved.body?.config?.novelai?.presets?.length === 1 &&
      naiPreset.name === 'V5 竖图' &&
      naiPreset.model === 'nai-diffusion-5-full' &&
      naiPreset.sampler === 'k_euler' &&
      naiPreset.noiseSchedule === 'native' &&
      naiPreset.steps === 33 &&
      naiPreset.scale === 6 &&
      naiPreset.cfgRescale === 0.5 &&
      naiPreset.width === 832 &&
      naiPreset.height === 1216 &&
      naiPreset.seed === 7 &&
      naiPreset.qualityToggle === false &&
      naiPreset.basePositive === 'BP-TEXT' &&
      naiPreset.artistPrompt === 'AP-TEXT' &&
      naiPreset.negativePrompt === 'NP-TEXT',
    JSON.stringify(naiPreset),
  );
  check(
    'NovelAI 预设不保存 Key / Base URL',
    naiPreset && !('apiKey' in naiPreset) && !('baseUrl' in naiPreset),
    JSON.stringify(naiPreset),
  );
  check(
    'NovelAI 预设不含 timeoutSeconds',
    naiPreset && !('timeoutSeconds' in naiPreset),
    JSON.stringify(naiPreset),
  );

  /* NovelAI 请求超时 */
  check(
    '默认 NovelAI 超时为 300 秒',
    initial.body?.config?.novelai?.timeoutSeconds === 300,
    JSON.stringify(initial.body?.config?.novelai?.timeoutSeconds),
  );
  const naiTimeoutLow = await setConfig({ novelai: { timeoutSeconds: 1 } });
  check(
    'NovelAI 超时低于下限被钳制为 30',
    naiTimeoutLow.body?.config?.novelai?.timeoutSeconds === 30,
    JSON.stringify(naiTimeoutLow.body?.config?.novelai?.timeoutSeconds),
  );
  const naiTimeoutHigh = await setConfig({ novelai: { timeoutSeconds: 99_999 } });
  check(
    'NovelAI 超时高于上限被钳制为 900',
    naiTimeoutHigh.body?.config?.novelai?.timeoutSeconds === 900,
    JSON.stringify(naiTimeoutHigh.body?.config?.novelai?.timeoutSeconds),
  );
  const naiTimeoutInvalid = await setConfig({ novelai: { timeoutSeconds: 'abc' } });
  check(
    '非法 NovelAI 超时回退默认 300',
    naiTimeoutInvalid.body?.config?.novelai?.timeoutSeconds === 300,
    JSON.stringify(naiTimeoutInvalid.body?.config?.novelai?.timeoutSeconds),
  );
  const naiTimeoutSaved = await setConfig({ novelai: { timeoutSeconds: 420 } });
  check(
    'NovelAI 超时可保存',
    naiTimeoutSaved.body?.config?.novelai?.timeoutSeconds === 420,
    JSON.stringify(naiTimeoutSaved.body?.config?.novelai?.timeoutSeconds),
  );

  /* Model list */
  const models = await request('POST', '/api/llm/models', {
    body: { baseUrl: `${mockBase}/v1`, apiKey: 'dummy-llm' },
  });
  check(
    '拉取模型列表并规范化 id',
    models.status === 200 &&
      JSON.stringify(models.body.models) === JSON.stringify(['gemini-mock', 'mock-chat', 'z-alt']),
    JSON.stringify(models.body?.models),
  );
  check('拉取模型使用 Bearer 认证', mock.modelRequests.at(-1)?.auth === 'Bearer dummy-llm');

  const modelsNoKey = await request('POST', '/api/llm/models', {
    body: { baseUrl: `${mockBase}/v1`, apiKey: '' },
  });
  check(
    '拉取模型缺少 Key 时拒绝',
    modelsNoKey.status === 400 && modelsNoKey.body?.error?.code === 'LLM_API_KEY_MISSING',
  );

  const modelsBadUrl = await request('POST', '/api/llm/models', {
    body: { baseUrl: 'not-a-url', apiKey: 'dummy' },
  });
  check(
    '拉取模型拒绝非法 URL',
    modelsBadUrl.status === 400 && modelsBadUrl.body?.error?.code === 'INVALID_URL',
  );

  /* Generation */
  const first = await generate('雨夜的电车月台');
  const source = first.body?.result;
  check('正常生成返回结果', first.status === 200 && Boolean(source));

  const llmRequest = mock.llmRequests.at(-1);
  check(
    'LLM 请求包含新参数',
    llmRequest.body.model === 'mock-chat' &&
      llmRequest.body.temperature === 0.8 &&
      llmRequest.body.top_p === 0.9 &&
      llmRequest.body.max_tokens === 2048 &&
      llmRequest.body.reasoning_effort === 'high' &&
      llmRequest.body.stream === false,
    JSON.stringify(llmRequest.body),
  );
  check(
    '提示词块按角色与插入位置发送',
    llmRequest.body.messages?.length === 4 &&
      llmRequest.body.messages[0].role === 'system' &&
      llmRequest.body.messages[0].content === 'SYSTEM-A' &&
      llmRequest.body.messages[1].role === 'user' &&
      llmRequest.body.messages[1].content === 'USER-B' &&
      llmRequest.body.messages[2].role === 'user' &&
      llmRequest.body.messages[2].content.startsWith('雨夜的电车月台') &&
      llmRequest.body.messages[2].content.includes('TITLE: <标题>') &&
      llmRequest.body.messages[3].role === 'assistant' &&
      llmRequest.body.messages[3].content === 'ASSIST-C',
    JSON.stringify(llmRequest.body.messages),
  );
  check('LLM 请求使用 Bearer 认证', llmRequest.auth === 'Bearer dummy-llm');

  const expectedPrompt =
    'artist:wlop, 1girl, solo, rain, city_lights, cinematic lighting';
  check('最终提示词顺序 Artist → LLM Tags → Base positive', source?.prompt === expectedPrompt, source?.prompt);
  check(
    'LLM 代码围栏与客套话被清理',
    source?.llmTags === '1girl, solo, rain, city_lights',
    source?.llmTags,
  );
  check('文件名格式正确', /^nai-\d{8}-\d{6}-[a-f0-9]{6}\.png$/.test(source?.filename || ''));
  check(
    'seed 为合法 uint32',
    Number.isInteger(source?.seed) && source.seed >= 0 && source.seed <= 0xffffffff,
  );

  const savedFile = path.join(OUTPUTS_DIR, source?.filename || 'missing');
  check(
    'PNG 已写入 outputs',
    fs.existsSync(savedFile) && fs.readFileSync(savedFile).subarray(1, 4).toString() === 'PNG',
  );

  const served = await fetch(`${app.base}${source.url}`, { signal: AbortSignal.timeout(5000) });
  check(
    '图片通过 /outputs 访问',
    served.status === 200 && served.headers.get('content-type') === 'image/png',
  );

  const nai = mock.naiRequests.at(-1);
  check(
    'NovelAI 请求体正确',
    nai.input === expectedPrompt &&
      nai.model === 'nai-diffusion-4-5-full' &&
      nai.action === 'generate' &&
      nai.parameters.params_version === 3 &&
      nai.parameters.v4_prompt?.caption?.base_caption === expectedPrompt &&
      nai.parameters.v4_negative_prompt?.caption?.base_caption === 'lowres, bad hands' &&
      nai.parameters.seed === source.seed &&
      nai.parameters.n_samples === 1,
    JSON.stringify(nai.parameters),
  );

  check(
    '负面提示词同时发送 negative_prompt 与 v4_negative_prompt',
    nai.parameters.negative_prompt === 'lowres, bad hands' &&
      nai.parameters.v4_negative_prompt?.caption?.base_caption === 'lowres, bad hands',
    JSON.stringify({
      negative_prompt: nai.parameters.negative_prompt,
      v4: nai.parameters.v4_negative_prompt?.caption,
    }),
  );

  /* reasoning_effort 未设置时不应发送 */
  await setConfig({ llm: { reasoningEffort: '' } });
  await generate('无思考强度');
  check('思考强度为空时不发送 reasoning_effort', !('reasoning_effort' in mock.llmRequests.at(-1).body));
  await setConfig({ llm: { reasoningEffort: 'high' } });

  /* SSE 生成 */
  const streamed = await generate('流式生成', { stream: true });
  const stages = parseSse(streamed.text)
    .filter((event) => event.event === 'stage')
    .map((event) => event.data.stage);
  check(
    'SSE 阶段顺序 llm → nai → unzip → save',
    JSON.stringify(stages) === JSON.stringify(['llm', 'nai', 'unzip', 'save']),
    JSON.stringify(stages),
  );
  check(
    'SSE done 事件包含结果',
    Boolean(parseSse(streamed.text).find((event) => event.event === 'done')?.data?.result),
  );

  /* Empty prompt structure: only the dynamic user message is sent. */
  await setConfig({ llm: { promptBlocks: [] } });
  await generate('只有用户输入');
  const soloMessages = mock.llmRequests.at(-1).body.messages;
  check(
    '空提示词结构只发送用户输入',
    soloMessages.length === 1 &&
      soloMessages[0].role === 'user' &&
      soloMessages[0].content.startsWith('只有用户输入') &&
      soloMessages[0].content.includes('TITLE: <标题>'),
    JSON.stringify(soloMessages),
  );

  await setConfig({
    llm: {
      promptBlocks: [
        { role: 'system', position: 'before', content: 'SYSTEM-A' },
        { role: 'user', position: 'before', content: 'USER-B' },
        { role: 'assistant', position: 'after', content: 'ASSIST-C' },
      ],
    },
  });

  /* V5 */
  await setConfig({ novelai: { model: 'nai-diffusion-5-full' } });
  const v5 = await generate('V5 测试');
  check('V5 生成成功', v5.status === 200 && Boolean(v5.body?.result));
  check('V5 使用 params_version 4', mock.naiRequests.at(-1).parameters.params_version === 4);
  check('V5 附带结构化提示词', Boolean(mock.naiRequests.at(-1).parameters.v4_prompt));
  check(
    'V5 仍发送负面提示词',
    mock.naiRequests.at(-1).parameters.negative_prompt === 'lowres, bad hands' &&
      mock.naiRequests.at(-1).parameters.v4_negative_prompt?.caption?.base_caption ===
        'lowres, bad hands',
  );

  /* V3 */
  await setConfig({ novelai: { model: 'nai-diffusion-3' } });
  const v3 = await generate('V3 测试');
  const v3Params = mock.naiRequests.at(-1).parameters;
  check('V3 生成成功', v3.status === 200 && Boolean(v3.body?.result));
  check(
    'V3 发送 negative_prompt 且不附带 v4 结构',
    v3Params.negative_prompt === 'lowres, bad hands' &&
      !v3Params.v4_prompt &&
      !v3Params.v4_negative_prompt &&
      v3Params.params_version === 3,
    JSON.stringify(v3Params),
  );
  await setConfig({ novelai: { model: 'nai-diffusion-4-5-full' } });

  /* 重绘 */
  const fresh = await rerender(source.id, { seedMode: 'new' });
  const freshResult = fresh.body?.result;
  check(
    '重绘沿用 Tag、参数并换种子',
    fresh.status === 200 &&
      Boolean(freshResult) &&
      freshResult.prompt === source.prompt &&
      freshResult.steps === source.steps &&
      freshResult.model === source.model &&
      freshResult.seed !== source.seed &&
      freshResult.filename !== source.filename,
  );

  const sameSeed = await rerender(source.id, { seedMode: 'same' });
  check('同种子重绘复现 seed', sameSeed.body?.result?.seed === source.seed);

  const rerenderStream = await rerender(source.id, { seedMode: 'new' }, { stream: true });
  const rerenderStages = parseSse(rerenderStream.text)
    .filter((event) => event.event === 'stage')
    .map((event) => event.data.stage);
  check(
    '重绘 SSE 阶段 nai → unzip → save',
    JSON.stringify(rerenderStages) === JSON.stringify(['nai', 'unzip', 'save']),
    JSON.stringify(rerenderStages),
  );

  const unknown = await rerender('00000000-0000-4000-8000-000000000000');
  check(
    '重绘不存在的记录返回 404',
    unknown.status === 404 && unknown.body?.error?.code === 'HISTORY_NOT_FOUND',
  );

  /* 画册：真实文件夹 + 分类 */
  const albumCreated = await createAlbum('  风景  ');
  const albumA = albumCreated.body?.album;
  check(
    '画册创建并规范化名称',
    albumCreated.status === 201 && albumA?.name === '风景',
    JSON.stringify(albumCreated.body),
  );
  check(
    '画册文件夹已建立',
    Boolean(albumA) && fs.existsSync(path.join(OUTPUTS_DIR, 'albums', albumA.id)),
  );
  const albumDup = await createAlbum('风景');
  check(
    '重名画册被拒绝',
    albumDup.status === 409 && albumDup.body?.error?.code === 'ALBUM_EXISTS',
  );
  const albumBlank = await createAlbum('   ');
  check(
    '空画册名被拒绝',
    albumBlank.status === 400 && albumBlank.body?.error?.code === 'ALBUM_NAME_REQUIRED',
  );

  const inAlbum = await generate('画册生成', { albumId: albumA.id });
  const inAlbumResult = inAlbum.body?.result;
  check(
    '生成到画册并写入子文件夹',
    inAlbum.status === 200 &&
      inAlbumResult?.albumId === albumA.id &&
      inAlbumResult.relativePath === `albums/${albumA.id}/${inAlbumResult.filename}` &&
      fs.existsSync(
        path.join(OUTPUTS_DIR, 'albums', albumA.id, inAlbumResult.filename),
      ),
    JSON.stringify(inAlbumResult),
  );
  const albumImage = await fetch(`${app.base}${inAlbumResult.url}`, {
    signal: AbortSignal.timeout(5000),
  });
  check('画册图片可通过 /outputs 访问', albumImage.status === 200);
  await albumImage.arrayBuffer();

  const movedToAlbum = await moveHistoryItem(source.id, albumA.id);
  const movedItem = movedToAlbum.body?.item;
  check(
    '作品移动到画册并真正移动文件',
    movedToAlbum.status === 200 &&
      movedItem?.albumId === albumA.id &&
      movedItem.relativePath === `albums/${albumA.id}/${source.filename}` &&
      !fs.existsSync(path.join(OUTPUTS_DIR, source.filename)) &&
      fs.existsSync(path.join(OUTPUTS_DIR, 'albums', albumA.id, source.filename)),
    JSON.stringify(movedItem),
  );
  const backToRoot = await moveHistoryItem(source.id, null);
  check(
    '作品移回未分类',
    backToRoot.body?.item?.albumId === null &&
      backToRoot.body.item.relativePath === source.filename &&
      fs.existsSync(path.join(OUTPUTS_DIR, source.filename)),
  );
  const badMove = await moveHistoryItem(source.id, 'not-an-album-id');
  check(
    '移动到不存在的画册返回 404',
    badMove.status === 404 && badMove.body?.error?.code === 'ALBUM_NOT_FOUND',
  );

  const albumsAfter = await request('GET', '/api/albums');
  const albumARow = albumsAfter.body?.albums?.find((album) => album.id === albumA.id);
  check(
    '画册列表返回作品数量',
    albumsAfter.status === 200 && albumARow?.count === 1,
    JSON.stringify(albumARow),
  );
  const renamed = await renameAlbum(albumA.id, '风景集');
  check('画册重命名', renamed.status === 200 && renamed.body?.album?.name === '风景集');
  const sameRename = await renameAlbum(albumA.id, '  风景集  ');
  check('画册重命名允许保留自身名称', sameRename.status === 200);

  /* 编辑提示词 / 模型后重画 */
  const edited = await rerender(source.id, {
    prompt: 'edited prompt, 1girl',
    negativePrompt: 'edited negative',
    model: 'nai-diffusion-5-full',
    seedMode: 'same',
  });
  const editedResult = edited.body?.result;
  check(
    '编辑提示词与模型后重画',
    edited.status === 200 &&
      editedResult?.prompt === 'edited prompt, 1girl' &&
      editedResult.model === 'nai-diffusion-5-full' &&
      editedResult.parentId === source.id &&
      editedResult.seed === source.seed,
    JSON.stringify(editedResult),
  );
  const editedNai = mock.naiRequests.at(-1);
  check(
    '重画请求使用编辑后的提示词、负面词与模型',
    editedNai.input === 'edited prompt, 1girl' &&
      editedNai.model === 'nai-diffusion-5-full' &&
      editedNai.parameters.params_version === 4 &&
      editedNai.parameters.negative_prompt === 'edited negative' &&
      editedNai.parameters.v4_negative_prompt?.caption?.base_caption === 'edited negative',
    JSON.stringify(editedNai.parameters),
  );
  const emptyRerenderPrompt = await rerender(source.id, { prompt: '   ' });
  check(
    '空重画提示词被拒绝',
    emptyRerenderPrompt.status === 400 &&
      emptyRerenderPrompt.body?.error?.code === 'EMPTY_PROMPT',
  );

  const rerenderIntoAlbum = await rerender(source.id, {
    prompt: 'album rerender',
    albumId: albumA.id,
  });
  const rerenderAlbumResult = rerenderIntoAlbum.body?.result;
  check(
    '重画结果可保存到指定画册',
    rerenderIntoAlbum.status === 200 &&
      rerenderAlbumResult?.albumId === albumA.id &&
      rerenderAlbumResult.relativePath ===
        `albums/${albumA.id}/${rerenderAlbumResult.filename}` &&
      fs.existsSync(
        path.join(OUTPUTS_DIR, 'albums', albumA.id, rerenderAlbumResult.filename),
      ),
  );

  /* 删除单张作品 */
  const deletedOne = await deleteHistory(rerenderAlbumResult.id);
  const historyAfterOneDelete = await request('GET', '/api/history');
  check(
    '删除作品同时删除文件与索引',
    deletedOne.status === 200 &&
      !fs.existsSync(
        path.join(OUTPUTS_DIR, ...rerenderAlbumResult.relativePath.split('/')),
      ) &&
      !historyAfterOneDelete.body.items.some((item) => item.id === rerenderAlbumResult.id),
  );
  const deleteUnknown = await deleteHistory('00000000-0000-4000-8000-000000000000');
  check(
    '删除不存在的作品返回 404',
    deleteUnknown.status === 404 && deleteUnknown.body?.error?.code === 'HISTORY_NOT_FOUND',
  );

  /* 删除画册：作品移回未分类 */
  const albumB = (await createAlbum('临时画册')).body?.album;
  const inAlbumB = await generate('画册 B', { albumId: albumB.id });
  const albumBResult = inAlbumB.body?.result;
  const orphanName = 'nai-20261126-050001-eeee55.png';
  await fsp.writeFile(path.join(OUTPUTS_DIR, 'albums', albumB.id, orphanName), PNG_1PX);
  const deletedAlbum = await deleteAlbum(albumB.id);
  const historyAfterAlbumDelete = await request('GET', '/api/history');
  const movedBackItem = historyAfterAlbumDelete.body.items.find(
    (item) => item.id === albumBResult?.id,
  );
  check(
    '删除画册将作品移回未分类',
    deletedAlbum.status === 200 &&
      deletedAlbum.body.moved === 1 &&
      movedBackItem?.albumId === null &&
      movedBackItem.relativePath === albumBResult.filename &&
      fs.existsSync(path.join(OUTPUTS_DIR, albumBResult.filename)) &&
      !fs.existsSync(path.join(OUTPUTS_DIR, 'albums', albumB.id)),
    JSON.stringify({ deleted: deletedAlbum.body, movedBackItem }),
  );
  check(
    '删除画册时未索引图片被移出而不是删除',
    deletedAlbum.body.rescued === 1 && fs.existsSync(path.join(OUTPUTS_DIR, orphanName)),
    JSON.stringify(deletedAlbum.body),
  );
  const albumsFinal = await request('GET', '/api/albums');
  check(
    '删除画册后列表更新',
    !albumsFinal.body.albums.some((album) => album.id === albumB.id),
  );

  /* =================================================================== */
  /* 1.6.0 新功能：加权去重 / 画册封面 / 排序 / 批量操作 / 回收站 /      */
  /* 提示词收藏 / 任务队列                                               */
  /* =================================================================== */

  /* 加权 Tag 去重 ----------------------------------------------------- */
  await setConfig({
    novelai: {
      artistPrompt: '(1girl:1.3), artist:wlop',
      basePositive: '((1girl)), cinematic lighting',
    },
  });
  const deduped = await generate('加权 Tag 去重');
  const dedupedResult = deduped.body?.result;
  const dedupedExpected =
    '(1girl:1.3), artist:wlop, solo, rain, city_lights, cinematic lighting';
  check(
    '加权 Tag 去重：同 Tag 先出现者保留，权重语法原样保留',
    deduped.status === 200 && dedupedResult?.prompt === dedupedExpected,
    dedupedResult?.prompt,
  );
  check(
    '加权 Tag 去重：最终提示词中 1girl 只出现一次',
    (dedupedResult?.prompt?.match(/1girl/gi) || []).length === 1,
    dedupedResult?.prompt,
  );
  check(
    '加权 Tag 去重：NovelAI 收到去重后的提示词',
    mock.naiRequests.at(-1)?.input === dedupedExpected,
    mock.naiRequests.at(-1)?.input,
  );
  await setConfig({
    novelai: { artistPrompt: 'artist:wlop', basePositive: 'cinematic lighting, 1girl' },
  });

  /* 画册封面 ---------------------------------------------------------- */
  const coverAlbum = (await createAlbum('封面画册')).body?.album;
  const coverFirst = (await generate('封面第一张', { albumId: coverAlbum.id })).body?.result;
  const coverSecond = (await generate('封面第二张', { albumId: coverAlbum.id })).body?.result;

  let albumRows = (await getAlbums()).body?.albums || [];
  let coverRow = albumRows.find((album) => album.id === coverAlbum.id);
  check(
    '画册封面未设置时回退为最新作品',
    coverRow?.coverId === coverSecond?.id && coverRow?.coverUrl === coverSecond?.url,
    JSON.stringify(coverRow),
  );
  const defaultCoverImage = await fetch(`${app.base}${coverRow?.coverUrl}`, {
    signal: AbortSignal.timeout(5000),
  });
  check('画册封面 URL 可访问', defaultCoverImage.status === 200);
  await defaultCoverImage.arrayBuffer();

  const emptyCoverAlbum = (await createAlbum('空封面画册')).body?.album;
  albumRows = (await getAlbums()).body?.albums || [];
  const emptyCoverRow = albumRows.find((album) => album.id === emptyCoverAlbum.id);
  check(
    '空画册的封面为空',
    emptyCoverRow?.coverId === '' && emptyCoverRow?.coverUrl === '',
    JSON.stringify(emptyCoverRow),
  );

  const coverSet = await setAlbumCover(coverAlbum.id, coverFirst.id);
  check(
    '设置画册封面',
    coverSet.status === 200 &&
      coverSet.body?.album?.coverId === coverFirst.id &&
      coverSet.body.album.coverUrl === coverFirst.url,
    JSON.stringify(coverSet.body?.album),
  );
  check(
    '设置封面后画册列表同步',
    coverSet.body?.albums?.find((album) => album.id === coverAlbum.id)?.coverId ===
      coverFirst.id,
  );

  const coverNotInAlbum = await setAlbumCover(coverAlbum.id, dedupedResult.id);
  check(
    '非画册内作品不能设为封面',
    coverNotInAlbum.status === 400 &&
      coverNotInAlbum.body?.error?.code === 'COVER_NOT_IN_ALBUM',
    JSON.stringify(coverNotInAlbum.body),
  );
  const coverHistoryMissing = await setAlbumCover(
    coverAlbum.id,
    '00000000-0000-4000-8000-000000000000',
  );
  check(
    '设置不存在的作品为封面返回 404',
    coverHistoryMissing.status === 404 &&
      coverHistoryMissing.body?.error?.code === 'HISTORY_NOT_FOUND',
  );
  const coverAlbumMissing = await setAlbumCover(
    '00000000-0000-4000-8000-000000000000',
    coverFirst.id,
  );
  check(
    '设置封面到不存在的画册返回 404',
    coverAlbumMissing.status === 404 &&
      coverAlbumMissing.body?.error?.code === 'ALBUM_NOT_FOUND',
  );

  const coverCleared = await setAlbumCover(coverAlbum.id, null);
  check(
    'historyId: null 清除封面并回退最新作品',
    coverCleared.status === 200 && coverCleared.body?.album?.coverId === coverSecond.id,
    JSON.stringify(coverCleared.body?.album),
  );

  await setAlbumCover(coverAlbum.id, coverFirst.id);
  const coverItemMovedOut = await moveHistoryItem(coverFirst.id, null);
  albumRows = (await getAlbums()).body?.albums || [];
  coverRow = albumRows.find((album) => album.id === coverAlbum.id);
  const albumsFileAfterMove = await readDataJson('albums.json');
  check(
    '封面作品移出画册后封面自动清空',
    coverItemMovedOut.status === 200 &&
      coverRow?.coverId === coverSecond.id &&
      (albumsFileAfterMove.find((album) => album.id === coverAlbum.id)?.coverId || '') === '',
    JSON.stringify({ row: coverRow, stored: albumsFileAfterMove }),
  );
  await moveHistoryItem(coverFirst.id, coverAlbum.id);

  const coverThird = (await generate('封面第三张', { albumId: coverAlbum.id })).body?.result;
  await setAlbumCover(coverAlbum.id, coverThird.id);
  await deleteHistory(coverThird.id);
  albumRows = (await getAlbums()).body?.albums || [];
  coverRow = albumRows.find((album) => album.id === coverAlbum.id);
  const albumsFileAfterCoverDelete = await readDataJson('albums.json');
  check(
    '封面作品被删除后封面自动清空',
    coverRow?.coverId === coverSecond.id &&
      (albumsFileAfterCoverDelete.find((album) => album.id === coverAlbum.id)?.coverId ||
        '') === '',
    JSON.stringify({ row: coverRow }),
  );
  const coverSetAgain = await setAlbumCover(coverAlbum.id, coverFirst.id);
  check(
    '重新设置封面成功',
    coverSetAgain.status === 200 && coverSetAgain.body?.album?.coverId === coverFirst.id,
  );

  /* 作品排序 ---------------------------------------------------------- */
  const orderAlbum = (await createAlbum('排序画册')).body?.album;
  const sortOne = (await generate('排序一', { albumId: orderAlbum.id })).body?.result;
  const sortTwo = (await generate('排序二', { albumId: orderAlbum.id })).body?.result;
  const sortThree = (await generate('排序三', { albumId: orderAlbum.id })).body?.result;

  const orderBefore = await historyIds();
  const reordered = await reorderHistory([sortOne.id, sortThree.id]);
  const orderAfter = (reordered.body?.items || []).map((item) => item.id);
  const selectedIds = new Set([sortOne.id, sortThree.id]);
  const unselectedUnchanged = orderBefore.every(
    (id, position) => selectedIds.has(id) || orderAfter[position] === id,
  );
  check(
    '排序：子集按请求顺序填回原位置',
    reordered.status === 200 &&
      orderAfter[0] === sortOne.id &&
      orderAfter[1] === sortTwo.id &&
      orderAfter[2] === sortThree.id,
    JSON.stringify(orderAfter.slice(0, 4)),
  );
  check('排序：未选中的作品位置不变', reordered.status === 200 && unselectedUnchanged);
  const storedHistoryOrder = (await readDataJson('history.json')).map((item) => item.id);
  check(
    '排序结果写入 history.json',
    JSON.stringify(storedHistoryOrder) === JSON.stringify(orderAfter),
    `${storedHistoryOrder.length} vs ${orderAfter.length}`,
  );
  const orderEmpty = await reorderHistory([]);
  check(
    '空排序数组返回 400',
    orderEmpty.status === 400 && orderEmpty.body?.error?.code === 'ORDER_IDS_REQUIRED',
  );
  const orderUnknown = await reorderHistory([
    '00000000-0000-4000-8000-000000000000',
  ]);
  check(
    '排序列表无有效作品返回 400',
    orderUnknown.status === 400 && orderUnknown.body?.error?.code === 'ORDER_IDS_INVALID',
  );

  /* 批量移动 ---------------------------------------------------------- */
  const ghostId = '00000000-0000-4000-8000-000000000000';
  const batchAlbum = (await createAlbum('批量画册')).body?.album;
  const moveOne = (await generate('批量移动一')).body?.result;
  const moveTwo = (await generate('批量移动二')).body?.result;

  const batchMove = await batchMoveHistory(
    [moveOne.id, moveTwo.id, ghostId],
    batchAlbum.id,
  );
  check(
    '批量移动返回 moved 与 failed',
    batchMove.status === 200 &&
      batchMove.body?.moved === 2 &&
      batchMove.body?.failed?.length === 1 &&
      batchMove.body.failed[0]?.id === ghostId,
    JSON.stringify(batchMove.body),
  );
  check(
    '批量移动真正移动文件',
    fs.existsSync(path.join(OUTPUTS_DIR, 'albums', batchAlbum.id, moveOne.filename)) &&
      fs.existsSync(path.join(OUTPUTS_DIR, 'albums', batchAlbum.id, moveTwo.filename)) &&
      !fs.existsSync(path.join(OUTPUTS_DIR, moveOne.filename)) &&
      !fs.existsSync(path.join(OUTPUTS_DIR, moveTwo.filename)),
  );
  const movedRowOne = ((await getHistory()).body?.items || []).find(
    (item) => item.id === moveOne.id,
  );
  check(
    '批量移动更新 relativePath / url / albumId',
    movedRowOne?.albumId === batchAlbum.id &&
      movedRowOne.relativePath === `albums/${batchAlbum.id}/${moveOne.filename}` &&
      movedRowOne.url === `/outputs/albums/${batchAlbum.id}/${moveOne.filename}`,
    JSON.stringify(movedRowOne),
  );
  check(
    '批量移动返回更新后的画册列表',
    batchMove.body?.albums?.find((album) => album.id === batchAlbum.id)?.count === 2,
    JSON.stringify(batchMove.body?.albums),
  );

  const batchMoveUnknownAlbum = await batchMoveHistory([moveOne.id], ghostId);
  check(
    '批量移动到未知画册返回 404',
    batchMoveUnknownAlbum.status === 404 &&
      batchMoveUnknownAlbum.body?.error?.code === 'ALBUM_NOT_FOUND',
  );
  const batchMoveEmpty = await batchMoveHistory([], null);
  check(
    '批量移动空 ids 返回 400',
    batchMoveEmpty.status === 400 && batchMoveEmpty.body?.error?.code === 'IDS_REQUIRED',
  );
  const batchMoveBack = await batchMoveHistory([moveOne.id, moveTwo.id], null);
  check(
    '批量移动回未分类',
    batchMoveBack.status === 200 &&
      batchMoveBack.body?.moved === 2 &&
      fs.existsSync(path.join(OUTPUTS_DIR, moveOne.filename)) &&
      fs.existsSync(path.join(OUTPUTS_DIR, moveTwo.filename)) &&
      (batchMoveBack.body?.items || []).every((item) => item.albumId === null),
    JSON.stringify(batchMoveBack.body?.items),
  );

  /* 批量删除 + 回收站 -------------------------------------------------- */
  const trashCountBeforeBatch = (await getTrash()).body?.items?.length || 0;
  const batchDelete = await batchDeleteHistory([moveOne.id, moveTwo.id, ghostId]);
  check(
    '批量删除返回 trashed 与 failed',
    batchDelete.status === 200 &&
      Array.isArray(batchDelete.body?.trashed) &&
      batchDelete.body.trashed.length === 2 &&
      batchDelete.body.trashed.includes(moveOne.id) &&
      batchDelete.body.trashed.includes(moveTwo.id) &&
      batchDelete.body?.failed?.length === 1 &&
      batchDelete.body.failed[0]?.id === ghostId,
    JSON.stringify(batchDelete.body),
  );
  const historyAfterBatchDelete = (await getHistory()).body?.items || [];
  check(
    '批量删除后历史索引移除',
    !historyAfterBatchDelete.some(
      (item) => item.id === moveOne.id || item.id === moveTwo.id,
    ),
  );
  check(
    '批量删除后原输出路径文件消失',
    !fs.existsSync(path.join(OUTPUTS_DIR, moveOne.filename)) &&
      !fs.existsSync(path.join(OUTPUTS_DIR, moveTwo.filename)),
  );

  const trashRows = (await getTrash()).body?.items || [];
  const trashEntryOne = trashRows.find((entry) => entry.filename === moveOne.filename);
  check(
    '批量删除的作品进入回收站列表',
    trashRows.length === trashCountBeforeBatch + 2 && Boolean(trashEntryOne),
    `${trashCountBeforeBatch} -> ${trashRows.length}`,
  );
  const discardJson = await readDataJson('trash.json');
  check(
    '回收站文件写入 outputs/.trash 与 data/trash.json',
    fs.existsSync(path.join(OUTPUTS_DIR, '.trash')) &&
      (await fsp.readdir(path.join(OUTPUTS_DIR, '.trash'))).length >= 2 &&
      Array.isArray(discardJson) &&
      discardJson.length === trashRows.length,
    `${discardJson.length} vs ${trashRows.length}`,
  );
  check(
    '回收站条目包含 url / deletedAt / albumId / prompt',
    String(trashEntryOne?.url || '').startsWith('/trash-files/') &&
      !Number.isNaN(Date.parse(trashEntryOne?.deletedAt)) &&
      trashEntryOne?.albumId === null &&
      trashEntryOne?.prompt === moveOne.prompt,
    JSON.stringify(trashEntryOne),
  );
  const trashFileResponse = await fetch(`${app.base}${trashEntryOne?.url}`, {
    signal: AbortSignal.timeout(5000),
  });
  check(
    '回收站图片 URL 可直接访问',
    trashFileResponse.status === 200 &&
      trashFileResponse.headers.get('content-type') === 'image/png',
    String(trashFileResponse.status),
  );
  await trashFileResponse.arrayBuffer();

  /* 单张删除进回收站 / 彻底删除 --------------------------------------- */
  const trashCountBeforeSingle = (await getTrash()).body?.items?.length || 0;
  const singleTrashSource = (await generate('单张删除进回收站')).body?.result;
  const singleDeleted = await deleteHistory(singleTrashSource.id);
  check(
    '单张删除默认进入回收站',
    singleDeleted.status === 200 &&
      singleDeleted.body?.deleted === singleTrashSource.id &&
      singleDeleted.body?.filename === singleTrashSource.filename &&
      singleDeleted.body?.trashed === true,
    JSON.stringify(singleDeleted.body),
  );
  check(
    '单张删除后原路径文件消失',
    !fs.existsSync(path.join(OUTPUTS_DIR, singleTrashSource.filename)),
  );
  const trashAfterSingle = (await getTrash()).body?.items || [];
  check(
    '单张删除出现在回收站列表',
    trashAfterSingle.length === trashCountBeforeSingle + 1 &&
      trashAfterSingle.some((entry) => entry.filename === singleTrashSource.filename),
    `${trashCountBeforeSingle} -> ${trashAfterSingle.length}`,
  );

  const permanentItem = (await generate('彻底删除不进回收站')).body?.result;
  const trashCountBeforePermanent = (await getTrash()).body?.items?.length || 0;
  const permanentDeleted = await request(
    'DELETE',
    `/api/history/${encodeURIComponent(permanentItem.id)}?permanent=1`,
  );
  const trashAfterPermanent = (await getTrash()).body?.items || [];
  check(
    'permanent=1 彻底删除且不进入回收站',
    permanentDeleted.status === 200 &&
      permanentDeleted.body?.trashed === false &&
      !fs.existsSync(path.join(OUTPUTS_DIR, permanentItem.filename)) &&
      trashAfterPermanent.length === trashCountBeforePermanent &&
      !trashAfterPermanent.some((entry) => entry.filename === permanentItem.filename),
    JSON.stringify(permanentDeleted.body),
  );

  /* 回收站恢复 / 同名冲突 / 画册已删除 / 彻底删除单条 / 清空 ----------- */
  const trashCountBeforeRestore = (await getTrash()).body?.items?.length || 0;
  const restoreOne = await restoreTrashItem(trashEntryOne.id);
  const restoredOne = restoreOne.body?.item;
  check(
    '回收站恢复作品到未分类',
    restoreOne.status === 200 &&
      restoredOne?.filename === moveOne.filename &&
      restoredOne.albumId === null &&
      fs.existsSync(path.join(OUTPUTS_DIR, moveOne.filename)),
    JSON.stringify(restoredOne),
  );
  check(
    '恢复后作品重新出现在历史',
    (await historyIds()).includes(restoredOne?.id),
  );
  check(
    '恢复后回收站列表减少',
    (restoreOne.body?.items || []).length === trashCountBeforeRestore - 1 &&
      !(restoreOne.body?.items || []).some(
        (entry) => entry.filename === moveOne.filename,
      ),
  );

  const restoreAlbumImage = (
    await generate('恢复回画册', { albumId: batchAlbum.id })
  ).body?.result;
  await batchDeleteHistory([restoreAlbumImage.id]);
  const restoreAlbumTrashEntry = await findTrashEntry(
    (entry) => entry.filename === restoreAlbumImage.filename,
  );
  const restoreIntoAlbum = await restoreTrashItem(restoreAlbumTrashEntry.id);
  const restoredIntoAlbum = restoreIntoAlbum.body?.item;
  check(
    '回收站恢复文件回到原画册目录',
    restoreIntoAlbum.status === 200 &&
      restoredIntoAlbum?.albumId === batchAlbum.id &&
      restoredIntoAlbum.relativePath ===
        `albums/${batchAlbum.id}/${restoreAlbumImage.filename}` &&
      fs.existsSync(
        path.join(OUTPUTS_DIR, 'albums', batchAlbum.id, restoreAlbumImage.filename),
      ),
    JSON.stringify(restoredIntoAlbum),
  );

  const conflictItem = (await generate('同名冲突恢复')).body?.result;
  await deleteHistory(conflictItem.id);
  const conflictTrashEntry = await findTrashEntry(
    (entry) => entry.filename === conflictItem.filename,
  );
  // Recreate a file at the original path so restoring must pick a new name.
  await fsp.writeFile(path.join(OUTPUTS_DIR, conflictItem.filename), PNG_1PX);
  const conflictRestore = await restoreTrashItem(conflictTrashEntry.id);
  const conflictRestored = conflictRestore.body?.item;
  check(
    '同名冲突时恢复使用新的合法文件名',
    conflictRestore.status === 200 &&
      conflictRestored?.filename !== conflictItem.filename &&
      /^nai-\d{8}-\d{6}-[a-f0-9]{6}\.(png|jpe?g|webp)$/i.test(
        conflictRestored?.filename || '',
      ) &&
      fs.existsSync(
        path.join(OUTPUTS_DIR, ...(conflictRestored?.relativePath || '').split('/')),
      ),
    JSON.stringify(conflictRestored),
  );
  await fsp.rm(path.join(OUTPUTS_DIR, conflictItem.filename), { force: true });

  const restoreDeletedAlbum = (await createAlbum('恢复画册')).body?.album;
  const restoreDeletedAlbumImage = (
    await generate('恢复画册作品', { albumId: restoreDeletedAlbum.id })
  ).body?.result;
  await batchDeleteHistory([restoreDeletedAlbumImage.id]);
  const deleteOrphanAlbum = await deleteAlbum(restoreDeletedAlbum.id);
  const orphanAlbumTrashEntry = await findTrashEntry(
    (entry) => entry.filename === restoreDeletedAlbumImage.filename,
  );
  const restoredFromDeletedAlbum = await restoreTrashItem(orphanAlbumTrashEntry.id);
  check(
    '目标画册已删除时恢复为未分类',
    deleteOrphanAlbum.status === 200 &&
      restoredFromDeletedAlbum.status === 200 &&
      restoredFromDeletedAlbum.body?.item?.albumId === null &&
      fs.existsSync(path.join(OUTPUTS_DIR, restoreDeletedAlbumImage.filename)),
    JSON.stringify(restoredFromDeletedAlbum.body?.item),
  );

  const discardSource = (await generate('回收站彻底删除')).body?.result;
  await deleteHistory(discardSource.id);
  const discardEntry = await findTrashEntry(
    (entry) => entry.filename === discardSource.filename,
  );
  const discardTrashFilename = decodeURIComponent(
    String(discardEntry?.url || '').split('/').pop() || '',
  );
  const trashCountBeforeDiscard = (await getTrash()).body?.items?.length || 0;
  const discardResult = await deleteTrashItem(discardEntry.id);
  check(
    '回收站彻底删除单条',
    discardResult.status === 200 &&
      discardResult.body?.deleted === discardEntry.id &&
      (discardResult.body?.items || []).length === trashCountBeforeDiscard - 1 &&
      !(discardResult.body?.items || []).some((entry) => entry.id === discardEntry.id),
  );
  check(
    '回收站彻底删除后文件消失',
    !fs.existsSync(path.join(OUTPUTS_DIR, '.trash', discardTrashFilename)),
  );

  const trashMissingRestore = await restoreTrashItem(ghostId);
  check(
    '恢复不存在的回收站条目返回 404',
    trashMissingRestore.status === 404 &&
      trashMissingRestore.body?.error?.code === 'TRASH_NOT_FOUND',
  );
  const trashMissingDelete = await deleteTrashItem(ghostId);
  check(
    '删除不存在的回收站条目返回 404',
    trashMissingDelete.status === 404 &&
      trashMissingDelete.body?.error?.code === 'TRASH_NOT_FOUND',
  );

  const emptyTrashResult = await emptyTrashBin();
  check(
    '清空回收站',
    emptyTrashResult.status === 200 &&
      emptyTrashResult.body?.deleted >= 1 &&
      (emptyTrashResult.body?.items || []).length === 0,
    JSON.stringify({ deleted: emptyTrashResult.body?.deleted }),
  );
  check(
    '清空回收站后 .trash 目录为空',
    (await fsp.readdir(path.join(OUTPUTS_DIR, '.trash'))).length === 0,
  );

  const restartTrashSource = (await generate('重启后仍在的回收站作品')).body?.result;
  await deleteHistory(restartTrashSource.id);
  const restartTrashEntry = await findTrashEntry(
    (entry) => entry.filename === restartTrashSource.filename,
  );
  check(
    '重启前回收站保留一条待恢复作品',
    Boolean(restartTrashEntry) && (await getTrash()).body?.items?.length === 1,
  );

  /* 提示词收藏 -------------------------------------------------------- */
  const promptsInitial = await getPrompts();
  check(
    '提示词收藏初始为空',
    promptsInitial.status === 200 && (promptsInitial.body?.prompts || []).length === 0,
  );
  const promptSaved = await savePrompt({
    name: '  雨天场景  ',
    positive: '  rain, city_lights  ',
    negative: '  lowres  ',
  });
  const savedPrompt = promptSaved.body?.prompt;
  check(
    '创建提示词收藏并规范化内容',
    promptSaved.status === 200 &&
      savedPrompt?.name === '雨天场景' &&
      savedPrompt?.positive === 'rain, city_lights' &&
      savedPrompt?.negative === 'lowres' &&
      typeof savedPrompt?.id === 'string' &&
      !Number.isNaN(Date.parse(savedPrompt?.createdAt)),
    JSON.stringify(savedPrompt),
  );
  const promptSecond = await savePrompt({ name: 'Night Rain', positive: 'night' });
  check(
    '创建第二条提示词收藏',
    promptSecond.status === 200 && (promptSecond.body?.prompts || []).length === 2,
    JSON.stringify(promptSecond.body?.prompts),
  );
  const promptDuplicate = await savePrompt({ name: 'night rain', positive: 'other' });
  check(
    '重名提示词（不区分大小写）返回 409',
    promptDuplicate.status === 409 &&
      promptDuplicate.body?.error?.code === 'PROMPT_EXISTS',
  );
  const promptNoName = await savePrompt({ name: '   ', positive: 'x' });
  check(
    '空提示词名返回 400',
    promptNoName.status === 400 &&
      promptNoName.body?.error?.code === 'PROMPT_NAME_REQUIRED',
  );
  const promptNoContent = await savePrompt({ name: '空内容', positive: '  ', negative: '' });
  check(
    '正向与负面都为空返回 400',
    promptNoContent.status === 400 && promptNoContent.body?.error?.code === 'PROMPT_EMPTY',
  );
  const promptUpdated = await savePrompt({
    id: savedPrompt.id,
    name: '雨天场景',
    positive: 'rain, city, umbrella',
    negative: 'lowres, bad hands',
  });
  check(
    '更新提示词收藏',
    promptUpdated.status === 200 &&
      promptUpdated.body?.prompt?.id === savedPrompt.id &&
      promptUpdated.body.prompt.positive === 'rain, city, umbrella' &&
      promptUpdated.body.prompt.negative === 'lowres, bad hands' &&
      (promptUpdated.body?.prompts || []).length === 2,
    JSON.stringify(promptUpdated.body?.prompt),
  );
  const promptUpdateMissing = await savePrompt({
    id: ghostId,
    name: '不存在',
    positive: 'x',
  });
  check(
    '更新不存在的提示词返回 404',
    promptUpdateMissing.status === 404 &&
      promptUpdateMissing.body?.error?.code === 'PROMPT_NOT_FOUND',
  );
  const promptToDelete = await savePrompt({ name: '待删除', positive: 'temp' });
  const promptDeleted = await removePrompt(promptToDelete.body?.prompt?.id);
  check(
    '删除提示词收藏',
    promptDeleted.status === 200 &&
      promptDeleted.body?.deleted === promptToDelete.body?.prompt?.id &&
      (promptDeleted.body?.prompts || []).length === 2 &&
      !(promptDeleted.body?.prompts || []).some(
        (entry) => entry.id === promptToDelete.body?.prompt?.id,
      ),
  );
  const promptDeleteMissing = await removePrompt(ghostId);
  check(
    '删除不存在的提示词返回 404',
    promptDeleteMissing.status === 404 &&
      promptDeleteMissing.body?.error?.code === 'PROMPT_NOT_FOUND',
  );

  /* 任务队列 ---------------------------------------------------------- */
  const jobsInitial = await getJobs();
  const initialJobList = jobsInitial.body;
  check(
    '任务列表包含运行状态 / 队列长度 / 超时限制',
    jobsInitial.status === 200 &&
      Array.isArray(initialJobList?.jobs) &&
      initialJobList.jobs.length <= 50 &&
      typeof initialJobList.queueLength === 'number' &&
      initialJobList.running === null &&
      initialJobList.limits?.llmTimeoutSeconds === 45 &&
      initialJobList.limits?.naiTimeoutSeconds === 420,
    JSON.stringify({ limits: initialJobList?.limits, running: initialJobList?.running }),
  );

  const queuedJobResponse = await enqueueJob({
    kind: 'generate',
    text: '队列生成任务',
    albumId: batchAlbum.id,
  });
  const queuedJob = queuedJobResponse.body?.job;
  check(
    '任务入队返回 202 与完整字段',
    queuedJobResponse.status === 202 &&
      Boolean(queuedJob) &&
      queuedJob.kind === 'generate' &&
      ['queued', 'running'].includes(queuedJob.status) &&
      typeof queuedJob.id === 'string' &&
      typeof queuedJob.stage === 'string' &&
      typeof queuedJob.message === 'string' &&
      typeof queuedJob.progress === 'number' &&
      typeof queuedJob.createdAt === 'number' &&
      typeof queuedJob.position === 'number' &&
      queuedJob.result === null &&
      queuedJob.error === null,
    JSON.stringify(queuedJobResponse.body),
  );
  check(
    '入队响应包含 queueLength',
    typeof queuedJobResponse.body?.queueLength === 'number',
    JSON.stringify(queuedJobResponse.body?.queueLength),
  );
  const finishedJob = await waitForJob(queuedJob.id);
  check(
    '队列任务执行完成并返回结果',
    finishedJob?.status === 'done' &&
      finishedJob.progress === 100 &&
      Boolean(finishedJob.result?.id) &&
      finishedJob.error === null,
    JSON.stringify(finishedJob),
  );
  const jobHistoryItem = ((await getHistory()).body?.items || []).find(
    (item) => item.id === finishedJob?.result?.id,
  );
  check(
    '队列任务结果写入历史',
    Boolean(jobHistoryItem) &&
      jobHistoryItem.prompt === finishedJob?.result?.prompt &&
      jobHistoryItem.albumId === batchAlbum.id,
    JSON.stringify(jobHistoryItem),
  );
  const jobRow = ((await getJobs()).body?.jobs || []).find(
    (entry) => entry.id === finishedJob?.id,
  );
  check(
    'GET /api/jobs 返回已完成任务的状态与结果',
    jobRow?.status === 'done' &&
      Boolean(jobRow?.result?.id) &&
      jobRow.startedAt > 0 &&
      jobRow.finishedAt >= jobRow.startedAt,
    JSON.stringify(jobRow),
  );

  const jobEmptyInput = await enqueueJob({ kind: 'generate', text: '   ' });
  check(
    '任务队列拒绝空输入',
    jobEmptyInput.status === 400 && jobEmptyInput.body?.error?.code === 'EMPTY_INPUT',
  );
  const jobTooLongInput = await enqueueJob({ kind: 'generate', text: 'x'.repeat(4001) });
  check(
    '任务队列拒绝超长输入',
    jobTooLongInput.status === 400 &&
      jobTooLongInput.body?.error?.code === 'INPUT_TOO_LONG',
  );
  const jobUnknownAlbum = await enqueueJob({
    kind: 'generate',
    text: '任务画册',
    albumId: ghostId,
  });
  check(
    '任务队列拒绝未知画册',
    jobUnknownAlbum.status === 404 &&
      jobUnknownAlbum.body?.error?.code === 'ALBUM_NOT_FOUND',
  );

  const rerenderJobResponse = await enqueueJob({
    kind: 'rerender',
    historyId: source.id,
    seedMode: 'new',
  });
  const rerenderJobDone = await waitForJob(rerenderJobResponse.body?.job?.id);
  check(
    '重画任务入队并完成',
    rerenderJobResponse.status === 202 &&
      rerenderJobDone?.status === 'done' &&
      rerenderJobDone.result?.parentId === source.id &&
      rerenderJobDone.result?.seed !== source.seed,
    JSON.stringify(rerenderJobDone?.result),
  );

  /* 队列并发为 1（慢速上游） */
  await setMockMode({ naiMode: 'slow' });
  const concurrencyA = await enqueueJob({ kind: 'generate', text: '并发任务 A' });
  const concurrencyB = await enqueueJob({ kind: 'generate', text: '并发任务 B' });
  check(
    '第二个任务处于排队状态',
    concurrencyB.status === 202 &&
      concurrencyB.body?.job?.status === 'queued' &&
      concurrencyB.body.queueLength >= 1,
    JSON.stringify({
      status: concurrencyB.body?.job?.status,
      queueLength: concurrencyB.body?.queueLength,
    }),
  );
  const concurrencyADone = await waitForJob(concurrencyA.body.job.id);
  const concurrencyBDone = await waitForJob(concurrencyB.body.job.id);
  check(
    '队列并发为 1：第二个任务在第一个结束后才开始',
    concurrencyADone?.status === 'done' &&
      concurrencyBDone?.status === 'done' &&
      concurrencyADone.finishedAt > 0 &&
      concurrencyBDone.startedAt >= concurrencyADone.finishedAt,
    JSON.stringify({
      aFinished: concurrencyADone?.finishedAt,
      bStarted: concurrencyBDone?.startedAt,
    }),
  );

  /* 取消排队中的任务 */
  const queuedCancelA = await enqueueJob({ kind: 'generate', text: '排队取消 A' });
  const queuedCancelB = await enqueueJob({ kind: 'generate', text: '排队取消 B' });
  const historyBeforeQueuedCancel = await historyIds();
  const queuedCancelResult = await cancelJob(queuedCancelB.body.job.id);
  check(
    '排队中的任务可立即取消',
    queuedCancelResult.status === 200 &&
      queuedCancelResult.body?.job?.status === 'canceled' &&
      queuedCancelResult.body.job.stage === 'canceled',
    JSON.stringify(queuedCancelResult.body?.job),
  );
  const queuedCancelADone = await waitForJob(queuedCancelA.body.job.id);
  const historyAfterQueuedCancel = await historyIds();
  check('取消排队任务后其余任务继续完成', queuedCancelADone?.status === 'done');
  check(
    '取消排队任务不写入历史',
    queuedCancelADone?.status === 'done' &&
      historyAfterQueuedCancel.length === historyBeforeQueuedCancel.length + 1,
    `${historyBeforeQueuedCancel.length} -> ${historyAfterQueuedCancel.length}`,
  );

  /* 取消运行中的任务 */
  const historyBeforeRunningCancel = await historyIds();
  const abortsBeforeRunningCancel = mock.naiAborts;
  const runningCancelJob = await enqueueJob({ kind: 'generate', text: '取消运行中任务' });
  const runningJobRow = await waitForJobCondition(
    runningCancelJob.body.job.id,
    (job) => job.status === 'running' && job.stage === 'nai',
  );
  check(
    '任务进入 NovelAI 运行阶段',
    runningJobRow?.status === 'running' && runningJobRow.stage === 'nai',
    JSON.stringify(runningJobRow),
  );
  const runningCancelResult = await cancelJob(runningCancelJob.body.job.id);
  check(
    '取消运行中任务进入取消流程',
    runningCancelResult.status === 200 &&
      ['running', 'canceling', 'canceled'].includes(runningCancelResult.body?.job?.status),
    JSON.stringify(runningCancelResult.body?.job),
  );
  const runningCanceled = await waitForJob(runningCancelJob.body.job.id);
  check(
    '运行中任务最终状态为 canceled',
    runningCanceled?.status === 'canceled' &&
      runningCanceled.result === null &&
      runningCanceled.error?.code === 'CANCELED',
    JSON.stringify(runningCanceled),
  );
  const historyAfterRunningCancel = await historyIds();
  check(
    '取消运行中任务不写入历史',
    historyAfterRunningCancel.length === historyBeforeRunningCancel.length,
    `${historyBeforeRunningCancel.length} -> ${historyAfterRunningCancel.length}`,
  );
  await sleep(300);
  check(
    '取消运行中任务会中止上游请求',
    mock.naiAborts > abortsBeforeRunningCancel,
    `${abortsBeforeRunningCancel} -> ${mock.naiAborts}`,
  );

  /* 取消全部排队任务 */
  const cancelAllRunning = await enqueueJob({ kind: 'generate', text: '取消全部运行中' });
  await waitForJobCondition(
    cancelAllRunning.body.job.id,
    (job) => job.status === 'running',
  );
  const cancelAllQueuedOne = await enqueueJob({ kind: 'generate', text: '取消全部排队 1' });
  const cancelAllQueuedTwo = await enqueueJob({ kind: 'generate', text: '取消全部排队 2' });
  const cancelAllResult = await cancelAllJobs();
  const cancelAllJobRows = cancelAllResult.body?.jobs || [];
  const canceledOne = cancelAllJobRows.find(
    (job) => job.id === cancelAllQueuedOne.body.job.id,
  );
  const canceledTwo = cancelAllJobRows.find(
    (job) => job.id === cancelAllQueuedTwo.body.job.id,
  );
  check(
    'cancel-all 取消全部排队任务',
    cancelAllResult.status === 200 &&
      canceledOne?.status === 'canceled' &&
      canceledTwo?.status === 'canceled' &&
      cancelAllResult.body?.queueLength === 0,
    JSON.stringify({
      one: canceledOne?.status,
      two: canceledTwo?.status,
      queueLength: cancelAllResult.body?.queueLength,
    }),
  );
  const cancelAllRunningDone = await waitForJob(cancelAllRunning.body.job.id);
  check(
    'cancel-all 不影响运行中的任务',
    cancelAllRunningDone?.status === 'done',
    JSON.stringify(cancelAllRunningDone?.status),
  );
  await setMockMode({ naiMode: 'ok' });

  /* 删除任务记录 */
  const dismissableJob = await enqueueJob({ kind: 'generate', text: '待删除的任务记录' });
  const dismissableDone = await waitForJob(dismissableJob.body.job.id);
  const dismissJobResult = await removeJob(dismissableDone.id);
  check(
    '删除已结束任务记录',
    dismissJobResult.status === 200 &&
      dismissJobResult.body?.deleted === dismissableDone.id &&
      !(dismissJobResult.body?.jobs || []).some((job) => job.id === dismissableDone.id),
  );
  const removeUnknownJob = await removeJob(ghostId);
  check(
    '删除不存在的任务返回 404',
    removeUnknownJob.status === 404 &&
      removeUnknownJob.body?.error?.code === 'JOB_NOT_FOUND',
  );
  const cancelUnknownJob = await cancelJob(ghostId);
  check(
    '取消不存在的任务返回 404',
    cancelUnknownJob.status === 404 &&
      cancelUnknownJob.body?.error?.code === 'JOB_NOT_FOUND',
  );

  await setMockMode({ naiMode: 'slow' });
  const activeJob = await enqueueJob({ kind: 'generate', text: '进行中的任务' });
  await waitForJobCondition(activeJob.body.job.id, (job) => job.status === 'running');
  const removeActiveJob = await removeJob(activeJob.body.job.id);
  check(
    '删除进行中任务返回 409',
    removeActiveJob.status === 409 &&
      removeActiveJob.body?.error?.code === 'JOB_ACTIVE',
  );
  await cancelJob(activeJob.body.job.id);
  await waitForJob(activeJob.body.job.id);
  await setMockMode({ naiMode: 'ok' });

  /* =================================================================== */
  /* 1.8.0 新功能：PNG 元数据 + 配套 JSON 导出                           */
  /* =================================================================== */

  /* 生成后自动写 sidecar 与 PNG 文本 chunk */
  const metaAlbum = (await createAlbum('元数据画册')).body?.album;
  const metaItem = (await generate('元数据生成', { albumId: metaAlbum.id })).body?.result;
  const metaRelative = `albums/${metaAlbum.id}/${metaItem.filename}`;
  check(
    '生成后自动写出同名 sidecar JSON',
    fs.existsSync(sidecarPathFor(metaRelative)),
    sidecarPathFor(metaRelative),
  );
  const metaSidecar = await readSidecar(metaRelative);
  check(
    'sidecar 基本信息与 schema 正确',
    metaSidecar.schema === 'nai-atelier.metadata/1' &&
      metaSidecar.app === 'NAI Atelier' &&
      metaSidecar.appVersion === APP_VERSION &&
      !Number.isNaN(Date.parse(metaSidecar.exportedAt)) &&
      metaSidecar.id === metaItem.id &&
      metaSidecar.filename === metaItem.filename &&
      metaSidecar.relativePath === metaRelative &&
      metaSidecar.url === metaItem.url &&
      metaSidecar.albumId === metaAlbum.id &&
      metaSidecar.parentId === '' &&
      metaSidecar.createdAt === metaItem.createdAt &&
      metaSidecar.elapsedMs === metaItem.elapsedMs,
    JSON.stringify(metaSidecar),
  );
  check(
    'sidecar 记录完整生成参数与提示词',
    metaSidecar.prompt === metaItem.prompt &&
      metaSidecar.llmTags === '1girl, solo, rain, city_lights' &&
      metaSidecar.negativePrompt === 'lowres, bad hands' &&
      metaSidecar.model === 'nai-diffusion-4-5-full' &&
      metaSidecar.sampler === 'k_euler_ancestral' &&
      metaSidecar.noiseSchedule === 'karras' &&
      metaSidecar.steps === 24 &&
      metaSidecar.scale === 5.5 &&
      metaSidecar.cfgRescale === 0.2 &&
      metaSidecar.width === 832 &&
      metaSidecar.height === 1216 &&
      metaSidecar.seed === metaItem.seed &&
      metaSidecar.qualityToggle === true &&
      metaSidecar.llmProvider === 'openai' &&
      metaSidecar.llmModel === 'mock-chat',
    JSON.stringify(metaSidecar),
  );

  const metaPngBuffer = await readOutputFile(metaRelative);
  const metaPng = parseEmbeddedPngMetadata(metaPngBuffer);
  check(
    'PNG 结构合法（签名 / IHDR / IEND / CRC）',
    metaPng.structureValid &&
      metaPng.chunkTypes[0] === 'IHDR' &&
      metaPng.chunkTypes.at(-1) === 'IEND',
    metaPng.chunkTypes.join(','),
  );
  check(
    'PNG 内嵌自有 chunk 恰为 2 个且都在 IEND 之前',
    metaPng.own.length === 2 &&
      metaPng.own.every((entry) => entry.index < metaPng.iendIndex) &&
      metaPng.own.some((entry) => entry.keyword === 'parameters') &&
      metaPng.own.some((entry) => entry.keyword === 'NAI-Atelier') &&
      new Set(metaPng.own.map((entry) => entry.keyword)).size === 2,
    JSON.stringify(
      metaPng.own.map(({ keyword, type, index }) => ({ keyword, type, index })),
    ),
  );
  check(
    'PNG 内嵌 NAI-Atelier JSON 可解析且字段正确',
    metaPng.metadata?.id === metaItem.id &&
      metaPng.metadata?.schema === 'nai-atelier.metadata/1' &&
      metaPng.metadata?.appVersion === APP_VERSION &&
      metaPng.metadata?.relativePath === metaRelative &&
      metaPng.metadata?.albumId === metaAlbum.id &&
      metaPng.metadata?.prompt === metaItem.prompt &&
      metaPng.metadata?.seed === metaItem.seed &&
      metaPng.metadata?.steps === 24 &&
      metaPng.metadata?.model === 'nai-diffusion-4-5-full',
    JSON.stringify(metaPng.metadata),
  );
  const metaParametersExpected = [
    metaItem.prompt,
    'Negative prompt: lowres, bad hands',
    `Steps: 24, Sampler: k_euler_ancestral, Schedule type: karras, CFG scale: 5.5, Seed: ${metaItem.seed}, Size: 832x1216, Model: nai-diffusion-4-5-full, NAI Atelier: ${APP_VERSION}`,
  ].join('\n');
  check(
    'PNG parameters chunk 为 A1111 风格文本',
    metaPng.parametersChunk?.type === 'tEXt' &&
      metaPng.parametersChunk.text === metaParametersExpected,
    metaPng.parametersChunk?.text,
  );
  check(
    'PNG 内嵌 JSON 与 sidecar 内容一致',
    Boolean(metaPng.metadata) &&
      metaPng.metadata.exportedAt === metaSidecar.exportedAt &&
      JSON.stringify(metaPng.metadata) === JSON.stringify(metaSidecar),
  );
  const metaServed = await fetch(`${app.base}${metaItem.url}`, {
    signal: AbortSignal.timeout(5000),
  });
  check(
    '写入元数据后图片仍可 /outputs 访问',
    metaServed.status === 200 &&
      metaServed.headers.get('content-type') === 'image/png',
    String(metaServed.status),
  );
  await metaServed.arrayBuffer();

  /* metadata API */
  const metaApi = await getIdMetadata(metaItem.id);
  check(
    'metadata API 返回元数据',
    metaApi.status === 200 &&
      metaApi.body?.metadata?.schema === 'nai-atelier.metadata/1' &&
      metaApi.body.metadata.id === metaItem.id &&
      metaApi.body.metadata.relativePath === metaRelative,
    JSON.stringify(metaApi.body),
  );
  const metaDownload = await request(
    'GET',
    `/api/history/${encodeURIComponent(metaItem.id)}/metadata?download=1`,
    { raw: true },
  );
  check(
    'metadata download 返回附件 JSON 与正确文件名',
    metaDownload.status === 200 &&
      String(metaDownload.headers.get('content-type')).includes('application/json') &&
      metaDownload.headers.get('content-disposition') ===
        `attachment; filename="${metaItem.filename.replace(IMAGE_EXTENSION_RE, '.json')}"` &&
      JSON.parse(metaDownload.text).id === metaItem.id,
    JSON.stringify({
      disposition: metaDownload.headers.get('content-disposition'),
      type: metaDownload.headers.get('content-type'),
    }),
  );
  const metaMissing = await getIdMetadata(ghostId);
  check(
    '不存在作品的 metadata 返回 404',
    metaMissing.status === 404 &&
      metaMissing.body?.error?.code === 'HISTORY_NOT_FOUND',
  );

  /* 含中文 prompt 必须用 iTXt（UTF-8） */
  await setConfig({ novelai: { basePositive: '中文标签, 1girl' } });
  const metaChinese = (await generate('中文元数据')).body?.result;
  await setConfig({ novelai: { basePositive: 'cinematic lighting, 1girl' } });
  const chineseRelative = metaChinese.relativePath;
  const chinesePng = parseEmbeddedPngMetadata(await readOutputFile(chineseRelative));
  check(
    '含中文的 prompt 使用 iTXt 且 UTF-8 可读',
    chinesePng.parametersChunk?.type === 'iTXt' &&
      chinesePng.parametersChunk.compressed === false &&
      chinesePng.parametersChunk.compressionMethod === 0 &&
      String(chinesePng.parametersChunk.languageTag) === '' &&
      chinesePng.parametersChunk.text.includes('中文标签') &&
      chinesePng.parametersChunk.text.split('\n')[0] === metaChinese.prompt,
    JSON.stringify({
      type: chinesePng.parametersChunk?.type,
      text: chinesePng.parametersChunk?.text,
    }),
  );
  check(
    '含中文的内嵌 JSON 也使用 iTXt 且可解析',
    chinesePng.jsonChunk?.type === 'iTXt' &&
      chinesePng.metadata?.id === metaChinese.id &&
      chinesePng.metadata?.prompt === metaChinese.prompt &&
      chinesePng.metadata?.prompt.includes('中文标签'),
    JSON.stringify(chinesePng.metadata?.prompt),
  );
  const chineseParametersChunk = chinesePng.parametersChunk;
  check(
    'iTXt 布局：关键字后紧跟 5 个 0 字节',
    Boolean(chineseParametersChunk) &&
      chinesePng.png.chunks[chineseParametersChunk.index].data
        .subarray(chineseParametersChunk.keywordEnd, chineseParametersChunk.keywordEnd + 5)
        .equals(Buffer.alloc(5)),
  );
  const chineseSidecar = await readSidecar(chineseRelative);
  check(
    '中文 sidecar JSON 以 UTF-8 正确保存',
    chineseSidecar.id === metaChinese.id &&
      chineseSidecar.prompt === metaChinese.prompt &&
      chineseSidecar.prompt.includes('中文标签'),
    JSON.stringify(chineseSidecar.prompt),
  );

  /* sync：指定 ids / 幂等 / 全量 */
  const syncPngBefore = parseEmbeddedPngMetadata(await readOutputFile(metaRelative));
  const syncOne = await syncMetadata([metaItem.id]);
  check(
    'sync 指定 ids 返回 synced/total',
    syncOne.status === 200 &&
      syncOne.body?.synced === 1 &&
      Array.isArray(syncOne.body.failed) &&
      syncOne.body.failed.length === 0 &&
      syncOne.body.total === (await historyIds()).length,
    JSON.stringify(syncOne.body),
  );
  const syncPngAfter = parseEmbeddedPngMetadata(await readOutputFile(metaRelative));
  check(
    'sync 幂等：自有 chunk 仍恰为 2 个',
    syncPngAfter.own.length === 2 &&
      JSON.stringify(syncPngAfter.own.map((entry) => entry.keyword)) ===
        JSON.stringify(['parameters', 'NAI-Atelier']),
    JSON.stringify(syncPngAfter.own.map((entry) => entry.keyword)),
  );
  check(
    'sync 后 PNG 仍合法且图像数据未变',
    syncPngAfter.structureValid &&
      JSON.stringify(IDAT_HEX(syncPngAfter.png)) ===
        JSON.stringify(IDAT_HEX(syncPngBefore.png)) &&
      syncPngAfter.metadata?.id === metaItem.id,
  );
  const syncAgain = await syncMetadata([metaItem.id]);
  const syncPngThird = parseEmbeddedPngMetadata(await readOutputFile(metaRelative));
  check(
    '重复 sync 不产生重复 chunk',
    syncAgain.body?.synced === 1 &&
      syncPngThird.own.length === 2 &&
      syncPngThird.structureValid,
  );
  // Stronger than idempotency: removing the chunks entirely must be repaired.
  const strippedPngBuffer = stripOwnPngChunks(await readOutputFile(metaRelative));
  const strippedPng = parseEmbeddedPngMetadata(strippedPngBuffer);
  await fsp.writeFile(
    path.join(OUTPUTS_DIR, ...metaRelative.split('/')),
    strippedPngBuffer,
  );
  const syncRepair = await syncMetadata([metaItem.id]);
  const repairedPng = parseEmbeddedPngMetadata(await readOutputFile(metaRelative));
  check(
    'sync 可补回被移除的自有 chunk',
    strippedPng.own.length === 0 &&
      strippedPng.structureValid &&
      syncRepair.body?.synced === 1 &&
      repairedPng.own.length === 2 &&
      repairedPng.structureValid &&
      repairedPng.metadata?.id === metaItem.id &&
      repairedPng.parametersChunk?.type === 'tEXt',
    JSON.stringify({
      stripped: strippedPng.own.length,
      repaired: repairedPng.own.length,
    }),
  );
  const syncMixed = await syncMetadata([ghostId, metaItem.id]);
  check(
    'sync 混合未知 id 时只同步有效作品',
    syncMixed.status === 200 &&
      syncMixed.body?.synced === 1 &&
      syncMixed.body?.failed?.length === 0,
    JSON.stringify(syncMixed.body),
  );
  // Failure branch: a record whose image vanished must be reported, not thrown.
  const syncFailItem = (await generate('同步失败元数据')).body?.result;
  const syncFailRelative = syncFailItem.relativePath;
  await fsp.rm(path.join(OUTPUTS_DIR, ...syncFailRelative.split('/')), { force: true });
  const syncFailed = await syncMetadata([syncFailItem.id]);
  check(
    'sync 对缺失文件的作品返回 failed 明细',
    syncFailed.status === 200 &&
      syncFailed.body?.synced === 0 &&
      syncFailed.body?.failed?.length === 1 &&
      syncFailed.body.failed[0]?.id === syncFailItem.id &&
      syncFailed.body.failed[0]?.filename === syncFailItem.filename &&
      typeof syncFailed.body.failed[0]?.message === 'string',
    JSON.stringify(syncFailed.body),
  );
  const cleanupSyncFail = await request(
    'DELETE',
    `/api/history/${encodeURIComponent(syncFailItem.id)}?permanent=1`,
  );
  check(
    '清理缺文件的历史记录成功',
    cleanupSyncFail.status === 200 &&
      !(await historyIds()).includes(syncFailItem.id) &&
      !fs.existsSync(sidecarPathFor(syncFailRelative)),
  );
  const historyBeforeSyncAll = await historyIds();
  const syncAll = await syncMetadata();
  check(
    'sync 缺省同步全部历史且 total 正确',
    syncAll.status === 200 &&
      syncAll.body?.synced === historyBeforeSyncAll.length &&
      syncAll.body?.failed?.length === 0 &&
      syncAll.body?.total === historyBeforeSyncAll.length,
    JSON.stringify(syncAll.body),
  );
  const sidecarCountAfterSyncAll = await countHistorySidecars();
  check(
    '全量同步后每个历史作品都有 sidecar',
    sidecarCountAfterSyncAll === historyBeforeSyncAll.length,
    `${sidecarCountAfterSyncAll} vs ${historyBeforeSyncAll.length}`,
  );
  const metaPngAfterAllSync = parseEmbeddedPngMetadata(await readOutputFile(metaRelative));
  check(
    '全量同步后已有文件 chunk 数量不增长',
    metaPngAfterAllSync.own.length === 2 &&
      metaPngAfterAllSync.structureValid &&
      metaPngAfterAllSync.metadata?.id === metaItem.id,
    JSON.stringify(metaPngAfterAllSync.own.map((entry) => entry.keyword)),
  );

  /* 移动画册时 sidecar 跟随并刷新 */
  const metaMoved = await moveHistoryItem(metaItem.id, null);
  const metaRootRelative = metaItem.filename;
  check(
    '移动到未分类时 sidecar 跟随移动',
    metaMoved.status === 200 &&
      fs.existsSync(sidecarPathFor(metaRootRelative)) &&
      !fs.existsSync(sidecarPathFor(metaRelative)),
    JSON.stringify(metaMoved.body?.item),
  );
  const metaMovedSidecar = await readSidecar(metaRootRelative);
  check(
    '移动后 sidecar 内 relativePath/url/albumId 更新',
    metaMovedSidecar.relativePath === metaRootRelative &&
      metaMovedSidecar.albumId === null &&
      metaMovedSidecar.url === `/outputs/${metaItem.filename}`,
    JSON.stringify(metaMovedSidecar),
  );
  const metaMovedPng = parseEmbeddedPngMetadata(await readOutputFile(metaRootRelative));
  check(
    '移动后 PNG 内嵌 JSON 同步刷新',
    metaMovedPng.metadata?.relativePath === metaRootRelative &&
      metaMovedPng.metadata?.albumId === null &&
      metaMovedPng.own.length === 2,
    JSON.stringify(metaMovedPng.metadata),
  );
  const metaMovedBack = await moveHistoryItem(metaItem.id, metaAlbum.id);
  const metaBackRelative = `albums/${metaAlbum.id}/${metaItem.filename}`;
  const metaBackSidecar = await readSidecar(metaBackRelative);
  check(
    '移回画册后 sidecar 跟随移动',
    metaMovedBack.status === 200 &&
      fs.existsSync(sidecarPathFor(metaBackRelative)) &&
      !fs.existsSync(sidecarPathFor(metaRootRelative)) &&
      metaBackSidecar.relativePath === metaBackRelative &&
      metaBackSidecar.albumId === metaAlbum.id,
    JSON.stringify(metaBackSidecar),
  );
  const metaBackPng = parseEmbeddedPngMetadata(await readOutputFile(metaBackRelative));
  check(
    '移回画册后 PNG 内嵌 JSON 同步刷新',
    metaBackPng.metadata?.relativePath === metaBackRelative &&
      metaBackPng.metadata?.albumId === metaAlbum.id &&
      metaBackPng.own.length === 2,
    JSON.stringify(metaBackPng.metadata),
  );

  /* 删除画册把作品移回根目录时 sidecar 一起回来 */
  const metaAlbumWrong = (await createAlbum('元数据删除画册')).body?.album;
  const metaWrongItem = (
    await generate('元数据画册删除', { albumId: metaAlbumWrong.id })
  ).body?.result;
  const metaWrongRelative = `albums/${metaAlbumWrong.id}/${metaWrongItem.filename}`;
  check(
    '画册作品生成后 sidecar 在画册目录',
    fs.existsSync(sidecarPathFor(metaWrongRelative)),
  );
  const metaWrongDeleted = await deleteAlbum(metaAlbumWrong.id);
  const metaWrongRootRelative = metaWrongItem.filename;
  const metaWrongRootSidecar = await readSidecar(metaWrongRootRelative);
  check(
    '删除画册回到根目录时 sidecar 也回到根目录',
    metaWrongDeleted.status === 200 &&
      fs.existsSync(path.join(OUTPUTS_DIR, metaWrongRootRelative)) &&
      fs.existsSync(sidecarPathFor(metaWrongRootRelative)) &&
      !fs.existsSync(path.join(OUTPUTS_DIR, ...metaWrongRelative.split('/'))) &&
      !fs.existsSync(sidecarPathFor(metaWrongRelative)) &&
      metaWrongRootSidecar.albumId === null &&
      metaWrongRootSidecar.relativePath === metaWrongRootRelative,
    JSON.stringify(metaWrongDeleted.body),
  );

  /* 回收站生命周期：移入移除 sidecar、恢复重建 */
  const trashBeforeMeta = (await getTrash()).body?.items?.length || 0;
  const metaTrashed = await deleteHistory(metaItem.id);
  check(
    '移入回收站后原位置 sidecar 被移除',
    metaTrashed.status === 200 &&
      metaTrashed.body?.trashed === true &&
      !fs.existsSync(sidecarPathFor(metaBackRelative)) &&
      !fs.existsSync(path.join(OUTPUTS_DIR, ...metaBackRelative.split('/'))),
    JSON.stringify(metaTrashed.body),
  );
  const trashDirEntries = await fsp.readdir(path.join(OUTPUTS_DIR, '.trash'));
  check(
    '回收站目录中不存在 sidecar',
    !trashDirEntries.some((name) => name.endsWith('.json')),
    JSON.stringify(trashDirEntries),
  );
  check(
    '移入回收站后回收站列表增加',
    ((await getTrash()).body?.items?.length || 0) === trashBeforeMeta + 1,
  );
  const metaTrashEntry = await findTrashEntry(
    (entry) => entry.filename === metaItem.filename,
  );
  const metaRestored = await restoreTrashItem(metaTrashEntry.id);
  const restoredMetaItem = metaRestored.body?.item;
  const restoredMetaRelative = restoredMetaItem?.relativePath;
  check(
    '回收站恢复后 sidecar 重新写入',
    metaRestored.status === 200 &&
      Boolean(restoredMetaItem) &&
      fs.existsSync(sidecarPathFor(restoredMetaRelative)),
    JSON.stringify(restoredMetaItem),
  );
  const restoredMetaSidecar = await readSidecar(restoredMetaRelative);
  const restoredMetaPng = parseEmbeddedPngMetadata(
    await readOutputFile(restoredMetaRelative),
  );
  check(
    '恢复后的 sidecar 与内嵌 JSON 指向新记录',
    restoredMetaSidecar.id === restoredMetaItem.id &&
      restoredMetaSidecar.albumId === metaAlbum.id &&
      restoredMetaSidecar.relativePath === restoredMetaRelative &&
      restoredMetaPng.metadata?.id === restoredMetaItem.id &&
      restoredMetaPng.own.length === 2 &&
      restoredMetaPng.structureValid,
    JSON.stringify(restoredMetaSidecar),
  );
  check(
    '恢复后回收站回到原数量',
    ((await getTrash()).body?.items?.length || 0) === trashBeforeMeta,
  );
  const restoredMetaApi = await getIdMetadata(restoredMetaItem.id);
  check(
    '恢复后 metadata API 可用',
    restoredMetaApi.status === 200 &&
      restoredMetaApi.body?.metadata?.relativePath === restoredMetaRelative,
    JSON.stringify(restoredMetaApi.body?.metadata),
  );

  /* 永久删除时移除 sidecar */
  const metaPermanent = (await generate('永久删除元数据')).body?.result;
  const metaPermanentRelative = metaPermanent.relativePath;
  check(
    '永久删除前 sidecar 存在',
    fs.existsSync(sidecarPathFor(metaPermanentRelative)),
  );
  const metaPermanentDeleted = await request(
    'DELETE',
    `/api/history/${encodeURIComponent(metaPermanent.id)}?permanent=1`,
  );
  check(
    '永久删除后 sidecar 与图片都被移除',
    metaPermanentDeleted.status === 200 &&
      metaPermanentDeleted.body?.trashed === false &&
      !fs.existsSync(sidecarPathFor(metaPermanentRelative)) &&
      !fs.existsSync(path.join(OUTPUTS_DIR, metaPermanentRelative)),
    JSON.stringify(metaPermanentDeleted.body),
  );

  /* 元数据 ZIP 归档 */
  const historyForArchive = (await getHistory()).body?.items || [];
  const archiveResponse = await fetchMetadataArchive();
  const archiveBuffer = Buffer.from(await archiveResponse.arrayBuffer());
  check(
    'metadata 归档返回 ZIP 并带计数与附件头',
    archiveResponse.status === 200 &&
      archiveResponse.headers.get('content-type') === 'application/zip' &&
      /attachment; filename="nai-atelier-metadata-\d{14}\.zip"/.test(
        String(archiveResponse.headers.get('content-disposition')),
      ) &&
      archiveResponse.headers.get('x-metadata-count') ===
        String(historyForArchive.length),
    JSON.stringify({
      type: archiveResponse.headers.get('content-type'),
      disposition: archiveResponse.headers.get('content-disposition'),
      count: archiveResponse.headers.get('x-metadata-count'),
    }),
  );
  const archive = new AdmZip(archiveBuffer);
  const archiveEntries = archive.getEntries();
  const archiveNames = archiveEntries.map((entry) => entry.entryName);
  const manifestEntry = archive.getEntry('manifest.json');
  const manifest = manifestEntry
    ? JSON.parse(manifestEntry.getData().toString('utf8'))
    : null;
  check(
    '归档包含 manifest 且 count 正确',
    Boolean(manifest) &&
      manifest.schema === 'nai-atelier.metadata/1' &&
      manifest.app === 'NAI Atelier' &&
      manifest.appVersion === APP_VERSION &&
      manifest.count === historyForArchive.length &&
      !Number.isNaN(Date.parse(manifest.exportedAt)) &&
      archiveNames.length === historyForArchive.length + 1 &&
      new Set(archiveNames).size === archiveNames.length,
    JSON.stringify({ manifest, entries: archiveNames.length }),
  );
  const archiveJsonEntries = archiveEntries.filter(
    (entry) => entry.entryName !== 'manifest.json',
  );
  const archiveIds = [];
  let archiveFieldsOk = true;
  for (const entry of archiveJsonEntries) {
    const payload = JSON.parse(entry.getData().toString('utf8'));
    if (
      payload.schema !== 'nai-atelier.metadata/1' ||
      payload.appVersion !== APP_VERSION ||
      typeof payload.id !== 'string'
    ) {
      archiveFieldsOk = false;
      break;
    }
    archiveIds.push(payload.id);
  }
  check(
    '归档为每个作品生成一个合法 JSON',
    archiveJsonEntries.length === historyForArchive.length &&
      archiveFieldsOk &&
      new Set(archiveIds).size === archiveIds.length &&
      historyForArchive.every((item) => archiveIds.includes(item.id)),
    `${archiveJsonEntries.length} vs ${historyForArchive.length}`,
  );
  const metaArchiveEntry = archive.getEntry(
    restoredMetaItem.filename.replace(IMAGE_EXTENSION_RE, '.json'),
  );
  const metaArchivePayload = metaArchiveEntry
    ? JSON.parse(metaArchiveEntry.getData().toString('utf8'))
    : null;
  check(
    '归档中单个作品 JSON 与历史一致',
    metaArchivePayload?.id === restoredMetaItem.id &&
      metaArchivePayload.relativePath === restoredMetaRelative &&
      metaArchivePayload.prompt === restoredMetaItem.prompt &&
      metaArchivePayload.seed === restoredMetaItem.seed,
    JSON.stringify(metaArchivePayload),
  );

  /* 生成失败不产生任何文件 */
  const filesBeforeFailedGenerate = await listOutputFiles();
  const historyBeforeFailedGenerate = await historyIds();
  await setMockMode({ naiMode: 'error' });
  const failedMetadataGenerate = await generate('元数据生成失败');
  await setMockMode({ naiMode: 'ok' });
  const filesAfterFailedGenerate = await listOutputFiles();
  const historyAfterFailedGenerate = await historyIds();
  check(
    '生成失败不创建 sidecar / 图片，也不写历史',
    failedMetadataGenerate.status === 502 &&
      JSON.stringify(filesAfterFailedGenerate) ===
        JSON.stringify(filesBeforeFailedGenerate) &&
      historyAfterFailedGenerate.length === historyBeforeFailedGenerate.length,
    JSON.stringify({
      status: failedMetadataGenerate.status,
      added: filesAfterFailedGenerate.filter(
        (file) => !filesBeforeFailedGenerate.includes(file),
      ),
    }),
  );

  /* 错误路径 */
  const empty = await generate('   ');
  check('空输入被拒绝', empty.status === 400 && empty.body?.error?.code === 'EMPTY_INPUT');

  const tooLong = await generate('x'.repeat(4001));
  check(
    '超长输入被拒绝',
    tooLong.status === 400 && tooLong.body?.error?.code === 'INPUT_TOO_LONG',
  );

  const badJson = await request('POST', '/api/generate', { body: '{not json' });
  check(
    '非法 JSON 被拒绝',
    badJson.status === 400 && badJson.body?.error?.code === 'INVALID_JSON',
  );

  const oversized = await request('POST', '/api/generate', {
    body: JSON.stringify({ text: 'x'.repeat(3 * 1024 * 1024) }),
  });
  check(
    '超大请求体被拒绝',
    oversized.status === 413 && oversized.body?.error?.code === 'BODY_TOO_LARGE',
  );

  await fetch(`${mockBase}/__mode`, {
    method: 'POST',
    body: JSON.stringify({ naiMode: 'error' }),
    signal: AbortSignal.timeout(5000),
  });
  const naiError = await generate('触发上游错误');
  check(
    'NovelAI 402 映射为友好错误',
    naiError.status === 502 &&
      naiError.body?.error?.code === 'NAI_QUOTA' &&
      naiError.body.error.message.includes('mock anlas shortage'),
    naiError.body?.error?.message,
  );

  await fetch(`${mockBase}/__mode`, {
    method: 'POST',
    body: JSON.stringify({ naiMode: 'no-image' }),
    signal: AbortSignal.timeout(5000),
  });
  const noImage = await generate('空 ZIP');
  check(
    '无图片 ZIP 被拒绝',
    noImage.status === 502 && noImage.body?.error?.code === 'NAI_ZIP_NO_IMAGE',
  );

  await fetch(`${mockBase}/__mode`, {
    method: 'POST',
    body: JSON.stringify({ llmMode: 'error' }),
    signal: AbortSignal.timeout(5000),
  });
  const llmError = await generate('LLM 错误');
  check(
    'LLM 401 映射为友好错误',
    llmError.status === 502 &&
      llmError.body?.error?.code === 'LLM_UPSTREAM_ERROR' &&
      llmError.body.error.message.includes('mock bad key'),
    llmError.body?.error?.message,
  );

  await fetch(`${mockBase}/__mode`, {
    method: 'POST',
    body: JSON.stringify({ llmMode: 'ok', naiMode: 'ok' }),
    signal: AbortSignal.timeout(5000),
  });

  /* 静态资源与路由 */
  const traversal = await fetch(`${app.base}/outputs/..%2Fdata%2Fconfig.json`, {
    signal: AbortSignal.timeout(5000),
  });
  check('阻止 /outputs 路径穿越', traversal.status === 404, String(traversal.status));
  await traversal.arrayBuffer();

  const missingImage = await fetch(`${app.base}/outputs/nai-20990101-000000-abcdef.png`, {
    signal: AbortSignal.timeout(5000),
  });
  check('缺失图片返回 404', missingImage.status === 404);
  await missingImage.arrayBuffer();

  const unknownApi = await request('GET', '/api/does-not-exist');
  check(
    '未知 API 返回 JSON 404',
    unknownApi.status === 404 && unknownApi.body?.error?.code === 'NOT_FOUND',
  );

  const index = await fetch(`${app.base}/`, { signal: AbortSignal.timeout(5000) });
  check('首页可访问', index.status === 200);

  /* 重启恢复 */
  const historyBefore = await request('GET', '/api/history');
  const countBefore = historyBefore.body.items.length;
  const idsBeforeRestart = historyBefore.body.items.map((item) => item.id);
  await stopApp();
  await startApp();

  const historyAfter = await request('GET', '/api/history');
  check(
    '重启后历史恢复',
    historyAfter.body.items.length === countBefore && countBefore >= 3,
    `${countBefore} -> ${historyAfter.body.items.length}`,
  );
  const idsAfterRestart = historyAfter.body.items.map((item) => item.id);
  check(
    '重启后作品排序保持',
    JSON.stringify(idsAfterRestart) === JSON.stringify(idsBeforeRestart),
    `${idsBeforeRestart.length} vs ${idsAfterRestart.length}`,
  );
  check(
    '重启后图片仍在',
    fs.existsSync(
      path.join(
        OUTPUTS_DIR,
        ...(historyAfter.body.items[0].relativePath || historyAfter.body.items[0].filename).split('/'),
      ),
    ),
  );

  const albumsAfterRestart = await request('GET', '/api/albums');
  const albumARestored = albumsAfterRestart.body?.albums?.find(
    (album) => album.id === albumA.id,
  );
  check(
    '重启后画册恢复',
    albumsAfterRestart.status === 200 &&
      albumARestored?.name === '风景集' &&
      albumARestored.count >= 1,
    JSON.stringify(albumARestored),
  );
  const albumHistoryItem = historyAfter.body.items.find(
    (item) => item.albumId === albumA.id,
  );
  check(
    '重启后画册图片路径恢复',
    Boolean(albumHistoryItem) &&
      fs.existsSync(
        path.join(OUTPUTS_DIR, ...albumHistoryItem.relativePath.split('/')),
      ),
    JSON.stringify(albumHistoryItem),
  );

  const configAfter = await request('GET', '/api/config');
  check(
    '重启后配置恢复',
    configAfter.body.config.llm.baseUrl === `${mockBase}/v1` &&
      configAfter.body.config.llm.reasoningEffort === 'high' &&
      configAfter.body.config.novelai.model === 'nai-diffusion-4-5-full',
  );
  check(
    '重启后 NovelAI 超时设置保留',
    configAfter.body.config.novelai.timeoutSeconds === 420,
    JSON.stringify(configAfter.body.config.novelai.timeoutSeconds),
  );

  /* 重启后：画册封面 / 提示词收藏 / 回收站 / 排序持久化 */
  const coverAlbumAfterRestart = albumsAfterRestart.body?.albums?.find(
    (album) => album.id === coverAlbum.id,
  );
  const coverItemAfterRestart = historyAfter.body.items.find(
    (item) => item.id === coverFirst.id,
  );
  check(
    '重启后画册封面保留',
    coverAlbumAfterRestart?.coverId === coverFirst.id &&
      coverAlbumAfterRestart.coverUrl === coverItemAfterRestart?.url,
    JSON.stringify(coverAlbumAfterRestart),
  );
  const coverAfterRestartFile = await fetch(
    `${app.base}${coverAlbumAfterRestart?.coverUrl}`,
    { signal: AbortSignal.timeout(5000) },
  );
  check('重启后封面图片仍可访问', coverAfterRestartFile.status === 200);
  await coverAfterRestartFile.arrayBuffer();

  const promptsAfterRestart = await request('GET', '/api/prompts');
  const promptAfterRestart = (promptsAfterRestart.body?.prompts || []).find(
    (entry) => entry.name === '雨天场景',
  );
  check(
    '重启后提示词收藏保留',
    (promptsAfterRestart.body?.prompts || []).length === 2 &&
      promptAfterRestart?.positive === 'rain, city, umbrella' &&
      promptAfterRestart?.negative === 'lowres, bad hands',
    JSON.stringify(promptsAfterRestart.body?.prompts),
  );

  const trashAfterRestart = await request('GET', '/api/trash');
  const trashEntryAfterRestart = (trashAfterRestart.body?.items || [])[0];
  check(
    '重启后回收站保留',
    (trashAfterRestart.body?.items || []).length === 1 &&
      trashEntryAfterRestart?.filename === restartTrashSource.filename &&
      !Number.isNaN(Date.parse(trashEntryAfterRestart?.deletedAt)),
    JSON.stringify(trashAfterRestart.body?.items),
  );
  const trashFileAfterRestart = await fetch(
    `${app.base}${trashEntryAfterRestart?.url}`,
    { signal: AbortSignal.timeout(5000) },
  );
  check(
    '重启后回收站图片仍可访问',
    trashFileAfterRestart.status === 200,
    String(trashFileAfterRestart.status),
  );
  await trashFileAfterRestart.arrayBuffer();

  /* 重启后：1.8.0 元数据持久化 */
  const restoredMetaRowAfterRestart = historyAfter.body.items.find(
    (item) => item.id === restoredMetaItem.id,
  );
  const restoredMetaSidecarAfterRestart = restoredMetaRowAfterRestart
    ? await readSidecar(restoredMetaRowAfterRestart.relativePath)
    : null;
  const restoredMetaPngAfterRestart = restoredMetaRowAfterRestart
    ? parseEmbeddedPngMetadata(
        await readOutputFile(restoredMetaRowAfterRestart.relativePath),
      )
    : null;
  check(
    '重启后 sidecar 与内嵌元数据仍在',
    Boolean(restoredMetaRowAfterRestart) &&
      restoredMetaSidecarAfterRestart?.id === restoredMetaItem.id &&
      restoredMetaPngAfterRestart?.own.length === 2 &&
      restoredMetaPngAfterRestart?.structureValid &&
      restoredMetaPngAfterRestart?.metadata?.id === restoredMetaItem.id &&
      restoredMetaPngAfterRestart?.metadata?.relativePath ===
        restoredMetaRowAfterRestart.relativePath,
    JSON.stringify(restoredMetaRowAfterRestart),
  );
  const metaApiAfterRestart = await getIdMetadata(restoredMetaItem.id);
  check(
    '重启后 metadata API 仍可用',
    metaApiAfterRestart.status === 200 &&
      metaApiAfterRestart.body?.metadata?.relativePath ===
        restoredMetaRowAfterRestart?.relativePath,
    JSON.stringify(metaApiAfterRestart.body?.metadata),
  );
  const archiveAfterRestart = await fetchMetadataArchive();
  const archiveAfterRestartBuffer = Buffer.from(await archiveAfterRestart.arrayBuffer());
  const archiveAfterRestartNames = new AdmZip(archiveAfterRestartBuffer)
    .getEntries()
    .map((entry) => entry.entryName);
  check(
    '重启后 metadata 归档仍可生成',
    archiveAfterRestart.status === 200 &&
      archiveAfterRestart.headers.get('x-metadata-count') ===
        String(historyAfter.body.items.length) &&
      archiveAfterRestartNames.length === historyAfter.body.items.length + 1 &&
      archiveAfterRestartNames.includes('manifest.json'),
    JSON.stringify({
      count: archiveAfterRestart.headers.get('x-metadata-count'),
      entries: archiveAfterRestartNames.length,
    }),
  );

  const restoreAfterRestart = await restoreTrashItem(trashEntryAfterRestart?.id);
  check(
    '重启后仍可恢复回收站作品',
    restoreAfterRestart.status === 200 &&
      restoreAfterRestart.body?.item?.filename === restartTrashSource.filename &&
      (await historyIds()).includes(restoreAfterRestart.body.item.id),
    JSON.stringify(restoreAfterRestart.body?.item),
  );

  /* Records: one original input -> Tag variants -> multiple images. */
  const recordText = '雨夜少女 · 记录测试';
  const historyBeforeRecord = (await historyIds()).length;
  const recordFirst = await generate(recordText);
  const recordSource = recordFirst.body?.result;
  check(
    '生成记录：原始输入、记录与 Tag 版本被保存',
    recordFirst.status === 200 &&
      recordSource?.userText === recordText &&
      Boolean(recordSource?.recordId) &&
      Boolean(recordSource?.variantId),
    JSON.stringify(recordSource),
  );

  let recordsPayload = await getRecords();
  let recordRow = recordsPayload.body?.records?.find(
    (entry) => entry.id === recordSource?.recordId,
  );
  check(
    '记录列表返回 LLM 标题与原始输入',
    recordsPayload.status === 200 &&
      recordRow?.userText === recordText &&
      recordRow?.title === '雨夜电车月台' &&
      recordRow?.variantCount === 1 &&
      recordRow?.imageCount === 1,
    JSON.stringify(recordRow),
  );
  check(
    '历史图片带有 recordId / variantId / userText',
    recordSource?.recordId === recordRow?.id &&
      recordSource?.variantId === recordRow?.variants?.[0]?.id,
    JSON.stringify({ recordSource, recordRow }),
  );

  const rerollResponse = await enqueueJob({
    kind: 'reroll',
    recordId: recordSource.recordId,
  });
  const rerollDone = await waitForJob(rerollResponse.body?.job?.id);
  recordsPayload = await getRecords();
  recordRow = recordsPayload.body?.records?.find(
    (entry) => entry.id === recordSource.recordId,
  );
  check(
    '重 roll Tags 只新增 Tag 版本，不生图',
    rerollDone.status === 'done' &&
      rerollDone.result?.record?.variantCount === 2 &&
      recordRow?.variantCount === 2 &&
      recordRow?.imageCount === 1,
    JSON.stringify({ rerollDone, recordRow }),
  );

  const secondVariantId = recordRow?.variants?.[1]?.id;
  const renderResponse = await enqueueJob({
    kind: 'render',
    recordId: recordSource.recordId,
    variantId: secondVariantId,
  });
  const renderDone = await waitForJob(renderResponse.body?.job?.id);
  recordsPayload = await getRecords();
  recordRow = recordsPayload.body?.records?.find(
    (entry) => entry.id === recordSource.recordId,
  );
  check(
    '用 Tag 版本生图：图片挂到对应版本',
    renderDone.status === 'done' &&
      renderDone.result?.recordId === recordSource.recordId &&
      renderDone.result?.variantId === secondVariantId &&
      recordRow?.imageCount === 2 &&
      recordRow?.variants?.find((entry) => entry.id === secondVariantId)?.imageCount === 1,
    JSON.stringify({ renderDone, recordRow }),
  );

  const patchVariantResponse = await updateVariant(
    recordSource.recordId,
    secondVariantId,
    { title: '第二个标题', llmTags: '1girl, rain, night' },
  );
  check(
    'Tag 版本标题与提示词可编辑',
    patchVariantResponse.status === 200 &&
      patchVariantResponse.body?.variant?.title === '第二个标题' &&
      patchVariantResponse.body?.variant?.llmTags === '1girl, rain, night',
    JSON.stringify(patchVariantResponse.body),
  );

  const historyBeforeRepeat = (await historyIds()).length;
  const recordRepeat = await generate(recordText);
  const recordsAfterRepeat = await getRecords();
  const recordAfterRepeat = recordsAfterRepeat.body?.records?.find(
    (entry) => entry.id === recordSource.recordId,
  );
  check(
    '重复输入追加到同一条记录，不新增 Tag 版本',
    recordRepeat.status === 200 &&
      (await historyIds()).length === historyBeforeRepeat + 1 &&
      recordAfterRepeat?.variantCount === 2 &&
      recordAfterRepeat?.imageCount === 3 &&
      recordRepeat.body?.result?.variantId === secondVariantId,
    JSON.stringify(recordAfterRepeat),
  );
  check(
    '记录生图返回 HTTP 条目并保持原始输入',
    recordRepeat.body?.result?.userText === recordText,
    JSON.stringify(recordRepeat.body?.result),
  );
  const missingRecord = await request('GET', '/api/records/does-not-exist');
  check(
    '不存在的记录返回 404',
    missingRecord.status === 404 && missingRecord.body?.error?.code === 'RECORD_NOT_FOUND',
  );

  /* 提示词预设：内置 / 保存 / 应用 / 导出 / 导入 */
  const pbCapabilityInfo = await request('GET', '/api/nai/capabilities');
  const pbCapabilityModels = pbCapabilityInfo.body?.models || [];
  const pbV5Capability = pbCapabilityModels.find((item) => item.id === 'nai-diffusion-5-full');
  const pbV5MediumCapability = pbCapabilityModels.find(
    (item) => item.id === 'nai-diffusion-5-full-medium',
  );
  check(
    '能力表返回 V5 与 V5 Medium',
    pbCapabilityInfo.status === 200 &&
      Boolean(pbV5Capability?.transport === 'msgpack-stream') &&
      pbV5MediumCapability?.lockedSteps === 14,
    JSON.stringify(pbCapabilityInfo.body?.models),
  );
  check(
    '能力表返回 uc / quality 预设',
    Object.values(pbCapabilityInfo.body?.ucPresets || {}).some((item) => item.id === 'heavy') &&
      Object.values(pbCapabilityInfo.body?.qualityPresets || {}).some((item) => item.id === 'standard'),
    JSON.stringify({ uc: pbCapabilityInfo.body?.ucPresets?.length }),
  );

  const pbPresetList = await request('GET', '/api/prompt-presets');
  const pbBuiltinPresets = (pbPresetList.body?.presets || []).filter((item) => item.builtin);
  check(
    '内置提示词预设随服务返回',
    pbPresetList.status === 200 &&
      pbBuiltinPresets.length >= 4 &&
      pbBuiltinPresets.every((item) => item.id.startsWith('builtin-')),
    JSON.stringify(pbBuiltinPresets.map((item) => item.id)),
  );

  const pbPresetSaved = await request('POST', '/api/prompt-presets/save', {
    body: {
      preset: {
        name: '测试预设',
        structuredOutput: true,
        blocks: [{ role: 'system', position: 'before', enabled: true, content: '只输出 JSON。' }],
      },
    },
  });
  const pbCustomPreset = pbPresetSaved.body?.preset;
  check(
    '保存提示词预设返回条目',
    pbPresetSaved.status === 200 &&
      Boolean(pbCustomPreset?.id) &&
      pbCustomPreset?.blocks?.[0]?.content === '只输出 JSON。',
    JSON.stringify(pbPresetSaved.body),
  );

  const pbPresetApplied = await request('POST', '/api/prompt-presets/apply', {
    body: { id: pbCustomPreset?.id },
  });
  check(
    '应用预设会替换提示词块并打开结构化输出',
    pbPresetApplied.status === 200 &&
      pbPresetApplied.body?.activeId === pbCustomPreset?.id &&
      pbPresetApplied.body?.config?.llm?.promptBlocks?.[0]?.content === '只输出 JSON。' &&
      pbPresetApplied.body?.config?.llm?.structuredOutput === true,
    JSON.stringify(pbPresetApplied.body?.config?.llm?.structuredOutput),
  );

  const pbPresetExported = await request('GET', '/api/prompt-presets/export', { raw: true });
  let pbExportedDoc = null;
  try {
    pbExportedDoc = JSON.parse(pbPresetExported.text);
  } catch {
    pbExportedDoc = null;
  }
  check(
    '导出预设为可再次导入的 JSON',
    pbPresetExported.status === 200 &&
      pbPresetExported.headers.get('content-disposition')?.includes('attachment') &&
      pbExportedDoc?.kind === 'nai-atelier/prompt-presets' &&
      pbExportedDoc?.presets?.length >= 1,
    String(pbPresetExported.text).slice(0, 120),
  );

  const pbPresetImported = await request('POST', '/api/prompt-presets/import', {
    body: {
      text: JSON.stringify({
        app: 'nai-atelier',
        kind: 'nai-atelier/prompt-presets',
        version: 1,
        presets: [
          {
            name: '测试预设',
            blocks: [{ role: 'system', position: 'before', enabled: true, content: '导入的内容。' }],
          },
        ],
      }),
    },
  });
  check(
    '导入同名预设自动改名而不是覆盖',
    pbPresetImported.status === 200 &&
      pbPresetImported.body?.added === 1 &&
      (pbPresetImported.body?.names || []).some((name) => String(name).includes('(2)')),
    JSON.stringify({ added: pbPresetImported.body?.added, names: pbPresetImported.body?.names }),
  );

  const pbPresetDeleteBuiltin = await request('POST', '/api/prompt-presets/delete', {
    body: { id: pbBuiltinPresets[0]?.id },
  });
  check(
    '内置预设禁止删除',
    pbPresetDeleteBuiltin.status === 400 &&
      pbPresetDeleteBuiltin.body?.error?.code === 'PRESET_BUILTIN',
    JSON.stringify(pbPresetDeleteBuiltin.body),
  );

  const configAfterPreset = await request('GET', '/api/config');
  check(
    '预设与 V5 参数写入配置',
    configAfterPreset.body?.config?.llm?.structuredOutput === true &&
      configAfterPreset.body?.config?.llm?.activePromptPresetId === pbCustomPreset?.id &&
      configAfterPreset.body?.config?.novelai?.ucPresetId === 'heavy' &&
      configAfterPreset.body?.config?.novelai?.qualityPresetId === 'standard' &&
      Array.isArray(configAfterPreset.body?.config?.novelai?.characters),
    JSON.stringify({
      uc: configAfterPreset.body?.config?.novelai?.ucPresetId,
      characters: configAfterPreset.body?.config?.novelai?.characters?.length,
    }),
  );

  const pbDiagnostics = await request('GET', '/api/nai/diagnostics');
  check(
    '诊断记录接口可读',
    pbDiagnostics.status === 200 && Array.isArray(pbDiagnostics.body?.items),
    JSON.stringify(pbDiagnostics.body),
  );

  const pbDiagnosticsCleared = await request('DELETE', '/api/nai/diagnostics');
  check(
    '诊断记录可清空',
    pbDiagnosticsCleared.status === 200 && (pbDiagnosticsCleared.body?.items || []).length === 0,
  );

  /* 结构化提示词：JSON 契约 → 角色提示词 → V5 请求体 */
  await setConfig({ llm: { structuredOutput: true } });
  await setMockMode({ llmMode: 'structured' });
  const structuredRun = await generate('双人雨夜，两个女孩站在便利店门口');
  const structuredHint = mock.llmRequests.at(-1)?.body?.messages?.at(-1)?.content || '';
  check(
    '结构化模式在提示词里追加 JSON 契约',
    structuredHint.includes('"characters"') && structuredHint.includes('归一化坐标'),
    String(structuredHint).slice(-160),
  );
  check(
    '结构化输出拆成场景与角色',
    structuredRun.status === 200 &&
      String(structuredRun.body?.result?.llmTags || '') === '2girls, rain, city_lights, night' &&
      String(mock.naiRequests.at(-1)?.parameters?.negative_prompt || '').includes('lowres'),
    JSON.stringify({
      tags: structuredRun.body?.result?.llmTags,
      negative: mock.naiRequests.at(-1)?.parameters?.negative_prompt,
    }),
  );
  const structuredPayload = mock.naiRequests.at(-1)?.parameters || {};
  const structuredCaptions = structuredPayload?.v4_prompt?.caption?.char_captions || [];
  check(
    '角色同时进入 characterPrompts 与 char_captions',
    Array.isArray(structuredPayload.characterPrompts) &&
      structuredPayload.characterPrompts.length === 2 &&
      structuredCaptions.length === 2 &&
      structuredCaptions[0]?.char_caption === structuredPayload.characterPrompts[0]?.prompt &&
      structuredPayload.use_coords === true,
    JSON.stringify({
      prompts: structuredPayload.characterPrompts?.length,
      captions: structuredCaptions.length,
    }),
  );

  await setMockMode({ llmMode: 'tags' });
  const fallbackRun = await generate('结构化失败时的回退测试');
  check(
    '模型不返回 JSON 时回退为一行 tags',
    fallbackRun.status === 200 &&
      String(fallbackRun.body?.result?.llmTags || '').includes('1girl') &&
      String(fallbackRun.body?.result?.llmTags || '').includes('city_lights'),
    JSON.stringify(fallbackRun.body?.result?.llmTags),
  );
  await setConfig({ llm: { structuredOutput: false } });
}

/* ----------------------------------------------------------------------- */
/* Entry                                                                    */
/* ----------------------------------------------------------------------- */

async function cleanup() {
  await stopApp().catch(() => {});
  if (mock.server) {
    const server = mock.server;
    mock.server = null;
    await new Promise((resolve) => {
      server.close(() => resolve());
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    });
  }
  await fsp.rm(TEMP_ROOT, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}

async function main() {
  try {
    await run();
  } catch (error) {
    failures += 1;
    results.push(`  FAIL 运行过程中出现异常 — ${error?.stack || error}`);
  } finally {
    await cleanup();
  }

  console.log('\n[nai-atelier verify]');
  for (const line of results) console.log(line);
  console.log(`\n${results.length - failures}/${results.length} 项通过`);

  if (failures === 0) {
    console.log('全部通过：本次改动没有破坏配置、生成、拉取模型或重绘流程。');
  } else {
    console.log('存在失败项，请检查上方 FAIL 行。');
  }

  setTimeout(() => process.exit(failures === 0 ? 0 : 1), 150);
}

process.on('SIGINT', () => {
  cleanup().finally(() => process.exit(130));
});

main();
