'use strict';

/**
 * 同步合并逻辑的自检脚本（不启动服务、不读写数据目录）。
 * 运行：npm run test:sync
 */

const assert = require('node:assert/strict');
const { mergeSnapshots } = require('../lib/sync-merge');

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

function snapshot(overrides) {
  return {
    version: 1,
    deviceId: 'device-a',
    generatedAt: '2026-01-01T00:00:00.000Z',
    history: [],
    trash: [],
    albums: [],
    records: [],
    prompts: [],
    files: [],
    state: {
      orderUpdatedAt: '2026-01-01T00:00:00.000Z',
      historyTombstones: {},
      albumTombstones: {},
      promptTombstones: {},
    },
    ...overrides,
  };
}

function image(id, createdAt, extra) {
  return {
    id,
    filename: `${id}.png`,
    relativePath: `${id}.png`,
    url: `/outputs/${id}.png`,
    albumId: null,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  };
}

function trashRecord(id, itemId, deletedAt) {
  return {
    id,
    itemId,
    filename: `${itemId}.png`,
    trashFilename: `${itemId}-trash.png`,
    item: image(itemId, '2026-01-01T00:00:00.000Z'),
    deletedAt,
  };
}

function strip(result) {
  const copy = JSON.parse(JSON.stringify(result.snapshot));
  delete copy.generatedAt;
  delete copy.deviceId;
  return copy;
}

/* 1. 两端各自新增，合并后都在，文件各自需要一份 */
check('两端各自新增作品，合并后取并集并互相传文件', () => {
  const a = snapshot({
    history: [image('a1', '2026-01-02T00:00:00.000Z')],
    files: [{ kind: 'image', id: 'a1', filename: 'a1.png', size: 3, sha256: 'aaa' }],
  });
  const b = snapshot({
    deviceId: 'device-b',
    history: [image('b1', '2026-01-03T00:00:00.000Z')],
    files: [{ kind: 'image', id: 'b1', filename: 'b1.png', size: 4, sha256: 'bbb' }],
  });
  const result = mergeSnapshots(a, b);
  assert.deepEqual(result.snapshot.history.map((item) => item.id), ['b1', 'a1']);
  assert.deepEqual(result.download.map((file) => file.id), ['b1']);
  assert.deepEqual(result.upload.map((file) => file.id), ['a1']);
  assert.equal(result.stats.addedImages, 1);
});

/* 2. 删除时间较新的回收站记录胜过较旧的 live */
check('较新的回收站记录胜过较旧的 live 条目', () => {
  const a = snapshot({ history: [image('x', '2026-01-01T00:00:00.000Z')] });
  const b = snapshot({
    deviceId: 'device-b',
    trash: [trashRecord('trash-1', 'x', '2026-01-05T00:00:00.000Z')],
  });
  const result = mergeSnapshots(a, b);
  assert.equal(result.snapshot.history.length, 0);
  assert.equal(result.snapshot.trash.length, 1);
  assert.equal(result.snapshot.trash[0].itemId, 'x');
  assert.equal(result.stats.trashedImages, 1);
});

/* 3. 回收站恢复（live 更新）胜过回收站记录 */
check('较新的 live 条目胜过较旧的回收站记录（恢复）', () => {
  const a = snapshot({ trash: [trashRecord('trash-1', 'x', '2026-01-02T00:00:00.000Z')] });
  const b = snapshot({
    deviceId: 'device-b',
    history: [image('x', '2026-01-01T00:00:00.000Z', { updatedAt: '2026-01-05T00:00:00.000Z' })],
  });
  const result = mergeSnapshots(a, b);
  assert.equal(result.snapshot.trash.length, 0);
  assert.equal(result.snapshot.history.length, 1);
  assert.equal(result.stats.restoredImages, 1);
});

/* 4. 彻底删除的 tombstone 让对端也删掉 */
check('tombstone 让对端删掉更旧的副本', () => {
  const a = snapshot({
    history: [image('y', '2026-01-01T00:00:00.000Z')],
    state: {
      orderUpdatedAt: '2026-01-01T00:00:00.000Z',
      historyTombstones: { y: '2026-01-06T00:00:00.000Z' },
      albumTombstones: {},
      promptTombstones: {},
    },
  });
  const b = snapshot({
    deviceId: 'device-b',
    history: [image('y', '2026-01-01T00:00:00.000Z')],
  });
  const result = mergeSnapshots(a, b);
  assert.equal(result.snapshot.history.length, 0);
  assert.equal(result.snapshot.state.historyTombstones.y, '2026-01-06T00:00:00.000Z');
});

/* 5. 排序：orderUpdatedAt 新的一端决定顺序，另一端新作品插到最前 */
check('排序由 orderUpdatedAt 新的一端决定，独有新作品插到最前', () => {
  const a = snapshot({
    history: [
      image('a1', '2026-01-02T00:00:00.000Z'),
      image('a2', '2026-01-03T00:00:00.000Z'),
    ],
    state: {
      orderUpdatedAt: '2026-01-04T00:00:00.000Z',
      historyTombstones: {},
      albumTombstones: {},
      promptTombstones: {},
    },
  });
  const b = snapshot({
    deviceId: 'device-b',
    history: [
      image('b1', '2026-01-05T00:00:00.000Z'),
      image('a2', '2026-01-03T00:00:00.000Z'),
      image('a1', '2026-01-02T00:00:00.000Z'),
    ],
    state: {
      orderUpdatedAt: '2026-01-10T00:00:00.000Z',
      historyTombstones: {},
      albumTombstones: {},
      promptTombstones: {},
    },
  });
  const result = mergeSnapshots(a, b);
  assert.deepEqual(result.snapshot.history.map((item) => item.id), ['b1', 'a2', 'a1']);
  assert.equal(result.snapshot.state.orderUpdatedAt, '2026-01-10T00:00:00.000Z');
  assert.equal(result.stats.orderChanged, true);
});

