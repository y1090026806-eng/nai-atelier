'use strict';

const crypto = require('node:crypto');
const builtinPresets = require('./builtin-presets');

/**
 * 提示词预设：一套「系统提示词结构」的可命名快照。
 *
 * 和 llm.presets（整份 LLM 配置快照）的区别：
 * - llm.presets 连 Base URL、Key、温度一起换，用来切换供应商；
 * - promptPresets 只换 promptBlocks + structuredOutput，用来**对比不同提示词
 *   写法对同一段描述的效果**，不会碰 Key 和模型。
 *
 * 内置预设来自 LittleWhiteBox 的提示词手册（只读），用户预设存在
 * config.llm.promptPresets 里，可导入导出 JSON。
 */

const MAX_PROMPT_PRESETS = 40;
const MAX_PROMPT_BLOCKS = 24;
const PROMPT_ROLES = new Set(['system', 'assistant', 'user']);
const EXPORT_KIND = 'nai-atelier/prompt-presets';
const EXPORT_VERSION = 1;

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function newPresetId() {
  return `pp-${crypto.randomUUID()}`;
}

/** 单块规范化：role/position 白名单，空内容丢弃。 */
function normalizeBlock(raw, index) {
  if (!isPlainObject(raw)) return null;
  const content = asString(raw.content, '').trim();
  if (!content) return null;
  return {
    id: asString(raw.id, '').trim().slice(0, 80) || `block-${index + 1}`,
    role: PROMPT_ROLES.has(raw.role) ? raw.role : 'system',
    position: raw.position === 'after' ? 'after' : 'before',
    enabled: raw.enabled !== false,
    content: content.slice(0, 20_000),
  };
}

function normalizeBlocks(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((block, index) => normalizeBlock(block, index))
    .filter(Boolean)
    .slice(0, MAX_PROMPT_BLOCKS);
}

function normalizePromptPreset(raw, { builtin = false } = {}) {
  if (!isPlainObject(raw)) return null;
  const name = asString(raw.name, '').trim().slice(0, 60);
  if (!name) return null;

  const blocks = normalizeBlocks(raw.blocks);
  if (!blocks.length) return null;

  return {
    id: asString(raw.id, '').trim().slice(0, 80) || newPresetId(),
    name,
    description: asString(raw.description, '').trim().slice(0, 200),
    source: asString(raw.source, '').trim().slice(0, 160),
    structuredOutput: raw.structuredOutput === true,
    builtin: Boolean(builtin),
    blocks,
  };
}

/** 内置预设（每次启动从代码读取，永远覆盖不到用户数据）。 */
function getBuiltinPresets() {
  return (Array.isArray(builtinPresets) ? builtinPresets : [])
    .map((preset) => normalizePromptPreset(preset, { builtin: true }))
    .filter(Boolean);
}

function getBuiltinPreset(id) {
  return getBuiltinPresets().find((preset) => preset.id === id) || null;
}

/** 用户预设（存 config.llm.promptPresets）。 */
function normalizeUserPresets(rawPresets) {
  const list = Array.isArray(rawPresets) ? rawPresets : [];
  const seen = new Set();
  const result = [];
  for (const raw of list) {
    const preset = normalizePromptPreset(raw);
    if (!preset) continue;
    if (preset.id.startsWith('builtin-')) continue; // 内置 id 不允许被用户覆盖
    if (seen.has(preset.id)) preset.id = newPresetId();
    seen.add(preset.id);
    result.push(preset);
    if (result.length >= MAX_PROMPT_PRESETS) break;
  }
  return result;
}

/** 内置 + 用户，按 id 去重（内置优先）。 */
function listPromptPresets(userPresets) {
  const builtins = getBuiltinPresets();
  const builtinIds = new Set(builtins.map((preset) => preset.id));
  const custom = normalizeUserPresets(userPresets).filter((preset) => !builtinIds.has(preset.id));
  return [...builtins, ...custom];
}

function buildExportPayload(presets, { exportedAt = new Date().toISOString() } = {}) {
  return {
    app: 'nai-atelier',
    kind: EXPORT_KIND,
    version: EXPORT_VERSION,
    exportedAt,
    // 只导出内容，不带 id —— 导入端重新分配，避免撞车。
    presets: presets.map((preset) => ({
      name: preset.name,
      description: preset.description || '',
      source: preset.source || '',
      structuredOutput: Boolean(preset.structuredOutput),
      blocks: preset.blocks.map((block) => ({
        role: block.role,
        position: block.position,
        enabled: block.enabled,
        content: block.content,
      })),
    })),
  };
}

function exportPromptPresets(presets) {
  return `${JSON.stringify(buildExportPayload(presets), null, 2)}\n`;
}

/**
 * 解析导入文件。接受四种形态：
 * 1. { kind:'nai-atelier/prompt-presets', presets:[...] }
 * 2. { presets:[...] }
 * 3. 顶层数组
 * 4. 单个预设对象
 */
function parseImportText(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`JSON 解析失败：${error.message}`);
  }

  let list = null;
  if (Array.isArray(parsed)) list = parsed;
  else if (isPlainObject(parsed) && Array.isArray(parsed.presets)) list = parsed.presets;
  else if (isPlainObject(parsed) && Array.isArray(parsed.blocks)) list = [parsed];
  else if (isPlainObject(parsed) && isPlainObject(parsed.preset)) list = [parsed.preset];

  if (!list) throw new Error('文件里没有找到预设数组（期望 presets: [...] 或顶层数组）。');
  if (!list.length) throw new Error('预设数组是空的。');
  if (list.length > MAX_PROMPT_PRESETS) {
    throw new Error(`一次最多导入 ${MAX_PROMPT_PRESETS} 个预设，当前 ${list.length} 个。`);
  }
  return list;
}

/**
 * 导入合并：同名不覆盖，自动加「(2)」后缀；id 一律重新分配。
 * 返回新的用户预设数组 + 报告，调用方负责写回配置。
 */
function mergeImportedPresets({ existing = [], imported = [] } = {}) {
  const presets = normalizeUserPresets(existing);
  const usedNames = new Set(presets.map((preset) => preset.name));
  const added = [];

  for (const raw of imported) {
    const preset = normalizePromptPreset({ ...raw, id: '' });
    if (!preset) continue;

    let name = preset.name;
    let counter = 2;
    while (usedNames.has(name)) {
      name = `${preset.name} (${counter})`.slice(0, 60);
      counter += 1;
    }
    usedNames.add(name);

    const next = { ...preset, id: newPresetId(), name };
    presets.push(next);
    added.push(next);
  }

  return {
    presets: presets.slice(0, MAX_PROMPT_PRESETS),
    added: added.length,
    skipped: Math.max(0, imported.length - added.length),
    names: added.map((preset) => preset.name),
  };
}

module.exports = {
  MAX_PROMPT_PRESETS,
  MAX_PROMPT_BLOCKS,
  EXPORT_KIND,
  EXPORT_VERSION,
  newPresetId,
  normalizeBlock,
  normalizeBlocks,
  normalizePromptPreset,
  getBuiltinPresets,
  getBuiltinPreset,
  normalizeUserPresets,
  listPromptPresets,
  buildExportPayload,
  exportPromptPresets,
  parseImportText,
  mergeImportedPresets,
};
