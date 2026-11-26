'use strict';

/**
 * NAI Atelier — 库同步的纯合并逻辑。
 *
 * 这个模块不接触文件系统、网络和 Express：输入两端各自的“快照”（纯 JSON），
 * 输出合并后的快照、需要互相传输的文件清单和统计信息。server.js 负责把快照
 * 读出来、把文件搬到位、把 JSON 写回去；这里只决定“谁赢”。
 *
 * 冲突规则（简单、可解释、两端执行结果一致）：
 *   - 每个实体以 id 为身份；作品/画册/提示词有 live / trashed / deleted 三种状态。
 *   - 状态时间内嵌在实体里：live 用 updatedAt，回收站用 deletedAt，彻底删除用
 *     tombstone 的时间。时间新者胜；同一时刻按 deleted > trashed > live 排，
 *     再按内容哈希决出唯一结果，保证两端算出同一份合并结果。
 *   - 作品排序整体作为一次操作：orderUpdatedAt 新的一端决定顺序，另一端只把
 *     自己新生成的作品插到最前面。
 *   - 记录、Tag 版本、画册、提示词都只增不丢（除非显式删除），字段按 updatedAt 合并。
 *   - 图片文件按 id 识别；同 id 的图片内容不可变，只要一端有就传过去。
 */

const crypto = require('node:crypto');

const SNAPSHOT_VERSION = 1;
const STATE_RANK = { live: 1, trashed: 2, deleted: 3 };

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    out[key] = canonicalize(value[key]);
  }
  return out;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function revisionHash(value) {
  return sha256Hex(Buffer.from(canonicalJson(value), 'utf8')).slice(0, 16);
}

