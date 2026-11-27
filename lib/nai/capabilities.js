'use strict';

/**
 * NovelAI 模型能力表。
 *
 * 这张表决定三件事：
 * 1. 走哪个端点、用什么传输格式（V5 是 msgpack 流 + multipart，旧模型是 ZIP）；
 * 2. 能发哪些结构化字段（角色提示词 / 坐标 / ucPresetId / 透明背景）；
 * 3. 哪些参数被模型锁死（V5 Full Medium 是蒸馏模型，步数与采样器固定）。
 *
 * 新增模型时只改这里，不要在各处写 `model.startsWith('nai-diffusion-5')`。
 */

const LEGACY_IMAGE_TRANSPORT = 'image';
const V5_STREAM_TRANSPORT = 'msgpack-stream';

const V5_COMMON = {
  family: 'v5',
  transport: V5_STREAM_TRANSPORT,
  endpoint: '/ai/generate-image-stream',
  paramsVersion: 4,
  // V5 支持「角色提示词 + 归一化坐标」，一图最多 10 个角色。
  maxCharacters: 10,
  centerMode: 'normalized',
  supportsCharacterPrompts: true,
  supportsV5Presets: true,
  supportsTransparentBackground: true,
  supportsVibe: false,
  supportsVarietyBoost: false,
  defaults: { steps: 23, scale: 7, sampler: 'k_euler_ancestral', noiseSchedule: 'karras' },
};

const V4_COMMON = {
  transport: LEGACY_IMAGE_TRANSPORT,
  endpoint: '/ai/generate-image',
  paramsVersion: 3,
  // V4/V4.5 的角色提示词是「网格坐标」，一图最多 6 个角色。
  maxCharacters: 6,
  centerMode: 'grid',
  supportsCharacterPrompts: true,
  supportsV5Presets: false,
  supportsTransparentBackground: false,
  supportsVibe: true,
  defaults: { steps: 28, scale: 5, sampler: 'k_euler_ancestral', noiseSchedule: 'karras' },
};

const MODEL_CAPABILITIES = {
  'nai-diffusion-5-full': {
    ...V5_COMMON,
    id: 'nai-diffusion-5-full',
    label: 'V5 Full',
    supportsVarietyBoost: false,
  },
  'nai-diffusion-5-full-medium': {
    ...V5_COMMON,
    id: 'nai-diffusion-5-full-medium',
    label: 'V5 Full Medium（蒸馏）',
    // 蒸馏模型：官方只允许 14 步 + k_euler_ancestral。
    lockedSteps: 14,
    lockedSampler: 'k_euler_ancestral',
    lockedNoiseSchedule: 'karras',
  },
  'nai-diffusion-5-curated': {
    ...V5_COMMON,
    id: 'nai-diffusion-5-curated',
    label: 'V5 Curated',
  },
  'nai-diffusion-4-5-full': {
    ...V4_COMMON,
    id: 'nai-diffusion-4-5-full',
    label: 'V4.5 Full',
    family: 'v4.5',
    supportsVarietyBoost: true,
  },
  'nai-diffusion-4-5-curated': {
    ...V4_COMMON,
    id: 'nai-diffusion-4-5-curated',
    label: 'V4.5 Curated',
    family: 'v4.5',
    supportsVarietyBoost: true,
  },
  'nai-diffusion-4-full': {
    ...V4_COMMON,
    id: 'nai-diffusion-4-full',
    label: 'V4 Full',
    family: 'v4',
  },
  'nai-diffusion-4-curated-preview': {
    ...V4_COMMON,
    id: 'nai-diffusion-4-curated-preview',
    label: 'V4 Curated',
    family: 'v4',
  },
  'nai-diffusion-3-full': {
    ...V4_COMMON,
    id: 'nai-diffusion-3-full',
    label: 'V3 Full',
    family: 'v3',
    paramsVersion: 3,
    maxCharacters: 0,
    supportsCharacterPrompts: false,
    supportsVibe: false,
    supportsV5Presets: false,
    defaults: { steps: 28, scale: 5, sampler: 'k_euler_ancestral', noiseSchedule: 'karras' },
  },
  'nai-diffusion-3-curated': {
    ...V4_COMMON,
    id: 'nai-diffusion-3-curated',
    label: 'V3 Curated',
    family: 'v3',
    maxCharacters: 0,
    supportsCharacterPrompts: false,
    supportsVibe: false,
    supportsV5Presets: false,
  },
  'nai-diffusion-furry-3': {
    ...V4_COMMON,
    id: 'nai-diffusion-furry-3',
    label: 'Furry V3',
    family: 'v3',
    maxCharacters: 0,
    supportsCharacterPrompts: false,
    supportsVibe: false,
    supportsV5Presets: false,
  },
};

