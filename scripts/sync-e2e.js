'use strict';

/**
 * End-to-end check for device↔device library sync (v1.9.0).
 *
 * Starts two real server instances (separate DATA_DIR / OUTPUTS_DIR / PORT),
 * seeds one of them with a tiny gallery, then drives the whole two-way sync
 * loop over the LAN endpoint. No NovelAI / LLM calls are made.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TEMP_ROOT = path.join(os.tmpdir(), `nai-atelier-sync-${process.pid}-${Date.now()}`);
const TOKEN = 'nai-e2e-token-4f7c9a';

const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition) });
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
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

// 1×1 transparent PNG — enough for the metadata writer and the file mover.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const instances = [];

function makeInstance(name) {
  const base = path.join(TEMP_ROOT, name);
  return {
    name,
    dataDir: path.join(base, 'data'),
    outputsDir: path.join(base, 'outputs'),
    logFile: path.join(base, 'app.log'),
    port: 0,
    syncPort: 0,
    base: '',
    proc: null,
  };
}

async function startInstance(instance) {
  await fsp.mkdir(instance.dataDir, { recursive: true });
  await fsp.mkdir(instance.outputsDir, { recursive: true });
  instance.port = await freePort();
  instance.syncPort = await freePort();
  instance.base = `http://127.0.0.1:${instance.port}`;

  const out = fs.openSync(instance.logFile, 'a');
  instance.proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(instance.port),
      HOST: '127.0.0.1',
      DATA_DIR: instance.dataDir,
      OUTPUTS_DIR: instance.outputsDir,
    },
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  instances.push(instance);

  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${instance.base}/api/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) return;
    } catch {
      /* still booting */
    }
    await sleep(120);
  }
  throw new Error(`${instance.name} 未能启动，日志：${instance.logFile}`);
}

async function stopInstance(instance) {
  if (!instance.proc) return;
  const proc = instance.proc;
  instance.proc = null;
  await new Promise((resolve) => {
    proc.once('exit', resolve);
    proc.kill();
    setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      resolve();
    }, 4000);
  });
}