function toMs(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function isoOrEmpty(value) {
  const time = toMs(value);
  return time > 0 ? new Date(time).toISOString() : '';
}

function compareStrings(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Compare two versions of the same entity. Timestamp wins, then state rank,
 * then the content hash. The hash step is what makes a tie deterministic on
 * both devices instead of letting each side keep its own copy.
 */
function compareVersion(a, b) {
  const ta = toMs(a.ts);
  const tb = toMs(b.ts);
  if (ta !== tb) return ta < tb ? -1 : 1;
  const ra = STATE_RANK[a.state] || 0;
  const rb = STATE_RANK[b.state] || 0;
  if (ra !== rb) return ra < rb ? -1 : 1;
  return compareStrings(a.hash || '', b.hash || '');
}

function pickWinner(candidates) {
  let best = null;
  for (const candidate of candidates) {
    if (!best || compareVersion(candidate, best) > 0) best = candidate;
  }
  return best;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

/* ------------------------------------------------------------------ */
/* Snapshot indexing                                                   */
/* ------------------------------------------------------------------ */

function timelineOf(snapshot) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const live = new Map();
  const trash = new Map();
  const tombstones = new Map();

  for (const item of asArray(source.history)) {
    if (!item || typeof item.id !== 'string' || !item.id) continue;
    live.set(item.id, item);
  }
  for (const record of asArray(source.trash)) {
    if (!record || typeof record !== 'object') continue;
    const id = safeString(record.itemId) || safeString(record.item && record.item.id);
    if (!id) continue;
    trash.set(id, record);
  }

  const state = source.state && typeof source.state === 'object' ? source.state : {};
  for (const kind of ['historyTombstones', 'albumTombstones', 'promptTombstones']) {
    const table = state[kind];
    if (!table || typeof table !== 'object') continue;
    for (const [id, ts] of Object.entries(table)) {
      if (!id || !toMs(ts)) continue;
      tombstones.set(id, ts);
    }
  }
  return { live, trash, tombstones };
}

function indexFiles(files) {
  const map = new Map();
  for (const entry of asArray(files)) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) continue;
    const kind = entry.kind === 'trash' ? 'trash' : 'image';
    map.set(`${kind}:${entry.id}`, entry);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Entity merges                                                       */
/* ------------------------------------------------------------------ */

function mergeHistory(local, remote, warnings) {
  const localIndex = timelineOf(local);
  const remoteIndex = timelineOf(remote);
  const ids = new Set([
    ...localIndex.live.keys(),
    ...localIndex.trash.keys(),
    ...localIndex.tombstones.keys(),
    ...remoteIndex.live.keys(),
    ...remoteIndex.trash.keys(),
    ...remoteIndex.tombstones.keys(),
  ]);

  const winners = new Map();
  for (const id of ids) {
    const candidates = [];
    const localLive = localIndex.live.get(id);
    const remoteLive = remoteIndex.live.get(id);
    const localTrash = localIndex.trash.get(id);
    const remoteTrash = remoteIndex.trash.get(id);
    const localGone = localIndex.tombstones.get(id);
    const remoteGone = remoteIndex.tombstones.get(id);

    if (localLive) {
      candidates.push({
        state: 'live',
        ts: localLive.updatedAt || localLive.createdAt,
        hash: revisionHash(localLive),
        item: localLive,
      });
    }
    if (remoteLive) {
      candidates.push({
        state: 'live',
        ts: remoteLive.updatedAt || remoteLive.createdAt,
        hash: revisionHash(remoteLive),
        item: remoteLive,
      });
    }
    if (localTrash) {
      candidates.push({
        state: 'trashed',
        ts: localTrash.deletedAt,
        hash: revisionHash(localTrash),
        record: localTrash,
      });
    }
    if (remoteTrash) {
      candidates.push({
        state: 'trashed',
        ts: remoteTrash.deletedAt,
        hash: revisionHash(remoteTrash),
        record: remoteTrash,
      });
    }
    if (localGone) candidates.push({ state: 'deleted', ts: localGone, hash: '' });
    if (remoteGone) candidates.push({ state: 'deleted', ts: remoteGone, hash: '' });

    const winner = pickWinner(candidates);
    if (!winner) continue;
    if (winner.state === 'live') {
      if (!winner.item.id) winner.item.id = id;
      winners.set(id, { kind: 'live', value: winner.item });
    } else if (winner.state === 'trashed') {
      const record = winner.record;
      if (!record.itemId) record.itemId = id;
      if (!record.item) warnings.push(`回收站记录 ${id} 缺少作品信息，已跳过。`);
      else winners.set(id, { kind: 'trash', value: record });
    }
    // 'deleted' has no entity to keep; it is recorded as a tombstone below.
  }

  /* Order: the side with the newer orderUpdatedAt is the base. Ties are broken
     by device id so that both devices choose the same base. */
  const localOrderTs = toMs(local.state && local.state.orderUpdatedAt);
  const remoteOrderTs = toMs(remote.state && remote.state.orderUpdatedAt);
  const localDevice = safeString(local.deviceId);
  const remoteDevice = safeString(remote.deviceId);
  const useRemoteBase =
    remoteOrderTs > localOrderTs ||
    (remoteOrderTs === localOrderTs && compareStrings(remoteDevice, localDevice) > 0);

  const baseItems = asArray(useRemoteBase ? remote.history : local.history);
  const otherItems = asArray(useRemoteBase ? local.history : remote.history);
  const liveIds = new Set();
  for (const [id, entry] of winners) {
    if (entry.kind === 'live' && entry.value && entry.value.filename) liveIds.add(id);
  }

  const finish = () => {
    const trash = [];
    for (const entry of winners.values()) {
      if (entry.kind === 'trash' && entry.value && entry.value.item) trash.push(entry.value);
    }
    trash.sort((a, b) => {
      const diff = toMs(b.deletedAt) - toMs(a.deletedAt);
      if (diff !== 0) return diff;
      return compareStrings(safeString(b.itemId), safeString(a.itemId));
    });

    const tombstones = {};
    for (const id of ids) {
      if (winners.has(id)) continue;
      const localGone = localIndex.tombstones.get(id);
      const remoteGone = remoteIndex.tombstones.get(id);
      if (!localGone && !remoteGone) continue;
      const candidates = [];
      if (localGone) candidates.push({ state: 'deleted', ts: localGone, hash: '' });
      if (remoteGone) candidates.push({ state: 'deleted', ts: remoteGone, hash: '' });
      const best = pickWinner(candidates);
      if (best && toMs(best.ts) > 0) tombstones[id] = isoOrEmpty(best.ts);
    }
    return { ordered, trash, tombstones };
  };

  const ordered = [];
  const seen = new Set();
  const explicitOrder = localOrderTs > 0 || remoteOrderTs > 0;
  if (!explicitOrder) {
    /* Nobody has reordered yet, so creation time is the natural order. */
    const byCreated = [...liveIds].sort((one, two) => {
      const diff = toMs(winners.get(two).value.createdAt) - toMs(winners.get(one).value.createdAt);
      if (diff !== 0) return diff;
      return compareStrings(one, two);
    });
    for (const id of byCreated) ordered.push(winners.get(id).value);
    return finish();
  }

  const baseIds = new Set(baseItems.map((item) => item && item.id).filter(Boolean));
  /* Items that only exist on the non-base side were created while the devices
     were apart; they are inserted by creation time below. */
  const foreign = otherItems
    .filter((item) => item && item.id && liveIds.has(item.id) && !baseIds.has(item.id))
    .map((item) => winners.get(item.id).value)
    .sort((one, two) => {
      const diff = toMs(two.createdAt) - toMs(one.createdAt);
      if (diff !== 0) return diff;
      return compareStrings(one.id, two.id);
    });
  const foreignIds = new Set(foreign.map((value) => value.id));

  for (const item of baseItems) {
    const id = item && item.id;
    if (!id || !liveIds.has(id) || seen.has(id)) continue;
    ordered.push(winners.get(id).value);
    seen.add(id);
  }
  for (const id of liveIds) {
    if (seen.has(id) || foreignIds.has(id)) continue;
    ordered.push(winners.get(id).value);
    seen.add(id);
  }

  for (const value of foreign) {
    let index = ordered.findIndex((entry) => toMs(entry.createdAt) < toMs(value.createdAt));
    if (index < 0) index = ordered.length;
    ordered.splice(index, 0, value);
  }

  return finish();
}

function mergeAlbums(local, remote) {
  const source = (snapshot) => {
    const map = new Map();
    for (const album of asArray(snapshot.albums)) {
      if (album && typeof album.id === 'string' && album.id) map.set(album.id, album);
    }
    const gone = new Map();
    const table = snapshot.state && snapshot.state.albumTombstones;
    if (table && typeof table === 'object') {
      for (const [id, ts] of Object.entries(table)) if (id && toMs(ts)) gone.set(id, ts);
    }
    return { map, gone };
  };
  const a = source(local);
  const b = source(remote);
  const ids = new Set([...a.map.keys(), ...b.map.keys(), ...a.gone.keys(), ...b.gone.keys()]);

  const albums = [];
  const tombstones = {};
  for (const id of ids) {
    const candidates = [];
    const localAlbum = a.map.get(id);
    const remoteAlbum = b.map.get(id);
    if (localAlbum) {
      candidates.push({
        state: 'live',
        ts: localAlbum.updatedAt || localAlbum.createdAt,
        hash: revisionHash(localAlbum),
        album: localAlbum,
      });
    }
    if (remoteAlbum) {
      candidates.push({
        state: 'live',
        ts: remoteAlbum.updatedAt || remoteAlbum.createdAt,
        hash: revisionHash(remoteAlbum),
        album: remoteAlbum,
      });
    }
    if (a.gone.has(id)) candidates.push({ state: 'deleted', ts: a.gone.get(id), hash: '' });
    if (b.gone.has(id)) candidates.push({ state: 'deleted', ts: b.gone.get(id), hash: '' });
    const winner = pickWinner(candidates);
    if (!winner) continue;
    if (winner.state === 'deleted') {
      tombstones[id] = isoOrEmpty(winner.ts);
      continue;
    }
    if (winner.album && winner.album.name) albums.push(winner.album);
  }

  albums.sort((one, two) => {
    const diff = toMs(one.createdAt) - toMs(two.createdAt);
    if (diff !== 0) return diff;
    return compareStrings(one.id, two.id);
  });

  return { albums, tombstones };
}

function mergePrompts(local, remote) {
  const source = (snapshot) => {
    const map = new Map();
    for (const prompt of asArray(snapshot.prompts)) {
      if (prompt && typeof prompt.id === 'string' && prompt.id) map.set(prompt.id, prompt);
    }
    const gone = new Map();
    const table = snapshot.state && snapshot.state.promptTombstones;
    if (table && typeof table === 'object') {
      for (const [id, ts] of Object.entries(table)) if (id && toMs(ts)) gone.set(id, ts);
    }
    return { map, gone };
  };
  const a = source(local);
  const b = source(remote);
  const ids = new Set([...a.map.keys(), ...b.map.keys(), ...a.gone.keys(), ...b.gone.keys()]);

  const prompts = [];
  const tombstones = {};
  for (const id of ids) {
    const candidates = [];
    for (const prompt of [a.map.get(id), b.map.get(id)]) {
      if (!prompt) continue;
      candidates.push({
        state: 'live',
        ts: prompt.updatedAt || prompt.createdAt,
        hash: revisionHash(prompt),
        prompt,
      });
    }
    const goneA = a.gone.get(id);
    const goneB = b.gone.get(id);
    if (goneA) candidates.push({ state: 'deleted', ts: goneA, hash: '' });
    if (goneB) candidates.push({ state: 'deleted', ts: goneB, hash: '' });
    const winner = pickWinner(candidates);
    if (!winner) continue;
    if (winner.state === 'deleted') {
      tombstones[id] = isoOrEmpty(winner.ts);
      continue;
    }
    if (winner.prompt && winner.prompt.name) prompts.push(winner.prompt);
  }

  prompts.sort((one, two) => {
    const diff = toMs(two.createdAt) - toMs(one.createdAt);
    if (diff !== 0) return diff;
    return compareStrings(one.id, two.id);
  });

  return { prompts, tombstones };
}

function mergeVariants(localVariants, remoteVariants) {
  const map = new Map();
  for (const variant of asArray(localVariants)) {
    if (variant && variant.id) map.set(variant.id, variant);
  }
  const merged = [];
  const seen = new Set();
  for (const variant of asArray(localVariants)) {
    if (!variant || !variant.id || seen.has(variant.id)) continue;
    const other = asArray(remoteVariants).find((entry) => entry && entry.id === variant.id);
    merged.push(pickNewerVariant(variant, other));
    seen.add(variant.id);
  }
  for (const variant of asArray(remoteVariants)) {
    if (!variant || !variant.id || seen.has(variant.id)) continue;
    merged.push(variant);
    seen.add(variant.id);
  }
  return merged;
}

function pickNewerVariant(one, two) {
  if (!two) return one;
  if (!one) return two;
  const a = { state: 'live', ts: one.updatedAt || one.createdAt, hash: revisionHash(one) };
  const b = { state: 'live', ts: two.updatedAt || two.createdAt, hash: revisionHash(two) };
  return compareVersion(a, b) >= 0 ? one : two;
}

function mergeRecords(local, remote) {
  const map = new Map();
  for (const record of asArray(local.records)) {
    if (record && record.id) map.set(record.id, record);
  }
  const ids = new Set([...map.keys()]);
  for (const record of asArray(remote.records)) {
    if (record && record.id) ids.add(record.id);
  }
  const remoteMap = new Map();
  for (const record of asArray(remote.records)) {
    if (record && record.id) remoteMap.set(record.id, record);
  }

  const records = [];
  for (const id of ids) {
    const localRecord = map.get(id);
    const remoteRecord = remoteMap.get(id);
    let base;
    if (!localRecord) base = remoteRecord;
    else if (!remoteRecord) base = localRecord;
    else {
      const a = {
        state: 'live',
        ts: localRecord.updatedAt || localRecord.createdAt,
        hash: revisionHash(localRecord),
      };
      const b = {
        state: 'live',
        ts: remoteRecord.updatedAt || remoteRecord.createdAt,
        hash: revisionHash(remoteRecord),
      };
      base = compareVersion(a, b) >= 0 ? localRecord : remoteRecord;
    }
    if (!base || !base.id) continue;
    const variants = mergeVariants(
      localRecord ? localRecord.variants : [],
      remoteRecord ? remoteRecord.variants : [],
    )
      .slice(0, 30)
      .sort((one, two) => toMs(one.createdAt) - toMs(two.createdAt));
    records.push({ ...base, variants });
  }

  records.sort((one, two) => {
    const diff = toMs(two.createdAt) - toMs(one.createdAt);
    if (diff !== 0) return diff;
    return compareStrings(one.id, two.id);
  });
  return records;
}

/* ------------------------------------------------------------------ */
/* File transfer plan                                                  */
/* ------------------------------------------------------------------ */

function planFiles({ history, trash, localFiles, remoteFiles, warnings }) {
  const localMap = indexFiles(localFiles);
  const remoteMap = indexFiles(remoteFiles);
  const download = [];
  const upload = [];
  const seen = new Set();

  const needed = [];
  for (const item of history) {
    if (item && item.id) needed.push({ kind: 'image', id: item.id, filename: item.filename });
  }
  for (const record of trash) {
    const id = safeString(record.itemId) || safeString(record.item && record.item.id);
    if (!id) continue;
    needed.push({ kind: 'trash', id, filename: record.trashFilename });
  }

  for (const entry of needed) {
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const local = localMap.get(key);
    const remote = remoteMap.get(key);
    if (local && remote) {
      if (local.sha256 && remote.sha256 && local.sha256 !== remote.sha256) {
        warnings.push(`「${entry.filename}」两端内容不同，已保留本机文件。`);
      }
      continue;
    }
    if (local) {
      if (local.sha256) upload.push({ ...entry, size: local.size, sha256: local.sha256 });
      continue;
    }
    if (remote) {
      if (remote.sha256) download.push({ ...entry, size: remote.size, sha256: remote.sha256 });
      continue;
    }
    warnings.push(`「${entry.filename}」在两端都不存在，已跳过。`);
  }

  return { download, upload };
}

/* ------------------------------------------------------------------ */
/* Public entry                                                         */
/* ------------------------------------------------------------------ */

function snapshotState(snapshot) {
  const state = snapshot && snapshot.state && typeof snapshot.state === 'object' ? snapshot.state : {};
  return {
    orderUpdatedAt: isoOrEmpty(state.orderUpdatedAt),
    historyTombstones: state.historyTombstones && typeof state.historyTombstones === 'object'
      ? state.historyTombstones
      : {},
    albumTombstones: state.albumTombstones && typeof state.albumTombstones === 'object'
      ? state.albumTombstones
      : {},
    promptTombstones: state.promptTombstones && typeof state.promptTombstones === 'object'
      ? state.promptTombstones
      : {},
  };
}

function mergeSnapshots(local, remote) {
  const warnings = [];
  const left = local && typeof local === 'object' ? local : {};
  const right = remote && typeof remote === 'object' ? remote : {};

  const historyMerge = mergeHistory(left, right, warnings);
  const albumMerge = mergeAlbums(left, right);
  const promptMerge = mergePrompts(left, right);
  const records = mergeRecords(left, right);

  const localState = snapshotState(left);
  const remoteState = snapshotState(right);
  const orderUpdatedAt =
    toMs(remoteState.orderUpdatedAt) > toMs(localState.orderUpdatedAt)
      ? remoteState.orderUpdatedAt
      : localState.orderUpdatedAt;

  const snapshot = {
    version: SNAPSHOT_VERSION,
    deviceId: safeString(left.deviceId) || safeString(right.deviceId),
    generatedAt: new Date().toISOString(),
    history: historyMerge.ordered,
    trash: historyMerge.trash,
    albums: albumMerge.albums,
    records,
    prompts: promptMerge.prompts,
    state: {
      orderUpdatedAt,
      historyTombstones: historyMerge.tombstones,
      albumTombstones: albumMerge.tombstones,
      promptTombstones: promptMerge.tombstones,
    },
  };

  const files = planFiles({
    history: snapshot.history,
    trash: snapshot.trash,
    localFiles: left.files,
    remoteFiles: right.files,
    warnings,
  });

  /* Change statistics are based on the local view, purely for the UI report. */
  const localLive = new Set(asArray(left.history).map((item) => item && item.id).filter(Boolean));
  const localTrash = new Set(
    asArray(left.trash)
      .map((record) => safeString(record.itemId) || safeString(record.item && record.item.id))
      .filter(Boolean),
  );
  const mergedLive = new Set(snapshot.history.map((item) => item.id));
  const mergedTrash = new Set(
    snapshot.trash
      .map((record) => safeString(record.itemId) || safeString(record.item && record.item.id))
      .filter(Boolean),
  );
  const stats = {
    addedImages: 0,
    trashedImages: 0,
    restoredImages: 0,
    deletedImages: 0,
    addedAlbums: 0,
    deletedAlbums: 0,
    addedRecords: 0,
    addedPrompts: 0,
    deletedPrompts: 0,
    orderChanged: false,
  };
  for (const id of mergedLive) {
    if (!localLive.has(id) && !localTrash.has(id)) stats.addedImages += 1;
    else if (localTrash.has(id)) stats.restoredImages += 1;
  }
  for (const id of mergedTrash) {
    if (localLive.has(id)) stats.trashedImages += 1;
  }
  for (const id of localLive) {
    if (!mergedLive.has(id) && !mergedTrash.has(id)) stats.deletedImages += 1;
  }
  const localAlbumIds = new Set(asArray(left.albums).map((album) => album && album.id));
  const mergedAlbumIds = new Set(snapshot.albums.map((album) => album.id));
  for (const id of mergedAlbumIds) if (!localAlbumIds.has(id)) stats.addedAlbums += 1;
  for (const id of localAlbumIds) if (!mergedAlbumIds.has(id)) stats.deletedAlbums += 1;
  const localRecordIds = new Set(asArray(left.records).map((record) => record && record.id));
  for (const record of snapshot.records) {
    if (!localRecordIds.has(record.id)) stats.addedRecords += 1;
  }
  const localPromptIds = new Set(asArray(left.prompts).map((prompt) => prompt && prompt.id));
  const mergedPromptIds = new Set(snapshot.prompts.map((prompt) => prompt.id));
  for (const id of mergedPromptIds) if (!localPromptIds.has(id)) stats.addedPrompts += 1;
  for (const id of localPromptIds) if (!mergedPromptIds.has(id)) stats.deletedPrompts += 1;
  const localOrder = asArray(left.history).map((item) => (item && item.id) || '');
  const mergedOrder = snapshot.history.map((item) => item.id);
  stats.orderChanged = localOrder.length !== mergedOrder.length ||
    localOrder.some((id, index) => id !== mergedOrder[index]);

  return {
    snapshot,
    download: files.download,
    upload: files.upload,
    warnings,
    stats,
  };
}

module.exports = {
  SNAPSHOT_VERSION,
  canonicalJson,
  sha256Hex,
  revisionHash,
  mergeSnapshots,
  mergeHistory,
  mergeAlbums,
  mergePrompts,
  mergeRecords,
};
