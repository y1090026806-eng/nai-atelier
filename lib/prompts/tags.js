'use strict';

/**
 * Tag 级工具：拆分 / 去重 / 权重归一化。
 *
 * 这里是全仓库唯一的 tag 去重口径，server.js 的提示词拼接、结构化输出的
 * 多角色合并、以及前端预览都走同一套规则，避免出现「同一个 tag 拼了两次」
 * 或者「(1girl:1.2) 和 1girl 被当成两个」的问题。
 */

const WEIGHT_RE = /^(.*?):\s*([0-9]*\.?[0-9]+)\s*$/;

function promptTags(value) {
  return String(value ?? '')
    .split(/[,\n]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * 把 tag 归一成比较用的 key：忽略 NovelAI 权重语法与普通括号，
 * 所以 `(1girl:1.2)`、`((1girl))`、`1girl` 视为同一个 tag。
 */
function tagDedupeKey(tag) {
  let value = String(tag ?? '').trim();
  for (let round = 0; round < 4; round += 1) {
    const weighted = value.match(/^\((.*):\s*[0-9.]+\s*\)$/);
    if (weighted) {
      value = weighted[1].trim();
      continue;
    }
    if (/^\(.*\)$/.test(value) || /^\[.*\]$/.test(value)) {
      value = value.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return value.toLowerCase().replace(/\s+/g, ' ');
}

/** 保留先出现的写法（先出现的通常是用户手写的、优先级更高的）。 */
function dedupeTags(tags) {
  const seen = new Set();
  const unique = [];
  for (const raw of tags) {
    const tag = String(raw ?? '').trim();
    if (!tag) continue;
    const key = tagDedupeKey(tag);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(tag);
  }
  return unique;
}

/** 拆分 + 去重 + 逗号拼接。 */
function joinTags(tags) {
  return dedupeTags(tags).join(', ');
}

/**
 * 解析 `(tag:1.2)` / `tag::1.2` 形式的权重，返回 { tag, weight }。
 * 不改变原字符串，只用于 UI 展示和「按重要性裁剪」。
 */
function splitWeight(tag) {
  const value = String(tag ?? '').trim();
  const nested = value.match(/^\((.*):\s*([0-9]*\.?[0-9]+)\s*\)$/);
  if (nested) return { tag: nested[1].trim(), weight: Number(nested[2]), weighted: true };
  const colons = value.match(WEIGHT_RE);
  if (colons && colons[1].includes('::')) {
    const parts = colons[1].split('::');
    return { tag: parts[0].trim(), weight: Number(colons[2]), weighted: true };
  }
  return { tag: value, weight: 1, weighted: false };
}

/** 把长 tag 串裁剪到不超过 maxTags 个元素，保留原顺序。 */
function limitTags(tags, maxTags) {
  const list = Array.isArray(tags) ? tags : promptTags(tags);
  if (!Number.isFinite(maxTags) || maxTags <= 0 || list.length <= maxTags) return list.slice();
  return list.slice(0, maxTags);
}

/** 统计 tag 串里的元素数量（按逗号计）。 */
function countTags(value) {
  return promptTags(value).length;
}

module.exports = {
  promptTags,
  tagDedupeKey,
  dedupeTags,
  joinTags,
  splitWeight,
  limitTags,
  countTags,
};