/* 6. 合并结果与方向无关 */
check('merge(A,B) 与 merge(B,A) 结果一致', () => {
  const a = snapshot({
    history: [
      image('a1', '2026-01-02T00:00:00.000Z'),
      image('shared', '2026-01-04T00:00:00.000Z'),
    ],
    trash: [trashRecord('t-a', 'z1', '2026-01-06T00:00:00.000Z')],
    albums: [{ id: 'alb-1', name: 'A 画册', createdAt: '2026-01-01T00:00:00.000Z' }],
    prompts: [{ id: 'p-1', name: '提示词一', positive: 'x', negative: '', createdAt: '2026-01-01T00:00:00.000Z' }],
    records: [
      {
        id: 'rec-1',
        title: '记录',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        variants: [{ id: 'v-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' }],
      },
    ],
    state: {
      orderUpdatedAt: '2026-01-05T00:00:00.000Z',
      historyTombstones: { gone: '2026-01-07T00:00:00.000Z' },
      albumTombstones: {},
      promptTombstones: {},
    },
  });
  const b = snapshot({
    deviceId: 'device-b',
    history: [
      image('b1', '2026-01-03T00:00:00.000Z'),
      image('shared', '2026-01-04T00:00:00.000Z'),
    ],
    albums: [{ id: 'alb-2', name: 'B 画册', createdAt: '2026-01-02T00:00:00.000Z' }],
    prompts: [{ id: 'p-2', name: '提示词二', positive: 'y', negative: '', createdAt: '2026-01-03T00:00:00.000Z' }],
    records: [
      {
        id: 'rec-1',
        title: '记录',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        variants: [{ id: 'v-2', createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z' }],
      },
    ],
    state: {
      orderUpdatedAt: '2026-01-06T00:00:00.000Z',
      historyTombstones: {},
      albumTombstones: { 'alb-gone': '2026-01-08T00:00:00.000Z' },
      promptTombstones: { 'p-gone': '2026-01-08T00:00:00.000Z' },
    },
  });
  const forward = strip(mergeSnapshots(a, b));
  const backward = strip(mergeSnapshots(b, a));
  assert.deepEqual(forward, backward);
});

/* 7. 同一时刻的冲突用内容哈希决定，两端一致 */
check('同一时刻的冲突由内容哈希决定，两端结果相同', () => {
  const base = { orderUpdatedAt: '2026-01-01T00:00:00.000Z', historyTombstones: {}, albumTombstones: {}, promptTombstones: {} };
  const a = snapshot({ history: [image('dup', '2026-01-02T00:00:00.000Z', { prompt: '版本 A' })], state: base });
  const b = snapshot({ deviceId: 'device-b', history: [image('dup', '2026-01-02T00:00:00.000Z', { prompt: '版本 B' })], state: base });
  const one = mergeSnapshots(a, b).snapshot.history[0].prompt;
  const two = mergeSnapshots(b, a).snapshot.history[0].prompt;
  assert.equal(one, two);
});

/* 8. 记录变体取并集 */
check('记录的不同版本取并集', () => {
  const a = snapshot({
    records: [
      {
        id: 'rec',
        title: '记录',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        variants: [{ id: 'v1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
      },
    ],
  });
  const b = snapshot({
    deviceId: 'device-b',
    records: [
      {
        id: 'rec',
        title: '记录',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        variants: [{ id: 'v2', createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z' }],
      },
    ],
  });
  const result = mergeSnapshots(a, b);
  assert.equal(result.snapshot.records.length, 1);
  assert.deepEqual(result.snapshot.records[0].variants.map((variant) => variant.id), ['v1', 'v2']);
});

/* 9. 提示词删除在两端生效 */
check('提示词 tombstone 让对端删掉提示词', () => {
  const prompt = { id: 'p', name: '提示词', positive: 'x', negative: '', createdAt: '2026-01-01T00:00:00.000Z' };
  const a = snapshot({
    prompts: [prompt],
    state: {
      orderUpdatedAt: '2026-01-01T00:00:00.000Z',
      historyTombstones: {},
      albumTombstones: {},
      promptTombstones: { p: '2026-01-09T00:00:00.000Z' },
    },
  });
  const b = snapshot({ deviceId: 'device-b', prompts: [prompt] });
  const result = mergeSnapshots(a, b);
  assert.equal(result.snapshot.prompts.length, 0);
  assert.equal(result.snapshot.state.promptTombstones.p, '2026-01-09T00:00:00.000Z');
});

/* 10. 缺失文件给出警告而不是静默丢条目 */
check('两端都缺文件时给出警告', () => {
  const a = snapshot({ history: [image('nofile', '2026-01-02T00:00:00.000Z')] });
  const b = snapshot({ deviceId: 'device-b' });
  const result = mergeSnapshots(a, b);
  assert.equal(result.snapshot.history.length, 1);
  assert.ok(result.warnings.length >= 1);
  assert.ok(result.warnings[0].includes('nofile.png'));
});

console.log(`\n${passed}/${passed + failed} 项通过`);
if (failed > 0) process.exitCode = 1;