/** 未知模型 id 的兜底：按前缀猜家族，至少保证协议正确。 */
function inferCapabilities(modelId) {
  const id = String(modelId || '').trim();
  if (/^nai-diffusion-5-full-medium/i.test(id)) {
    return { ...MODEL_CAPABILITIES['nai-diffusion-5-full-medium'], id, label: id || 'V5 Medium' };
  }
  if (/^nai-diffusion-5/i.test(id)) {
    return { ...MODEL_CAPABILITIES['nai-diffusion-5-full'], id, label: id || 'V5' };
  }
  if (/^nai-diffusion-4-5/i.test(id)) {
    return { ...MODEL_CAPABILITIES['nai-diffusion-4-5-full'], id, label: id || 'V4.5' };
  }
  if (/^nai-diffusion-4/i.test(id)) {
    return { ...MODEL_CAPABILITIES['nai-diffusion-4-full'], id, label: id || 'V4' };
  }
  return { ...MODEL_CAPABILITIES['nai-diffusion-3-full'], id, label: id || 'V3' };
}

function resolveCapabilities(modelId) {
  const id = String(modelId || '').trim();
  return MODEL_CAPABILITIES[id] || inferCapabilities(id);
}

/** 给前端用的能力摘要（不含内部函数）。 */
function listModelCapabilities() {
  return Object.values(MODEL_CAPABILITIES).map((entry) => ({
    id: entry.id,
    label: entry.label,
    family: entry.family,
    transport: entry.transport,
    maxCharacters: entry.maxCharacters,
    centerMode: entry.centerMode,
    supportsCharacterPrompts: entry.supportsCharacterPrompts,
    supportsV5Presets: entry.supportsV5Presets,
    supportsTransparentBackground: entry.supportsTransparentBackground,
    supportsVibe: entry.supportsVibe,
    supportsVarietyBoost: entry.supportsVarietyBoost,
    lockedSteps: entry.lockedSteps || null,
    lockedSampler: entry.lockedSampler || null,
  }));
}

/** V4.5 的 variety_boost：按分辨率把 CFG 重缩放阈值推到「高分辨率才生效」。 */
function varietyBoostSigma(width, height) {
  const w = Number(width) || 832;
  const h = Number(height) || 1216;
  return Math.round(Math.sqrt((w * h) / 1011712) * 58 * 100) / 100;
}

const UC_PRESETS = {
  heavy: { id: 'heavy', label: '重度（默认）', legacyValue: 0 },
  light: { id: 'light', label: '轻度', legacyValue: 1 },
  humanFocus: { id: 'humanFocus', label: '人物特化', legacyValue: 2 },
  furryFocus: { id: 'furryFocus', label: '兽人特化', legacyValue: 3 },
  none: { id: 'none', label: '不使用', legacyValue: -1 },
};

/** V5 的质量预设由服务端内置 tag 承担，客户端只发 id。 */
const QUALITY_PRESETS = {
  standard: { id: 'standard', label: '标准', tags: 'very aesthetic, masterpiece, no text' },
  light: { id: 'light', label: '轻度', tags: 'very aesthetic, amazing quality, no text' },
  none: { id: 'none', label: '不使用', tags: '' },
};

function normalizeUcPreset(value) {
  const id = String(value ?? '').trim();
  return UC_PRESETS[id] ? id : 'heavy';
}

function normalizeQualityPreset(value) {
  const id = String(value ?? '').trim();
  return QUALITY_PRESETS[id] ? id : 'standard';
}

module.exports = {
  MODEL_CAPABILITIES,
  UC_PRESETS,
  QUALITY_PRESETS,
  resolveCapabilities,
  inferCapabilities,
  listModelCapabilities,
  varietyBoostSigma,
  normalizeUcPreset,
  normalizeQualityPreset,
  V5_STREAM_TRANSPORT,
  LEGACY_IMAGE_TRANSPORT,
};