async function api(instance, method, route, body, headers = {}) {
  const options = {
    method,
    headers: { ...headers },
    signal: AbortSignal.timeout(60_000),
  };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${instance.base}${route}`, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { status: response.status, body: payload, text };
}

async function configureSync(instance) {
  const response = await api(instance, 'POST', '/api/sync/settings', {
    enabled: true,
    port: instance.syncPort,
    token: TOKEN,
    deviceName: instance.name,
  });
  if (response.status !== 200) {
    throw new Error(`同步设置失败（${instance.name}）：${response.text}`);
  }
  await sleep(150);
}

async function runSync(from, to) {
  return api(from, 'POST', '/api/sync/run', {
    peerUrl: `127.0.0.1:${to.syncPort}`,
  });
}

function seededFilename(stamp, suffix) {
  return `nai-${stamp}-${suffix}.png`;
}

async function seedLibrary(instance, entries) {
  const { albums = [], items = [], prompts = [], records = [] } = entries;
  await fsp.mkdir(instance.dataDir, { recursive: true });

  for (const album of albums) {
    await fsp.mkdir(path.join(instance.outputsDir, 'albums', album.id), { recursive: true });
  }
  for (const item of items) {
    const relative = item.albumId ? `albums/${item.albumId}/${item.filename}` : item.filename;
    const absolute = path.join(instance.outputsDir, ...relative.split('/'));
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, PNG_1PX);
  }

  const existingAlbums = JSON.parse(
    await fsp.readFile(path.join(instance.dataDir, 'albums.json'), 'utf8').catch(() => '[]'),
  );
  await fsp.writeFile(
    path.join(instance.dataDir, 'albums.json'),
    JSON.stringify([...existingAlbums, ...albums], null, 2),
  );

  const existingHistory = JSON.parse(
    await fsp.readFile(path.join(instance.dataDir, 'history.json'), 'utf8').catch(() => '[]'),
  );
  await fsp.writeFile(
    path.join(instance.dataDir, 'history.json'),
    JSON.stringify([...items, ...existingHistory], null, 2),
  );

  const existingPrompts = JSON.parse(
    await fsp.readFile(path.join(instance.dataDir, 'prompts.json'), 'utf8').catch(() => '[]'),
  );
  await fsp.writeFile(
    path.join(instance.dataDir, 'prompts.json'),
    JSON.stringify([...existingPrompts, ...prompts], null, 2),
  );

  if (records.length > 0) {
    const existingRecords = JSON.parse(
      await fsp.readFile(path.join(instance.dataDir, 'records.json'), 'utf8').catch(() => '[]'),
    );
    await fsp.writeFile(
      path.join(instance.dataDir, 'records.json'),
      JSON.stringify([...existingRecords, ...records], null, 2),
    );
  }
}

async function listPhotos(instance) {
  const response = await api(instance, 'GET', '/api/history');
  return response.body?.items || [];
}

async function listTrash(instance) {
  const response = await api(instance, 'GET', '/api/trash');
  return response.body?.items || [];
}

async function listAlbums(instance) {
  const response = await api(instance, 'GET', '/api/albums');
  return response.body?.albums || [];
}

async function listPrompts(instance) {
  const response = await api(instance, 'GET', '/api/prompts');
  return response.body?.prompts || [];
}

async function listRecords(instance) {
  const response = await api(instance, 'GET', '/api/records');
  return response.body?.records || [];
}

async function fileOf(instance, relativePath) {
  return path.join(instance.outputsDir, ...relativePath.split('/'));
}

async function run() {
  await fsp.mkdir(TEMP_ROOT, { recursive: true });

  const phone = makeInstance('phone');
  const desktop = makeInstance('desktop');

  const albumId = 'album-trip01';
  const older = {
    id: 'hist-0000-0000-0000-000000000001',
    filename: seededFilename('20260101-090000', 'aaaaaa'),
    relativePath: `albums/${albumId}/${seededFilename('20260101-090000', 'aaaaaa')}`,
    albumId,
    userText: '雨夜的车站',
    prompt: '1girl, rain, station, cinematic lighting',
    llmTags: '1girl, rain, station',
    width: 832,
    height: 1216,
    seed: 111,
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: '2026-01-01T09:00:00.000Z',
  };
  const promptRow = {
    id: 'prompt-0000-0000-0000-000000000001',
    name: '雨夜氛围',
    positive: 'rain, wet street, neon',
    negative: 'lowres',
    createdAt: '2026-01-01T09:10:00.000Z',
    updatedAt: '2026-01-01T09:10:00.000Z',
  };
  const recordRow = {
    id: 'record-0000-0000-0000-000000000001',
    title: '雨夜车站',
    userText: '雨夜的车站',
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: '2026-01-01T09:00:00.000Z',
    variants: [
      {
        id: 'variant-0000-0000-0000-00000000001',
        title: 'v1',
        llmTags: '1girl, rain, station',
        source: 'llm',
        llmModel: 'mock',
        createdAt: '2026-01-01T09:00:00.000Z',
        updatedAt: '2026-01-01T09:00:00.000Z',
      },
    ],
  };

  await seedLibrary(phone, {
    albums: [{ id: albumId, name: '旅行', createdAt: '2026-01-01T08:00:00.000Z' }],
    items: [older],
    prompts: [promptRow],
    records: [recordRow],
  });

  await startInstance(phone);
  await startInstance(desktop);
  await configureSync(phone);
  await configureSync(desktop);

  /* 1. phone -> desktop:作品、画册、提示词、记录一次性过去 */
  const firstRun = await runSync(desktop, phone);
  check('桌面端发起同步返回 200', firstRun.status === 200, firstRun.text.slice(0, 300));

  const phoneAfter = await listPhotos(phone);
  const desktopAfter = await listPhotos(desktop);
  const desktopAlbums = await listAlbums(desktop);
  const desktopPrompts = await listPrompts(desktop);
  const desktopRecords = await listRecords(desktop);

  check('手机端作品没有丢', phoneAfter.length === 1);
  check('桌面端收到作品', desktopAfter.length === 1, JSON.stringify(desktopAfter.map((i) => i.filename)));
  check('桌面端收到画册', desktopAlbums.length === 1 && desktopAlbums[0].name === '旅行');
  check('桌面端收到提示词', desktopPrompts.length === 1 && desktopPrompts[0].name === '雨夜氛围');
  const desktopSeededRecord = desktopRecords.find(
    (entry) => entry.id === recordRow.id,
  );
  check(
    '桌面端收到创作记录',
    Boolean(desktopSeededRecord) && desktopSeededRecord.variants.length === 1,
    JSON.stringify(desktopRecords.map((entry) => entry.id)),
  );

  const desktopRelative = desktopAfter[0]?.relativePath || '';
  check(
    '桌面端文件落在画册目录里',
    desktopRelative === `albums/${albumId}/${older.filename}`,
    desktopRelative,
  );

  const desktopBytes = await fsp
    .readFile(await fileOf(desktop, desktopRelative))
    .catch(() => null);
  check('桌面端图片文件真实存在且内容一致', Boolean(desktopBytes) && desktopBytes.length > 0);

  check(
    '首次同步统计包含接收文件',
    Number(firstRun.body?.result?.downloaded) >= 1,
    JSON.stringify(firstRun.body?.result),
  );

  const desktopIncoming = path.join(desktop.outputsDir, '.incoming');
  const incomingEntries = await fsp.readdir(desktopIncoming).catch(() => []);
  check('同步结束后 .incoming 已清空', incomingEntries.length === 0, incomingEntries.join(','));

  const backups = await fsp.readdir(path.join(desktop.dataDir, 'backups')).catch(() => []);
  check('同步前生成了索引备份', backups.length >= 1, backups.join(','));

  /* 2. 重复同步是幂等的 */
  const secondRun = await runSync(desktop, phone);
  check(
    '重复同步不再搬运文件',
    secondRun.status === 200 &&
      Number(secondRun.body?.result?.downloaded) === 0 &&
      Number(secondRun.body?.result?.uploaded) === 0,
    JSON.stringify(secondRun.body?.result),
  );

  /* 3. 桌面端新作品 + 排序 -> 手机端 */
  await stopInstance(desktop);
  const newer = {
    id: 'hist-0000-0000-0000-000000000002',
    filename: seededFilename('20260202-180000', 'bbbbbb'),
    relativePath: seededFilename('20260202-180000', 'bbbbbb'),
    albumId: null,
    userText: '海边的黄昏',
    prompt: '1girl, sunset, beach',
    llmTags: '1girl, sunset, beach',
    width: 832,
    height: 1216,
    seed: 222,
    createdAt: '2026-02-02T18:00:00.000Z',
    updatedAt: '2026-02-02T18:00:00.000Z',
  };
  await seedLibrary(desktop, { items: [newer] });
  await startInstance(desktop);
  await configureSync(desktop);

  const desktopOrder = await api(desktop, 'POST', '/api/history/order', {
    ids: [newer.id, older.id],
  });
  check('桌面端调整排序成功', desktopOrder.status === 200, desktopOrder.text.slice(0, 200));

  const backRun = await runSync(phone, desktop);
  check('手机端发起反向同步返回 200', backRun.status === 200, backRun.text.slice(0, 300));

  const phoneItems = await listPhotos(phone);
  check(
    '手机端收到桌面端新作品',
    phoneItems.some((item) => item.id === newer.id),
    JSON.stringify(phoneItems.map((item) => item.id)),
  );
  check(
    '手机端排序跟随桌面端',
    phoneItems[0]?.id === newer.id,
    JSON.stringify(phoneItems.map((item) => item.id)),
  );
  check(
    '新作品文件也到了手机端',
    fs.existsSync(await fileOf(phone, newer.relativePath)),
  );

  /* 4. 移入回收站 -> 同步 -> 恢复 */
  const trashTarget = phoneItems.find((item) => item.id === newer.id);
  const trashed = await api(phone, 'DELETE', `/api/history/${encodeURIComponent(trashTarget.id)}`);
  check('手机端移入回收站成功', trashed.status === 200 && trashed.body?.trashed === true, trashed.text.slice(0, 200));

  const trashBack = await runSync(phone, desktop);
  check('移入回收站后同步返回 200', trashBack.status === 200, trashBack.text.slice(0, 300));
  const desktopPhotos = await listPhotos(desktop);
  const desktopTrash = await listTrash(desktop);
  check(
    '桌面端也看不到这张图了',
    !desktopPhotos.some((item) => item.id === newer.id),
    JSON.stringify(desktopPhotos.map((item) => item.id)),
  );
  check(
    '桌面端回收站里出现了它',
    desktopTrash.some((entry) => entry.filename === newer.filename),
    JSON.stringify(desktopTrash.map((entry) => entry.filename)),
  );

  const desktopTrashEntry = desktopTrash.find((entry) => entry.filename === newer.filename);
  const restored = await api(
    desktop,
    'POST',
    `/api/trash/${encodeURIComponent(desktopTrashEntry.id)}/restore`,
    {},
  );
  check('桌面端恢复成功', restored.status === 200, restored.text.slice(0, 200));

  const restoreBack = await runSync(desktop, phone);
  check('恢复后再次同步返回 200', restoreBack.status === 200, restoreBack.text.slice(0, 300));
  const phoneRestored = await listPhotos(phone);
  check(
    '手机端也跟着恢复了',
    phoneRestored.some((item) => item.id === newer.id),
    JSON.stringify(phoneRestored.map((item) => item.id)),
  );

  /* 5. 彻底删除 -> 两端都删掉文件和索引 */
  const removed = await api(
    desktop,
    'DELETE',
    `/api/history/${encodeURIComponent(newer.id)}?permanent=1`,
  );
  check('桌面端彻底删除成功', removed.status === 200 && removed.body?.trashed === false, removed.text.slice(0, 200));

  const deleteBack = await runSync(phone, desktop);
  check('彻底删除后同步返回 200', deleteBack.status === 200, deleteBack.text.slice(0, 300));
  const phoneFinal = await listPhotos(phone);
  check(
    '手机端索引也删除了这条',
    !phoneFinal.some((item) => item.id === newer.id),
    JSON.stringify(phoneFinal.map((item) => item.id)),
  );
  check(
    '手机端图片文件也删除了',
    !fs.existsSync(await fileOf(phone, newer.relativePath)),
    newer.relativePath,
  );

  /* 6. 口令错误 -> 401 */
  const wrongToken = await api(desktop, 'POST', '/api/sync/settings', {
    token: 'nai-wrong-token-zzzz',
  });
  check('可以修改口令', wrongToken.status === 200);
  const unauthorized = await runSync(desktop, phone);
  check(
    '口令不一致时给出明确错误',
    unauthorized.status === 401 && /口令/.test(unauthorized.body?.error?.message || ''),
    JSON.stringify(unauthorized.body),
  );
  await api(desktop, 'POST', '/api/sync/settings', { token: TOKEN });

  /* 7. 对方离线 -> 可读错误 */
  await stopInstance(phone);
  const offline = await runSync(desktop, phone);
  check(
    '对方离线时给出可读错误',
    offline.status === 502 && /连不上/.test(offline.body?.error?.message || ''),
    JSON.stringify(offline.body),
  );

  /* 8. 手机端重启后仍保留同步设置（含口令与上次地址） */
  await startInstance(phone);
  const phoneStatus = await api(phone, 'GET', '/api/sync/status');
  check(
    '重启后同步设置仍在',
    phoneStatus.body?.status?.token === TOKEN && phoneStatus.body?.status?.enabled === true,
    JSON.stringify(phoneStatus.body?.status),
  );
}

async function cleanup() {
  for (const instance of instances) {
    await stopInstance(instance);
  }
  if (failures === 0) {
    await fsp.rm(TEMP_ROOT, { recursive: true, force: true }).catch(() => {});
  } else {
    console.log(`\n  保留现场以便排查：${TEMP_ROOT}`);
  }
}

run()
  .catch((error) => {
    failures += 1;
    console.error('\n[sync-e2e] 运行失败：', error);
  })
  .finally(async () => {
    await cleanup();
    const total = results.length;
    console.log(`\n${total - failures}/${total} 项通过`);
    process.exitCode = failures === 0 ? 0 : 1;
  });
