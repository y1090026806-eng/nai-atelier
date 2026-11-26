'use strict';

/**
 * NAI Atelier — local-only LLM tag generator + NovelAI image workbench.
 *
 * Flow:
 *   natural language -> LLM tags -> prompt assembly -> NovelAI ZIP
 *   -> in-memory unzip -> outputs/*.png -> static URL returned to the browser
 */

const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const AdmZip = require('adm-zip');

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const APP_VERSION = '1.8.0';

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, 'data');
const OUTPUTS_DIR = process.env.OUTPUTS_DIR
  ? path.resolve(process.env.OUTPUTS_DIR)
  : path.join(ROOT_DIR, 'outputs');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const RECORDS_FILE = path.join(DATA_DIR, 'records.json');
const ALBUMS_FILE = path.join(DATA_DIR, 'albums.json');
const TRASH_FILE = path.join(DATA_DIR, 'trash.json');
const PROMPTS_FILE = path.join(DATA_DIR, 'prompts.json');
const ALBUMS_DIR = path.join(OUTPUTS_DIR, 'albums');
// Hidden folder: images moved here are no longer gallery records. A dedicated
// static mount below serves thumbnails, while /outputs keeps dotfiles denied.
const TRASH_DIR = path.join(OUTPUTS_DIR, '.trash');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;

const DEFAULT_NAI_TIMEOUT_SECONDS = 300;
const MODEL_LIST_TIMEOUT_MS = 30_000;
const MAX_HISTORY = 200;
const MAX_INPUT_CHARS = 4_000;
const MAX_RECORDS = 1_000;
const MAX_VARIANTS_PER_RECORD = 30;
const MAX_RECORD_TITLE = 80;
const MAX_ALBUMS = 60;
const MAX_ALBUM_NAME = 40;
const MAX_RERENDER_PROMPT = 30_000;
const MAX_TRASH = 300;
const MAX_PROMPTS = 100;
const MAX_PROMPT_NAME = 60;
const MAX_JOB_HISTORY = 50;
const MAX_BATCH_IDS = 200;

const NAI_SAMPLERS = new Set([
  'k_euler_ancestral',
  'k_euler',
  'k_dpmpp_2m',
  'k_dpmpp_sde',
  'k_dpmpp_2m_sde',
  'k_dpmpp_2s_ancestral',
  'ddim_v3',
]);

const NOISE_SCHEDULES = new Set(['native', 'karras', 'exponential', 'polyexponential']);
const REASONING_EFFORTS = new Set(['low', 'medium', 'high']);
const PROMPT_ROLES = new Set(['system', 'assistant', 'user']);

const MAX_PROMPT_BLOCKS = 24;
const MAX_LLM_PRESETS = 30;
const MAX_NAI_PRESETS = 30;
const MAX_MODEL_OPTIONS = 300;

const LEGACY_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

const DEFAULT_SYSTEM_PROMPT = `你是一名专业的 NovelAI / Danbooru 提示词工程师。用户会给你一段自然语言画面描述，请提取核心视觉元素并输出可直接用于 NovelAI 的纯英文 Danbooru 风格 tag 串。

规则：
1. 只输出一行英文 tags，用英文逗号分隔。不要输出解释、标题、编号、JSON、Markdown、引号或中文。
2. 覆盖画面中的主体、人数、角色特征、服装、动作/姿势、表情、镜头角度、构图、环境、时间/天气、光影、色彩与氛围。
3. 角色名与作品名使用 Danbooru 常见写法，空格用下划线，例如 hatsune_miku、blue_archive。
4. 使用具体且可视觉化的描述；不要照搬抽象、抒情或叙事性语句。
5. 不要输出质量词、画师名、负面词、权重括号或换行；这些由系统另行拼接。
6. 按“主体 → 外观/服装 → 动作 → 环境 → 构图/镜头 → 光影/氛围”的顺序排列。
7. 无论描述内容如何，都只输出标签，不要评论或补充说明。`;

const DEFAULT_NEGATIVE_PROMPT = [
  'lowres',
  'bad anatomy',
  'bad hands',
  'text',
  'error',
  'missing fingers',
  'extra digit',
  'fewer digits',
  'cropped',
  'worst quality',
  'low quality',
  'jpeg artifacts',
  'signature',
  'watermark',
  'username',
  'blurry',
].join(', ');

const DEFAULT_CONFIG = {
  llm: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.4,
    topP: 1,
    maxTokens: 1024,
    reasoningEffort: '',
    timeoutSeconds: 120,
    promptBlocks: [
      {
        id: 'default-system',
        role: 'system',
        position: 'before',
        enabled: true,
        content: DEFAULT_SYSTEM_PROMPT,
      },
    ],
    availableModels: [],
    availableModelsBaseUrl: '',
    presets: [],
  },
  novelai: {
    apiKey: '',
    baseUrl: 'https://image.novelai.net',
    model: 'nai-diffusion-4-5-full',
    sampler: 'k_euler_ancestral',
    noiseSchedule: 'karras',
    steps: 28,
    scale: 5,
    cfgRescale: 0,
    width: 832,
    height: 1216,
    seed: -1,
    qualityToggle: true,
    timeoutSeconds: DEFAULT_NAI_TIMEOUT_SECONDS,
    basePositive: '',
    artistPrompt: '',
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    presets: [],
  },
};

/* ------------------------------------------------------------------ */
/* General helpers                                                     */
/* ------------------------------------------------------------------ */

class AppError extends Error {
  constructor(message, status = 500, code = 'APP_ERROR') {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function clampNumber(value, fallback, min, max) {
  const number = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampInt(value, fallback, min, max) {
  return Math.round(clampNumber(value, fallback, min, max));
}

function normalizeBaseUrl(value, fallback) {
  const raw = asString(value, '').trim() || fallback;
  return raw.replace(/\/+$/, '');
}

function normalizeDimension(value, fallback) {
  const number = clampNumber(value, fallback, 64, 2048);
  return Math.min(2048, Math.max(64, Math.round(number / 64) * 64));
}

function normalizeSeed(value) {
  const number = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= 0 && number <= 0xffffffff ? number : -1;
}

function randomSeed() {
  return crypto.randomBytes(4).readUInt32BE(0);
}

function normalizePromptBlocks(rawBlocks, fallbackText) {
  // Older configs only had a single `systemPrompt` string. Keep that text when
  // no block list exists yet; an explicit empty array means "no prompt blocks".
  if (!Array.isArray(rawBlocks)) {
    const content = asString(fallbackText, '').trim()
      ? asString(fallbackText, '')
      : DEFAULT_SYSTEM_PROMPT;
    return [
      {
        id: crypto.randomUUID(),
        role: 'system',
        position: 'before',
        enabled: true,
        content,
      },
    ];
  }

  const blocks = [];
  for (const raw of rawBlocks.slice(0, MAX_PROMPT_BLOCKS)) {
    if (!isPlainObject(raw)) continue;
    blocks.push({
      id: asString(raw.id, '').trim().slice(0, 80) || crypto.randomUUID(),
      role: PROMPT_ROLES.has(raw.role) ? raw.role : 'system',
      position: raw.position === 'after' ? 'after' : 'before',
      enabled: raw.enabled !== false,
      content: asString(raw.content, '').slice(0, 16_000),
    });
  }
  return blocks;
}

function normalizeModelOptions(value) {
  const rows = Array.isArray(value) ? value : [];
  const models = [];
  for (const row of rows) {
    if (typeof row !== 'string') continue;
    const id = row.trim().slice(0, 200);
    if (!id || models.includes(id)) continue;
    models.push(id);
    if (models.length >= MAX_MODEL_OPTIONS) break;
  }
  return models;
}

function normalizeLlmCore(source, legacyGemini = false) {
  const defaults = DEFAULT_CONFIG.llm;
  const fallbackBaseUrl = legacyGemini ? GEMINI_OPENAI_BASE_URL : defaults.baseUrl;
  let baseUrl = normalizeBaseUrl(source.baseUrl, fallbackBaseUrl);
  if (legacyGemini && baseUrl.toLowerCase() === LEGACY_GEMINI_BASE_URL) {
    baseUrl = GEMINI_OPENAI_BASE_URL;
  }

  const fallbackModel = legacyGemini ? 'gemini-2.5-flash' : defaults.model;
  const model = asString(source.model, fallbackModel).trim().slice(0, 200) || fallbackModel;

  return {
    apiKey: asString(source.apiKey, '').trim().slice(0, 1_000),
    baseUrl: normalizeBaseUrl(baseUrl, fallbackBaseUrl),
    model,
    temperature: clampNumber(source.temperature, defaults.temperature, 0, 2),
    topP: Math.round(clampNumber(source.topP, defaults.topP, 0, 1) * 100) / 100,
    maxTokens: clampInt(source.maxTokens, defaults.maxTokens, 16, 32_768),
    reasoningEffort: REASONING_EFFORTS.has(source.reasoningEffort) ? source.reasoningEffort : '',
    timeoutSeconds: clampInt(source.timeoutSeconds, defaults.timeoutSeconds, 10, 600),
    promptBlocks: normalizePromptBlocks(source.promptBlocks, source.systemPrompt),
  };
}

function normalizeLlmPreset(raw) {
  if (!isPlainObject(raw)) return null;
  const name = asString(raw.name, '').trim().slice(0, 60);
  if (!name) return null;

  return {
    id: asString(raw.id, '').trim().slice(0, 80) || crypto.randomUUID(),
    name,
    ...normalizeLlmCore(raw),
    availableModels: normalizeModelOptions(raw.availableModels),
    availableModelsBaseUrl: normalizeBaseUrl(raw.availableModelsBaseUrl, ''),
  };
}

function normalizeNovelAiCore(source) {
  const defaults = DEFAULT_CONFIG.novelai;
  const modelCandidate = asString(source.model, defaults.model).trim().slice(0, 120);
  const model = /^[a-z0-9][a-z0-9._-]*$/i.test(modelCandidate) ? modelCandidate : defaults.model;

  return {
    apiKey: asString(source.apiKey, '').trim().slice(0, 1_000),
    baseUrl: normalizeBaseUrl(source.baseUrl, defaults.baseUrl),
    model,
    sampler: NAI_SAMPLERS.has(source.sampler) ? source.sampler : defaults.sampler,
    noiseSchedule: NOISE_SCHEDULES.has(source.noiseSchedule)
      ? source.noiseSchedule
      : defaults.noiseSchedule,
    steps: clampInt(source.steps, defaults.steps, 1, 50),
    scale: Math.round(clampNumber(source.scale, defaults.scale, 1, 10) * 100) / 100,
    cfgRescale: Math.round(clampNumber(source.cfgRescale, defaults.cfgRescale, 0, 1) * 100) / 100,
    width: normalizeDimension(source.width, defaults.width),
    height: normalizeDimension(source.height, defaults.height),
    seed: normalizeSeed(source.seed),
    qualityToggle:
      typeof source.qualityToggle === 'boolean'
        ? source.qualityToggle
        : defaults.qualityToggle,
    timeoutSeconds: clampInt(
      source.timeoutSeconds,
      DEFAULT_NAI_TIMEOUT_SECONDS,
      30,
      900,
    ),
    basePositive: asString(source.basePositive, defaults.basePositive).slice(0, 8_000),
    artistPrompt: asString(source.artistPrompt, defaults.artistPrompt).slice(0, 4_000),
    negativePrompt: asString(source.negativePrompt, defaults.negativePrompt).slice(0, 8_000),
  };
}

function normalizeNovelAiPreset(raw) {
  if (!isPlainObject(raw)) return null;
  const name = asString(raw.name, '').trim().slice(0, 60);
  if (!name) return null;

  // Presets are style/sampling snapshots; the account credentials, endpoint and
  // per-request timeout stay on the main config so switching a preset never
  // changes where images go or how long the request is allowed to take.
  const core = normalizeNovelAiCore(raw);
  const { apiKey, baseUrl, timeoutSeconds, ...settings } = core;

  return {
    id: asString(raw.id, '').trim().slice(0, 80) || crypto.randomUUID(),
    name,
    ...settings,
  };
}

function normalizeConfig(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const llmSource = isPlainObject(source.llm) ? source.llm : {};
  const naiSource = isPlainObject(source.novelai) ? source.novelai : {};

  // Older versions had a separate Gemini protocol. That protocol is gone:
  // migrate a Gemini setup to Google's OpenAI-compatible endpoint, keeping the
  // stored key and model so the user does not have to set it up again.
  const legacyGemini = llmSource.provider === 'gemini';
  const llmCore = normalizeLlmCore(llmSource, legacyGemini);
  const presets = Array.isArray(llmSource.presets)
    ? llmSource.presets.map(normalizeLlmPreset).filter(Boolean).slice(0, MAX_LLM_PRESETS)
    : [];

  const naiCore = normalizeNovelAiCore(naiSource);
  const naiPresets = Array.isArray(naiSource.presets)
    ? naiSource.presets.map(normalizeNovelAiPreset).filter(Boolean).slice(0, MAX_NAI_PRESETS)
    : [];

  return {
    llm: {
      ...llmCore,
      availableModels: normalizeModelOptions(llmSource.availableModels),
      availableModelsBaseUrl: normalizeBaseUrl(llmSource.availableModelsBaseUrl, ''),
      presets,
    },
    novelai: {
      ...naiCore,
      presets: naiPresets,
    },
  };
}

function assertHttpUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppError(`配置中的 ${label} 不是有效的 URL。`, 400, 'INVALID_URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError(`配置中的 ${label} 必须使用 http 或 https。`, 400, 'INVALID_URL');
  }
  return value;
}

function extractApiErrorDetail(data) {
  let source = data;

  if (Buffer.isBuffer(source) || source instanceof ArrayBuffer) {
    const text = Buffer.from(source).toString('utf8').slice(0, 8_000);
    source = safeJsonParse(text) ?? text;
  }

  if (typeof source === 'string') {
    return source
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 400);
  }

  if (!isPlainObject(source)) return '';

  const candidates = [
    source.error?.message,
    source.error?.status,
    source.message,
    source.detail,
    source.msg,
  ];

  if (Array.isArray(source.errors) && source.errors.length > 0) {
    candidates.push(source.errors[0]?.message ?? source.errors[0]);
  }

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.replace(/\s+/g, ' ').trim().slice(0, 400);
    }
  }

  return '';
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isCancelError(error) {
  return (
    error?.code === 'ERR_CANCELED' ||
    error?.name === 'CanceledError' ||
    error?.name === 'AbortError' ||
    error === 'CANCELED'
  );
}

function canceledError() {
  return new AppError('生成已取消。', 499, 'CANCELED');
}

function cleanAxiosNetworkMessage(label, error, timeoutSeconds) {
  const code = error?.code || '';
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
    return new AppError(
      `${label} 请求超时${timeoutSeconds ? `（超过 ${timeoutSeconds} 秒）` : ''}，请检查网络或稍后重试。`,
      504,
      'UPSTREAM_TIMEOUT',
    );
  }
  if (code === 'ENOTFOUND') {
    return new AppError(`${label} 接口域名无法解析，请检查 Base URL 或网络代理。`, 502, 'UPSTREAM_DNS');
  }
  if (code === 'ECONNREFUSED') {
    return new AppError(`${label} 接口拒绝连接，请确认地址与本地网络。`, 502, 'UPSTREAM_REFUSED');
  }
  return new AppError(
    `${label} 网络请求失败：${error?.message || '未知网络错误'}`,
    502,
    'UPSTREAM_NETWORK',
  );
}

/* ------------------------------------------------------------------ */
/* LLM adapters                                                        */
/* ------------------------------------------------------------------ */

function buildOpenAiChatUrl(baseUrl) {
  const base = assertHttpUrl(baseUrl, 'LLM Base URL').replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

function buildOpenAiModelsUrl(baseUrl) {
  const base = assertHttpUrl(baseUrl, 'LLM Base URL').replace(/\/+$/, '');
  const root = base.replace(/\/chat\/completions$/i, '');
  if (/\/models$/i.test(root)) return root;
  return `${root}/models`;
}

function extractModelList(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : [];

  const models = [];
  for (const row of rows) {
    const raw = typeof row === 'string' ? row : (row?.id ?? row?.name ?? row?.model);
    if (typeof raw !== 'string') continue;
    // Google's OpenAI-compatible endpoint prefixes ids with "models/"; the
    // chat endpoint wants the bare id, so normalise it here.
    const id = raw.trim().replace(/^models\//i, '').slice(0, 200);
    if (!id || models.includes(id)) continue;
    models.push(id);
    if (models.length >= 300) break;
  }

  models.sort((a, b) => a.localeCompare(b));
  return models;
}

async function fetchLlmModels({ baseUrl, apiKey }) {
  if (!apiKey) {
    throw new AppError('请先填写 LLM API Key 再拉取模型。', 400, 'LLM_API_KEY_MISSING');
  }
  if (!baseUrl) {
    throw new AppError('请先填写 LLM Base URL 再拉取模型。', 400, 'LLM_BASE_URL_MISSING');
  }

  const url = buildOpenAiModelsUrl(baseUrl);
  let response;

  try {
    response = await axios.get(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      timeout: MODEL_LIST_TIMEOUT_MS,
      validateStatus: () => true,
    });
  } catch (error) {
    throw cleanAxiosNetworkMessage('LLM', error);
  }

  if (response.status < 200 || response.status >= 300) {
    const detail = extractApiErrorDetail(response.data);
    let hint = '拉取模型列表失败';
    if (response.status === 401 || response.status === 403) hint = 'LLM API Key 无效或无权限';
    else if (response.status === 404) hint = '模型列表接口不存在，请检查 Base URL';
    else if (response.status === 429) hint = 'LLM 请求频率或额度受限';
    else if (response.status >= 500) hint = 'LLM 服务暂时不可用';
    throw new AppError(
      `${hint}（HTTP ${response.status}）${detail ? `：${detail}` : ''}`,
      502,
      'LLM_MODELS_ERROR',
    );
  }

  const models = extractModelList(response.data);
  if (models.length === 0) {
    throw new AppError('接口没有返回可用的模型列表。', 502, 'LLM_NO_MODELS');
  }
  return models;
}

function normalizeLlmTags(rawContent) {
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    throw new AppError('LLM 返回了空内容，未获得可用标签。', 502, 'LLM_EMPTY_RESPONSE');
  }

  let text = rawContent.replace(/\r\n?/g, '\n').trim();
  text = text.replace(/```[a-zA-Z0-9_-]*\s*/g, '').replace(/```/g, '');
  text = text.replace(/\*\*/g, '');
  text = text.replace(/^(?:sure[,!:]?\s*|certainly[,!:]?\s*)/i, '');
  text = text.replace(/^(?:here (?:are|is)[^\n:：]*|tags?|danbooru tags?|标签|英文标签)\s*[:：]\s*/i, '');

  const tags = [];
  for (const line of text.split('\n')) {
    let current = line.trim();
    if (!current) continue;
    current = current.replace(/^(?:[-*•·]|\d+[.)、])\s*/, '');

    for (const piece of current.split(/[,，]/)) {
      const tag = piece
        .trim()
        .replace(/^["'`“”]+|["'`“”]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (tag) tags.push(tag);
    }
  }

  const result = tags.join(', ').trim();
  if (!result) {
    throw new AppError('无法从 LLM 输出中解析标签。', 502, 'LLM_INVALID_RESPONSE');
  }
  if (result.length > 8_000) {
    throw new AppError('LLM 返回的标签过长，请检查 System Prompt 或更换模型。', 502, 'LLM_RESPONSE_TOO_LONG');
  }
  return result;
}

const TITLE_FORMAT_HINT = [
  '在保持原有标签输出格式的前提下，另外给出一个简短中文标题。',
  '如果输出纯文本标签，请在最后另起一行写 `TITLE: <标题>`；',
  '如果输出 JSON，请增加 `"title": "<标题>"` 字段。',
  '标题不超过 24 个汉字，不要解释。',
].join('\n');

function cleanRecordTitle(value) {
  return asString(value, '')
    .replace(/\r?\n/g, ' ')
    .replace(/^["'`“”]+|["'`“”]+$/g, '')
    .replace(/^(?:TITLE|Title|标题)\s*[:：]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_RECORD_TITLE);
}

function fallbackRecordTitle(userText, tags = '') {
  const text = asString(userText, '').replace(/\s+/g, ' ').trim();
  if (text) {
    return text
      .slice(0, 40)
      .replace(/[，。！？,!?；;：:、\s]+$/g, '')
      .trim() || '未命名记录';
  }
  const firstTags = promptTags(tags).slice(0, 3).join(', ');
  return firstTags.slice(0, 40) || '旧作品';
}

function parseLlmOutput(rawContent, userText) {
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    throw new AppError('LLM 返回了空内容，未获得可用标签。', 502, 'LLM_EMPTY_RESPONSE');
  }

  let text = rawContent.replace(/\r\n?/g, '\n').trim();
  text = text.replace(/```[a-zA-Z0-9_-]*\s*/g, '').replace(/```/g, '');

  // Some models follow the title instruction by switching to JSON.
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      if (isPlainObject(parsed) && (parsed.tags !== undefined || parsed.title !== undefined)) {
        const rawTags = Array.isArray(parsed.tags)
          ? parsed.tags.join(', ')
          : typeof parsed.tags === 'string'
            ? parsed.tags
            : '';
        const tags = normalizeLlmTags(rawTags);
        const title =
          cleanRecordTitle(parsed.title) || fallbackRecordTitle(userText, tags);
        return { title, tags };
      }
    } catch {
      // Fall through to the plain-text parser.
    }
  }

  let tagText = text;
  const titleMatch = tagText.match(
    /(?:^|\n)\s*(?:TITLE|Title|标题)\s*[:：]\s*([^\n]+)/,
  );
  let title = '';
  if (titleMatch) {
    title = cleanRecordTitle(titleMatch[1]);
    tagText = tagText.replace(titleMatch[0], '\n');
  }

  const tagsMatch = tagText.match(/(?:^|\n)\s*(?:TAGS|Tags|标签|英文标签)\s*[:：]\s*/);
  if (tagsMatch) {
    tagText = tagText.slice(tagsMatch.index + tagsMatch[0].length);
  }

  const tags = normalizeLlmTags(tagText);
  return {
    title: title || fallbackRecordTitle(userText, tags),
    tags,
  };
}

function buildChatMessages(llm, userText, { titleHint = '' } = {}) {
  const before = [];
  const after = [];

  for (const block of llm.promptBlocks) {
    if (!block.enabled) continue;
    const content = block.content.trim();
    if (!content) continue;

    const message = { role: block.role, content };
    if (block.position === 'after') after.push(message);
    else before.push(message);
  }

  const userContent = titleHint ? `${userText}\n\n${titleHint}` : userText;
  return [...before, { role: 'user', content: userContent }, ...after];
}

async function generateTagsWithOpenAi(llm, userText, signal) {
  if (!llm.apiKey) {
    throw new AppError('请先在侧边栏填写 LLM API Key。', 400, 'LLM_API_KEY_MISSING');
  }

  const url = buildOpenAiChatUrl(llm.baseUrl);
  let response;

  try {
    response = await axios.post(
      url,
      {
        model: llm.model,
        messages: buildChatMessages(llm, userText, { titleHint: TITLE_FORMAT_HINT }),
        temperature: llm.temperature,
        top_p: llm.topP,
        max_tokens: llm.maxTokens,
        ...(llm.reasoningEffort ? { reasoning_effort: llm.reasoningEffort } : {}),
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${llm.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: llm.timeoutSeconds * 1000,
        ...(signal ? { signal } : {}),
        validateStatus: () => true,
      },
    );
  } catch (error) {
    if (isCancelError(error)) throw canceledError();
    throw cleanAxiosNetworkMessage('LLM', error, llm.timeoutSeconds);
  }

  if (response.status < 200 || response.status >= 300) {
    const detail = extractApiErrorDetail(response.data);
    let hint = 'LLM 请求失败';
    if (response.status === 401 || response.status === 403) hint = 'LLM API Key 无效或无权限';
    else if (response.status === 404) hint = 'LLM 接口地址或模型不存在';
    else if (response.status === 429) hint = 'LLM 请求频率或额度受限';
    else if (response.status >= 500) hint = 'LLM 服务暂时不可用';
    throw new AppError(
      `${hint}（HTTP ${response.status}）${detail ? `：${detail}` : ''}`,
      502,
      'LLM_UPSTREAM_ERROR',
    );
  }

  const content = response.data?.choices?.[0]?.message?.content;
  let text = '';

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }

  if (!text.trim()) {
    const finishReason = response.data?.choices?.[0]?.finish_reason;
    throw new AppError(
      `LLM 未返回文本内容${finishReason ? `（finish_reason: ${finishReason}）` : ''}。`,
      502,
      'LLM_EMPTY_RESPONSE',
    );
  }

  return parseLlmOutput(text, userText);
}

/* ------------------------------------------------------------------ */
/* Prompt assembly + NovelAI                                           */
/* ------------------------------------------------------------------ */

function promptTags(value) {
  return String(value ?? '')
    .split(/[,\n]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * Compare tags ignoring NovelAI weight syntax so `(1girl:1.2)` and `1girl`
 * are recognised as the same tag. The first (highest-priority) spelling wins.
 */
function tagDedupeKey(tag) {
  let value = tag.trim();
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

function buildFinalPrompt(novai, llmTags) {
  // NovelAI 最终正向提示词的拼接顺序：Artist → LLM Tags → Base positive。
  const merged = [
    ...promptTags(novai.artistPrompt),
    ...promptTags(llmTags),
    ...promptTags(novai.basePositive),
  ];

  const seen = new Set();
  const unique = [];
  for (const tag of merged) {
    const key = tagDedupeKey(tag);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(tag);
  }

  return unique.join(', ');
}

function buildNaiEndpoint(baseUrl) {
  const base = assertHttpUrl(baseUrl, 'NovelAI Base URL').replace(/\/+$/, '');
  if (/\/ai\/generate-image$/i.test(base)) return base;
  return `${base}/ai/generate-image`;
}

function buildNaiPayload(novai, prompt, seed) {
  const isV5 = novai.model.startsWith('nai-diffusion-5');
  const supportsStructuredPrompt = isV5 || novai.model.startsWith('nai-diffusion-4');

  const parameters = {
    width: novai.width,
    height: novai.height,
    n_samples: 1,
    seed,
    sampler: novai.sampler,
    steps: novai.steps,
    scale: novai.scale,
    negative_prompt: novai.negativePrompt,
    cfg_rescale: novai.cfgRescale,
    noise_schedule: novai.noiseSchedule,
    params_version: isV5 ? 4 : 3,
    legacy: false,
    legacy_v3_extend: false,
    qualityToggle: novai.qualityToggle,
    ucPreset: 0,
    dynamic_thresholding: false,
    controlnet_strength: 1,
    add_original_image: true,
    prefer_brownian: false,
  };

  if (supportsStructuredPrompt) {
    parameters.use_coords = false;
    parameters.legacy_uc = false;
    parameters.v4_prompt = {
      caption: { base_caption: prompt, char_captions: [] },
      use_coords: false,
      use_order: true,
      legacy_uc: false,
    };
    parameters.v4_negative_prompt = {
      caption: { base_caption: novai.negativePrompt, char_captions: [] },
      use_coords: false,
      use_order: false,
      legacy_uc: false,
    };
  }

  return {
    input: prompt,
    model: novai.model,
    action: 'generate',
    parameters,
  };
}

async function requestNovelAi(novai, prompt, signal) {
  if (!novai.apiKey) {
    throw new AppError('请先在侧边栏填写 NovelAI API Key。', 400, 'NAI_API_KEY_MISSING');
  }

  const seed = novai.seed >= 0 ? novai.seed : randomSeed();
  const url = buildNaiEndpoint(novai.baseUrl);
  const payload = buildNaiPayload(novai, prompt, seed);
  let response;

  try {
    response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${novai.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/zip, image/png, application/json',
      },
      responseType: 'arraybuffer',
      timeout: novai.timeoutSeconds * 1000,
      ...(signal ? { signal } : {}),
      maxBodyLength: Infinity,
      maxContentLength: 128 * 1024 * 1024,
      validateStatus: () => true,
    });
  } catch (error) {
    if (isCancelError(error)) throw canceledError();
    throw cleanAxiosNetworkMessage('NovelAI', error, novai.timeoutSeconds);
  }

  const raw = Buffer.isBuffer(response.data)
    ? response.data
    : Buffer.from(response.data ?? []);

  if (response.status < 200 || response.status >= 300) {
    const detail = extractApiErrorDetail(raw);
    let hint = 'NovelAI 请求失败';
    if (response.status === 401 || response.status === 403) hint = 'NovelAI API Key 无效或无权限';
    else if (response.status === 402) hint = 'NovelAI Anlas 余额不足或账户订阅不可用';
    else if (response.status === 429) hint = 'NovelAI 请求过于频繁，请稍后再试';
    else if (response.status >= 500) hint = 'NovelAI 服务暂时不可用';
    throw new AppError(
      `${hint}（HTTP ${response.status}）${detail ? `：${detail}` : ''}`,
      502,
      'NAI_UPSTREAM_ERROR',
    );
  }

  return {
    raw,
    seed,
    contentType: String(response.headers['content-type'] || ''),
  };
}

function detectImageExtension(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }

  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }

  return null;
}

function looksLikeJson(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  const head = buffer.toString('utf8', 0, Math.min(buffer.length, 64)).trimStart();
  return head.startsWith('{') || head.startsWith('[');
}

function extractImageFromNaiResponse(raw, contentType = '') {
  if (!Buffer.isBuffer(raw) || raw.length === 0) {
    throw new AppError('NovelAI 返回了空响应。', 502, 'NAI_EMPTY_RESPONSE');
  }

  const directExtension = detectImageExtension(raw);
  if (directExtension) {
    return { buffer: raw, extension: directExtension, mode: 'image' };
  }

  if (String(contentType).includes('application/json') || looksLikeJson(raw)) {
    const detail = extractApiErrorDetail(raw);
    throw new AppError(
      `NovelAI 返回了错误信息${detail ? `：${detail}` : '。'}`,
      502,
      'NAI_ERROR_RESPONSE',
    );
  }

  let zip;
  try {
    zip = new AdmZip(raw);
  } catch {
    throw new AppError(
      '无法解析 NovelAI 响应：返回内容既不是 ZIP 也不是图片。',
      502,
      'NAI_INVALID_RESPONSE',
    );
  }

  const entries = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .filter((entry) => /\.(png|jpe?g|webp)$/i.test(entry.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));

  if (entries.length === 0) {
    throw new AppError(
      'NovelAI ZIP 响应中没有找到 PNG/JPEG/WebP 图片。',
      502,
      'NAI_ZIP_NO_IMAGE',
    );
  }

  const entry = entries[0];
  const data = entry.getData();

  if (data.length > 96 * 1024 * 1024) {
    throw new AppError('NovelAI 返回的图片过大，已拒绝保存。', 502, 'NAI_IMAGE_TOO_LARGE');
  }

  const extension =
    detectImageExtension(data) ||
    (entry.entryName.toLowerCase().endsWith('.png')
      ? 'png'
      : entry.entryName.toLowerCase().endsWith('.webp')
        ? 'webp'
        : 'jpg');

  return { buffer: data, extension, mode: 'zip' };
}

/* ------------------------------------------------------------------ */
/* Metadata export: PNG text chunks + sidecar JSON                     */
/* ------------------------------------------------------------------ */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IMAGE_EXTENSION_RE = /\.(png|jpe?g|webp)$/i;
// tEXt/iTXt keywords this app owns. They are replaced on every sync so the
// embedded copy can never go stale without piling up duplicate chunks.
const OWN_METADATA_KEYWORDS = new Set(['parameters', 'NAI-Atelier']);

let crcTable = null;

function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let value = n;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[n] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildPngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** UTF-8-safe text chunk: iTXt when the text is not Latin-1, tEXt otherwise. */
function buildPngTextChunk(keyword, text) {
  const value = String(text ?? '');
  const latin1Safe = /^[\u0000-\u00ff]*$/.test(value);
  if (latin1Safe) {
    const data = Buffer.concat([
      Buffer.from(keyword, 'latin1'),
      Buffer.from([0]),
      Buffer.from(value, 'latin1'),
    ]);
    return buildPngChunk('tEXt', data);
  }
  const data = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0, 0, 0, 0, 0]),
    Buffer.from(value, 'utf8'),
  ]);
  return buildPngChunk('iTXt', data);
}

/** Build the A1111-style "parameters" text block for broad tool compatibility. */
function buildMetadataParametersText(metadata) {
  const lines = [asString(metadata.prompt, '')];
  if (metadata.negativePrompt) lines.push(`Negative prompt: ${metadata.negativePrompt}`);
  lines.push(
    [
      `Steps: ${metadata.steps}`,
      `Sampler: ${metadata.sampler}`,
      `Schedule type: ${metadata.noiseSchedule}`,
      `CFG scale: ${metadata.scale}`,
      `Seed: ${metadata.seed}`,
      `Size: ${metadata.width}x${metadata.height}`,
      `Model: ${metadata.model}`,
      `NAI Atelier: ${metadata.appVersion}`,
    ].join(', '),
  );
  return lines.join('\n');
}

/**
 * Insert/replace our own tEXt/iTXt chunks in a PNG. Non-PNG buffers are
 * returned untouched so the same helper works for JPEG/WebP sidecars.
 */
function embedPngMetadata(buffer, metadata) {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length < PNG_SIGNATURE.length + 12 ||
    !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return buffer;
  }

  const newChunks = [
    buildPngTextChunk('parameters', buildMetadataParametersText(metadata)),
    buildPngTextChunk('NAI-Atelier', JSON.stringify(metadata)),
  ];
  const output = [PNG_SIGNATURE];
  let offset = PNG_SIGNATURE.length;
  let inserted = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.length) return buffer; // corrupt tail: leave it alone
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let keep = true;

    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      const dataStart = offset + 8;
      const data = buffer.subarray(dataStart, dataStart + length);
      const nullIndex = data.indexOf(0);
      const keyword = nullIndex >= 0 ? data.subarray(0, nullIndex).toString('latin1') : '';
      if (OWN_METADATA_KEYWORDS.has(keyword)) keep = false;
    }

    if (type === 'IEND') {
      for (const chunk of newChunks) output.push(chunk);
      inserted = true;
    }
    if (keep) output.push(buffer.subarray(offset, chunkEnd));
    offset = chunkEnd;
    if (type === 'IEND') break;
  }

  return inserted ? Buffer.concat(output) : buffer;
}

function sidecarNameForFilename(filename) {
  return String(filename ?? '').replace(IMAGE_EXTENSION_RE, '.json');
}

function sidecarPathForImage(absoluteImagePath) {
  return absoluteImagePath.replace(IMAGE_EXTENSION_RE, '.json');
}

function buildMetadataSnapshot(item) {
  return {
    schema: 'nai-atelier.metadata/1',
    app: 'NAI Atelier',
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    id: item.id,
    filename: item.filename,
    relativePath: item.relativePath,
    url: item.url,
    albumId: item.albumId,
    parentId: item.parentId,
    recordId: item.recordId || '',
    variantId: item.variantId || '',
    userText: item.userText || '',
    prompt: item.prompt,
    llmTags: item.llmTags,
    negativePrompt: item.negativePrompt,
    model: item.model,
    sampler: item.sampler,
    noiseSchedule: item.noiseSchedule,
    steps: item.steps,
    scale: item.scale,
    cfgRescale: item.cfgRescale,
    width: item.width,
    height: item.height,
    seed: item.seed,
    qualityToggle: item.qualityToggle,
    llmProvider: item.llmProvider,
    llmModel: item.llmModel,
    createdAt: item.createdAt,
    elapsedMs: item.elapsedMs,
  };
}

function imageAbsolutePathForItem(item) {
  const relative =
    normalizeRelativePath(item.relativePath, item.filename) ||
    relativePathForAlbum(item.albumId, item.filename);
  return resolveOutputPath(relative);
}

/**
 * Write (or refresh) both copies of the metadata for one image:
 *   - A1111 `parameters` + full JSON inside the PNG text chunks;
 *   - a `<name>.json` sidecar next to the image.
 */
async function attachMetadataForItem(item) {
  if (!item) throw new AppError('作品不存在。', 404, 'HISTORY_NOT_FOUND');
  const metadata = buildMetadataSnapshot(item);
  const absolute = imageAbsolutePathForItem(item);

  if (!(await fileExists(absolute))) {
    throw new AppError('这条记录的原图文件已不存在。', 404, 'HISTORY_FILE_MISSING');
  }

  try {
    const buffer = await fs.readFile(absolute);
    const embedded = embedPngMetadata(buffer, metadata);
    if (embedded !== buffer && !embedded.equals(buffer)) {
      await fs.writeFile(absolute, embedded);
    }
  } catch (error) {
    console.warn(`[metadata] 无法写入 PNG 元数据 ${item.filename}：${error.message}`);
  }

  await atomicWriteJson(sidecarPathForImage(absolute), metadata);
  return metadata;
}

async function removeMetadataSidecarForImage(absoluteImagePath) {
  await fs.rm(sidecarPathForImage(absoluteImagePath), { force: true }).catch(() => {});
}

async function syncMetadataBatch(rawIds) {
  const ids = Array.isArray(rawIds) ? rawIds.filter((id) => typeof id === 'string' && id) : null;
  const targets =
    ids && ids.length > 0
      ? ids.map((id) => historyItems.find((item) => item.id === id)).filter(Boolean)
      : historyItems;

  let synced = 0;
  const failed = [];
  for (const item of targets) {
    try {
      await attachMetadataForItem(item);
      synced += 1;
    } catch (error) {
      failed.push({ id: item.id, filename: item.filename, message: error.message });
    }
  }
  return { synced, failed, total: historyItems.length };
}

function buildMetadataArchive() {
  const zip = new AdmZip();
  const used = new Set();
  const manifest = {
    schema: 'nai-atelier.metadata/1',
    app: 'NAI Atelier',
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    count: historyItems.length,
  };

  for (const item of historyItems) {
    const base = sidecarNameForFilename(item.filename);
    let entryName = base;
    let counter = 2;
    while (used.has(entryName)) {
      entryName = base.replace(/\.json$/i, `-${counter}.json`);
      counter += 1;
    }
    used.add(entryName);
    zip.addFile(
      entryName,
      Buffer.from(`${JSON.stringify(buildMetadataSnapshot(item), null, 2)}\n`, 'utf8'),
    );
  }
  zip.addFile('manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
  return { buffer: zip.toBuffer(), count: historyItems.length };
}

/* ------------------------------------------------------------------ */
/* Local storage                                                       */
/* ------------------------------------------------------------------ */

let activeConfig = normalizeConfig(DEFAULT_CONFIG);
let historyItems = [];
let records = [];
let albums = [];
let trashItems = [];
let prompts = [];
let writeQueue = Promise.resolve();
let storageReady = false;

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;

  await fs.writeFile(tempPath, body, 'utf8');
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

function queueWrite(task) {
  const next = writeQueue.then(task, task);
  writeQueue = next.catch(() => {});
  return next;
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[storage] 无法读取 ${path.basename(filePath)}，将使用默认值：${error.message}`);
    }
    return fallback;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const OUTPUT_FILENAME_RE = /^nai-\d{8}-\d{6}-[a-f0-9]{6}\.(png|jpe?g|webp)$/i;
const ALBUM_ID_RE = /^[a-z0-9][a-z0-9_-]{7,79}$/i;

function normalizeAlbumName(value) {
  return asString(value, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ALBUM_NAME);
}

function normalizeAlbumRecord(raw) {
  if (!isPlainObject(raw)) return null;
  const name = normalizeAlbumName(raw.name);
  if (!name) return null;
  const id = asString(raw.id, '').trim().slice(0, 80);
  if (!ALBUM_ID_RE.test(id)) return null;
  const createdAt = new Date(asString(raw.createdAt, ''));
  return {
    id,
    name,
    createdAt: Number.isNaN(createdAt.getTime())
      ? new Date().toISOString()
      : createdAt.toISOString(),
    coverId: asString(raw.coverId, '').trim().slice(0, 80),
  };
}

function normalizeAlbumList(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  const albums = [];
  const ids = new Set();
  const names = new Set();

  for (const row of rows) {
    const album = normalizeAlbumRecord(row);
    if (!album) continue;
    if (ids.has(album.id)) continue;
    const nameKey = album.name.toLowerCase();
    if (names.has(nameKey)) continue;
    ids.add(album.id);
    names.add(nameKey);
    albums.push(album);
    if (albums.length >= MAX_ALBUMS) break;
  }
  return albums;
}

function buildImageUrl(relativePath) {
  return `/outputs/${relativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

function normalizeRelativePath(value, filename) {
  const raw = asString(value, '').trim().replace(/\\/g, '/');
  if (!raw || raw.startsWith('/')) return '';

  const segments = raw.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return '';
  if (segments[segments.length - 1] !== filename) return '';
  if (segments.length === 1) return filename;
  if (segments.length === 3 && segments[0] === 'albums' && ALBUM_ID_RE.test(segments[1])) {
    return raw;
  }
  return '';
}

function relativePathForAlbum(albumId, filename) {
  return albumId ? `albums/${albumId}/${filename}` : filename;
}

function resolveOutputPath(relativePath) {
  const segments = asString(relativePath, '').split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new AppError('图片路径无效。', 400, 'INVALID_PATH');
  }
  const absolute = path.resolve(OUTPUTS_DIR, ...segments);
  const root = path.resolve(OUTPUTS_DIR);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new AppError('图片路径超出 outputs 目录。', 400, 'INVALID_PATH');
  }
  return absolute;
}

function albumDirectory(albumId) {
  return path.join(ALBUMS_DIR, albumId);
}

function findAlbum(albumId) {
  return albums.find((album) => album.id === albumId) || null;
}

function historyItemAlbumId(relativePath) {
  const segments = asString(relativePath, '').split('/');
  return segments.length === 3 && segments[0] === 'albums' ? segments[1] : null;
}

function normalizeHistoryRecord(raw) {
  if (!isPlainObject(raw)) return null;

  const filename = path.basename(asString(raw.filename, ''));
  if (!OUTPUT_FILENAME_RE.test(filename)) return null;

  const createdAt = new Date(asString(raw.createdAt, ''));
  const width = clampInt(raw.width, 832, 64, 2048);
  const height = clampInt(raw.height, 1216, 64, 2048);
  const seed = Number.isInteger(raw.seed) && raw.seed >= 0 ? raw.seed : -1;
  const albumCandidate = asString(raw.albumId, '').trim().slice(0, 80);
  const albumId = ALBUM_ID_RE.test(albumCandidate) ? albumCandidate : null;
  const relativePath =
    normalizeRelativePath(raw.relativePath, filename) ||
    relativePathForAlbum(albumId, filename);

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    filename,
    relativePath,
    url: buildImageUrl(relativePath),
    albumId,
    parentId: asString(raw.parentId, '').trim().slice(0, 80) || '',
    recordId: asString(raw.recordId, '').trim().slice(0, 80),
    variantId: asString(raw.variantId, '').trim().slice(0, 80),
    userText: asString(raw.userText, '').slice(0, MAX_INPUT_CHARS),
    prompt: asString(raw.prompt, '').slice(0, MAX_RERENDER_PROMPT),
    llmTags: asString(raw.llmTags, '').slice(0, 8_000),
    negativePrompt: asString(raw.negativePrompt, '').slice(0, 8_000),
    model: asString(raw.model, '').slice(0, 120),
    sampler: asString(raw.sampler, '').slice(0, 80),
    noiseSchedule: asString(raw.noiseSchedule, '').slice(0, 80),
    steps: clampInt(raw.steps, 28, 1, 50),
    scale: Math.round(clampNumber(raw.scale, 5, 1, 10) * 100) / 100,
    cfgRescale: Math.round(clampNumber(raw.cfgRescale, 0, 0, 1) * 100) / 100,
    width,
    height,
    seed,
    qualityToggle: Boolean(raw.qualityToggle),
    llmProvider: asString(raw.llmProvider, 'openai').slice(0, 40),
    llmModel: asString(raw.llmModel, '').slice(0, 200),
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date().toISOString() : createdAt.toISOString(),
    elapsedMs: clampInt(raw.elapsedMs, 0, 0, 3_600_000),
  };
}

function normalizeTextKey(value) {
  return asString(value, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeRecordVariant(raw) {
  if (!isPlainObject(raw)) return null;
  const llmTags = asString(raw.llmTags, '').slice(0, 8_000);
  if (!llmTags.trim()) return null;
  const id = asString(raw.id, '').trim().slice(0, 80) || crypto.randomUUID();
  const source = ['llm', 'manual', 'legacy'].includes(raw.source) ? raw.source : 'llm';
  const createdAt = new Date(asString(raw.createdAt, ''));
  const updatedAt = new Date(asString(raw.updatedAt, ''));
  return {
    id,
    title: cleanRecordTitle(raw.title),
    llmTags,
    source,
    llmModel: asString(raw.llmModel, '').slice(0, 200),
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date().toISOString() : createdAt.toISOString(),
    updatedAt: Number.isNaN(updatedAt.getTime()) ? new Date().toISOString() : updatedAt.toISOString(),
  };
}

function normalizeRecord(raw) {
  if (!isPlainObject(raw)) return null;
  const userText = asString(raw.userText, '').slice(0, MAX_INPUT_CHARS);
  const variants = [];
  const seen = new Set();
  for (const row of Array.isArray(raw.variants) ? raw.variants : []) {
    if (variants.length >= MAX_VARIANTS_PER_RECORD) break;
    const variant = normalizeRecordVariant(row);
    if (!variant || seen.has(variant.id)) continue;
    seen.add(variant.id);
    variants.push(variant);
  }
  if (variants.length === 0) return null;

  const createdAt = new Date(asString(raw.createdAt, ''));
  const updatedAt = new Date(asString(raw.updatedAt, ''));
  return {
    id: asString(raw.id, '').trim().slice(0, 80) || crypto.randomUUID(),
    userText,
    textKey: normalizeTextKey(userText) || asString(raw.textKey, '').trim().slice(0, MAX_INPUT_CHARS),
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date().toISOString() : createdAt.toISOString(),
    updatedAt: Number.isNaN(updatedAt.getTime()) ? new Date().toISOString() : updatedAt.toISOString(),
    variants,
  };
}

function normalizeRecordList(rawRows) {
  const rows = Array.isArray(rawRows)
    ? rawRows
    : Array.isArray(rawRows?.records)
      ? rawRows.records
      : [];
  const result = [];
  const seen = new Set();
  for (const row of rows) {
    const record = normalizeRecord(row);
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    result.push(record);
  }
  return result;
}

function findRecordById(recordId) {
  return records.find((record) => record.id === recordId) || null;
}

function findRecordByText(userText) {
  const key = normalizeTextKey(userText);
  if (!key) return null;
  return records.find((record) => record.textKey === key) || null;
}

function recordImages(recordId) {
  return historyItems.filter((item) => item.recordId === recordId);
}

function recordDisplayTitle(record, variant = null) {
  const chosen = variant || record?.variants?.[0];
  return (
    cleanRecordTitle(chosen?.title) ||
    fallbackRecordTitle(record?.userText, chosen?.llmTags) ||
    '未命名记录'
  );
}

function publicRecord(record) {
  const images = recordImages(record.id).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const countByVariant = new Map();
  for (const item of images) {
    countByVariant.set(item.variantId, (countByVariant.get(item.variantId) || 0) + 1);
  }
  return {
    id: record.id,
    userText: record.userText,
    title: recordDisplayTitle(record),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    variants: record.variants.map((variant) => ({
      ...clone(variant),
      title: recordDisplayTitle(record, variant),
      imageCount: countByVariant.get(variant.id) || 0,
    })),
    variantCount: record.variants.length,
    imageCount: images.length,
    coverId: images[0]?.id || '',
    coverUrl: images[0]?.url || '',
    latestImageAt: images[0]?.createdAt || '',
    albumIds: [...new Set(images.map((item) => item.albumId).filter(Boolean))],
  };
}

function publicRecordList() {
  return records
    .map(publicRecord)
    .sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.latestImageAt || a.createdAt).getTime();
      const bTime = new Date(b.updatedAt || b.latestImageAt || b.createdAt).getTime();
      return bTime - aTime;
    });
}

async function persistRecords() {
  const snapshot = clone(records);
  await queueWrite(() => atomicWriteJson(RECORDS_FILE, snapshot));
}

function makeRecordVariant({ title, llmTags, source = 'llm', llmModel = '', createdAt }) {
  const now = createdAt || new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: cleanRecordTitle(title) || fallbackRecordTitle('', llmTags),
    llmTags: asString(llmTags, '').slice(0, 8_000),
    source: ['llm', 'manual', 'legacy'].includes(source) ? source : 'llm',
    llmModel: asString(llmModel, '').slice(0, 200),
    createdAt: now,
    updatedAt: now,
  };
}

async function createRecordWithVariant(userText, { title, llmTags, source = 'llm', llmModel = '' }) {
  if (records.length >= MAX_RECORDS) {
    // Prefer dropping old records that no longer own any image.
    const removable = records.filter((record) => recordImages(record.id).length === 0);
    for (const record of removable) {
      const index = records.indexOf(record);
      if (index >= 0) records.splice(index, 1);
      if (records.length < MAX_RECORDS) break;
    }
    if (records.length >= MAX_RECORDS) {
      throw new AppError('记录数量已达到上限。', 409, 'RECORD_LIMIT');
    }
  }

  const now = new Date().toISOString();
  const variant = makeRecordVariant({ title, llmTags, source, llmModel, createdAt: now });
  const record = {
    id: crypto.randomUUID(),
    userText: asString(userText, '').slice(0, MAX_INPUT_CHARS),
    textKey: normalizeTextKey(userText),
    createdAt: now,
    updatedAt: now,
    variants: [variant],
  };
  records.unshift(record);
  await persistRecords();
  return { record, variant };
}

async function appendRecordVariant(record, { title, llmTags, source = 'llm', llmModel = '' }) {
  if (record.variants.length >= MAX_VARIANTS_PER_RECORD) {
    throw new AppError(
      `同一条记录最多保存 ${MAX_VARIANTS_PER_RECORD} 个 Tag 版本。`,
      409,
      'VARIANT_LIMIT',
    );
  }
  const variant = makeRecordVariant({ title, llmTags, source, llmModel });
  record.variants.push(variant);
  record.updatedAt = new Date().toISOString();
  await persistRecords();
  return variant;
}

async function updateRecordVariant(recordId, variantId, payload) {
  const record = findRecordById(recordId);
  if (!record) {
    throw new AppError('没有找到这条记录，可能已被清理。', 404, 'RECORD_NOT_FOUND');
  }
  const variant = record.variants.find((entry) => entry.id === variantId);
  if (!variant) {
    throw new AppError('没有找到这个 Tag 版本。', 404, 'VARIANT_NOT_FOUND');
  }
  const body = isPlainObject(payload) ? payload : {};
  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    variant.title = cleanRecordTitle(body.title) || fallbackRecordTitle('', variant.llmTags);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'llmTags')) {
    const tags = asString(body.llmTags, '').slice(0, 8_000).trim();
    if (!tags) {
      throw new AppError('Tag 提示词不能为空。', 400, 'EMPTY_TAGS');
    }
    variant.llmTags = tags;
  }
  variant.updatedAt = new Date().toISOString();
  record.updatedAt = variant.updatedAt;
  await persistRecords();
  return { record, variant };
}

function ensureRecordForHistoryItem(item) {
  let changed = false;
  let record = item.recordId ? findRecordById(item.recordId) : null;
  if (record) {
    let variant = item.variantId
      ? record.variants.find((entry) => entry.id === item.variantId)
      : null;
    if (!variant) {
      variant = record.variants[0];
      if (!variant) {
        variant = makeRecordVariant({
          title: fallbackRecordTitle('', item.llmTags),
          llmTags: item.llmTags || item.prompt,
          source: 'legacy',
          llmModel: item.llmModel,
          createdAt: item.createdAt,
        });
        record.variants.push(variant);
      }
      item.variantId = variant.id;
      changed = true;
    }
    if (!item.recordId) {
      item.recordId = record.id;
      changed = true;
    }
    if (item.userText !== record.userText) {
      item.userText = record.userText;
      changed = true;
    }
    return { record, variant, changed };
  }

  const createdAt = item.createdAt || new Date().toISOString();
  const variant = makeRecordVariant({
    title: fallbackRecordTitle('', item.llmTags),
    llmTags: item.llmTags || item.prompt,
    source: 'legacy',
    llmModel: item.llmModel,
    createdAt,
  });
  record = {
    id: crypto.randomUUID(),
    userText: '',
    textKey: '',
    createdAt,
    updatedAt: createdAt,
    variants: [variant],
  };
  records.push(record);
  item.recordId = record.id;
  item.variantId = variant.id;
  item.userText = '';
  return { record, variant, changed: true };
}

async function migrateHistoryRecords() {
  let historyChanged = false;
  let recordsChanged = false;
  for (const item of historyItems) {
    const beforeRecord = item.recordId;
    const beforeVariant = item.variantId;
    const beforeText = item.userText;
    const result = ensureRecordForHistoryItem(item);
    if (result.changed || result.record.createdAt === result.record.updatedAt) {
      recordsChanged = true;
    }
    if (item.recordId !== beforeRecord || item.variantId !== beforeVariant || item.userText !== beforeText) {
      historyChanged = true;
    }
  }
  if (historyChanged) await persistHistory();
  if (recordsChanged) await persistRecords();
}

async function initializeStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(OUTPUTS_DIR, { recursive: true });
  await fs.mkdir(ALBUMS_DIR, { recursive: true });
  await fs.mkdir(TRASH_DIR, { recursive: true });

  const rawConfig = await readJsonFile(CONFIG_FILE, null);
  activeConfig = normalizeConfig(rawConfig);
  await atomicWriteJson(CONFIG_FILE, activeConfig);

  const rawAlbums = await readJsonFile(ALBUMS_FILE, []);
  const albumRows = Array.isArray(rawAlbums)
    ? rawAlbums
    : Array.isArray(rawAlbums?.albums)
      ? rawAlbums.albums
      : [];
  albums = normalizeAlbumList(albumRows);
  await atomicWriteJson(ALBUMS_FILE, albums);

  const rawTrash = await readJsonFile(TRASH_FILE, []);
  const trashRows = normalizeTrashList(rawTrash);
  const keptTrash = [];
  for (const record of trashRows) {
    if (await fileExists(path.join(TRASH_DIR, record.trashFilename))) keptTrash.push(record);
  }
  trashItems = keptTrash;
  await atomicWriteJson(TRASH_FILE, trashItems);

  const rawPrompts = await readJsonFile(PROMPTS_FILE, []);
  prompts = normalizePromptList(rawPrompts);
  await atomicWriteJson(PROMPTS_FILE, prompts);

  const rawHistory = await readJsonFile(HISTORY_FILE, []);
  const rows = Array.isArray(rawHistory)
    ? rawHistory
    : Array.isArray(rawHistory?.items)
      ? rawHistory.items
      : [];

  const rawRecords = await readJsonFile(RECORDS_FILE, []);
  records = normalizeRecordList(rawRecords);

  const restored = [];
  for (const row of rows) {
    const record = normalizeHistoryRecord(row);
    if (!record) continue;

    // The file may live at the outputs root (legacy / uncategorized) or inside
    // its album folder. Try every plausible location, then trust the one that
    // really exists so a stale index can never point at a missing image.
    const candidates = [
      ...new Set([
        record.relativePath,
        relativePathForAlbum(record.albumId, record.filename),
        record.filename,
      ]),
    ];
    let found = '';
    for (const candidate of candidates) {
      if (!normalizeRelativePath(candidate, record.filename)) continue;
      if (await fileExists(resolveOutputPath(candidate))) {
        found = candidate;
        break;
      }
    }
    if (!found) continue;

    const foundAlbumId = historyItemAlbumId(found);
    record.relativePath = found;
    record.url = buildImageUrl(found);
    record.albumId = foundAlbumId && findAlbum(foundAlbumId) ? foundAlbumId : null;
    restored.push(record);
  }

  historyItems = restored.slice(0, MAX_HISTORY);

  await migrateHistoryRecords();

  // Drop album covers that point at a record that no longer exists.
  let coversChanged = false;
  const knownIds = new Set(historyItems.map((item) => item.id));
  for (const album of albums) {
    if (album.coverId && !knownIds.has(album.coverId)) {
      album.coverId = '';
      coversChanged = true;
    }
  }
  if (coversChanged) await atomicWriteJson(ALBUMS_FILE, albums);

  storageReady = true;
}

async function saveConfig(rawBody) {
  if (!isPlainObject(rawBody)) {
    throw new AppError('配置格式无效，应为 JSON 对象。', 400, 'INVALID_CONFIG');
  }

  const incoming = isPlainObject(rawBody) ? rawBody : {};
  const candidate = {
    llm: {
      ...activeConfig.llm,
      ...(isPlainObject(incoming.llm) ? incoming.llm : {}),
    },
    novelai: {
      ...activeConfig.novelai,
      ...(isPlainObject(incoming.novelai) ? incoming.novelai : {}),
    },
  };

  const normalized = normalizeConfig(candidate);
  await queueWrite(() => atomicWriteJson(CONFIG_FILE, normalized));
  activeConfig = normalized;
  return clone(activeConfig);
}

async function persistHistory() {
  const snapshot = clone(historyItems);
  await queueWrite(() => atomicWriteJson(HISTORY_FILE, snapshot));
}

async function addHistoryRecord(record) {
  historyItems.unshift(record);
  if (historyItems.length > MAX_HISTORY) {
    historyItems = historyItems.slice(0, MAX_HISTORY);
  }

  try {
    await persistHistory();
  } catch (error) {
    // The image itself is already saved. Do not fail the whole request because
    // the gallery index could not be updated.
    console.error('[storage] 历史记录写入失败：', error.message);
  }
}

async function persistAlbums() {
  const snapshot = clone(albums);
  await queueWrite(() => atomicWriteJson(ALBUMS_FILE, snapshot));
}

function publicAlbumList() {
  const counts = new Map();
  const newestByAlbum = new Map();
  const byId = new Map();
  for (const item of historyItems) {
    byId.set(item.id, item);
    if (!item.albumId) continue;
    counts.set(item.albumId, (counts.get(item.albumId) || 0) + 1);
    if (!newestByAlbum.has(item.albumId)) newestByAlbum.set(item.albumId, item);
  }
  return albums.map((album) => {
    // An explicit cover wins; otherwise the newest image in the album is shown
    // so a freshly archived image still gives the chip a thumbnail. Consumers
    // that need to distinguish the two use `explicitCoverId` ('' when the
    // thumbnail is only a fallback).
    const explicit = album.coverId ? byId.get(album.coverId) : null;
    const explicitValid = explicit && explicit.albumId === album.id ? explicit : null;
    const fallback = newestByAlbum.get(album.id) || null;
    const cover = explicitValid || fallback;
    return {
      ...album,
      coverId: cover ? cover.id : '',
      coverUrl: cover ? buildImageUrl(cover.relativePath) : '',
      explicitCoverId: explicitValid ? explicitValid.id : '',
      count: counts.get(album.id) || 0,
    };
  });
}

async function setAlbumCover(albumId, historyId) {
  const album = findAlbum(albumId);
  if (!album) {
    throw new AppError('画册不存在，可能已被删除。', 404, 'ALBUM_NOT_FOUND');
  }

  if (historyId === null || historyId === undefined || historyId === '') {
    if (album.coverId) {
      album.coverId = '';
      await persistAlbums();
    }
    return publicAlbumList().find((entry) => entry.id === albumId);
  }

  if (typeof historyId !== 'string') {
    throw new AppError('封面作品 ID 无效。', 400, 'INVALID_COVER');
  }
  const item = historyItems.find((entry) => entry.id === historyId);
  if (!item) {
    throw new AppError('没有找到这张作品，无法设为封面。', 404, 'HISTORY_NOT_FOUND');
  }
  if (item.albumId !== albumId) {
    throw new AppError('只能把画册内的作品设为封面。', 400, 'COVER_NOT_IN_ALBUM');
  }

  album.coverId = item.id;
  await persistAlbums();
  return publicAlbumList().find((entry) => entry.id === albumId);
}

/** Clear a stale cover reference after its image leaves the album or is deleted. */
function clearAlbumCoverForItem(item) {
  let changed = false;
  for (const album of albums) {
    if (album.coverId && album.coverId === item.id) {
      album.coverId = '';
      changed = true;
    }
  }
  return changed;
}

async function createAlbum(rawName) {
  const name = normalizeAlbumName(rawName);
  if (!name) {
    throw new AppError('请填写画册名称。', 400, 'ALBUM_NAME_REQUIRED');
  }
  if (albums.length >= MAX_ALBUMS) {
    throw new AppError(`画册数量已达上限（${MAX_ALBUMS} 个）。`, 409, 'ALBUM_LIMIT');
  }
  if (albums.some((album) => album.name.toLowerCase() === name.toLowerCase())) {
    throw new AppError(`画册「${name}」已存在。`, 409, 'ALBUM_EXISTS');
  }

  const album = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    coverId: '',
  };
  albums.push(album);

  try {
    await fs.mkdir(albumDirectory(album.id), { recursive: true });
    await persistAlbums();
  } catch (error) {
    albums = albums.filter((entry) => entry.id !== album.id);
    await fs.rm(albumDirectory(album.id), { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  return { ...album, count: 0, coverUrl: '' };
}

async function renameAlbum(albumId, rawName) {
  const album = findAlbum(albumId);
  if (!album) {
    throw new AppError('画册不存在，可能已被删除。', 404, 'ALBUM_NOT_FOUND');
  }

  const name = normalizeAlbumName(rawName);
  if (!name) {
    throw new AppError('请填写画册名称。', 400, 'ALBUM_NAME_REQUIRED');
  }
  if (
    albums.some(
      (entry) => entry.id !== album.id && entry.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new AppError(`画册「${name}」已存在。`, 409, 'ALBUM_EXISTS');
  }

  const previousName = album.name;
  album.name = name;
  try {
    await persistAlbums();
  } catch (error) {
    album.name = previousName;
    throw error;
  }
  return publicAlbumList().find((entry) => entry.id === album.id) || album;
}

async function cleanupEmptyAlbumDir(albumId) {
  if (!albumId) return;
  try {
    const entries = await fs.readdir(albumDirectory(albumId));
    if (entries.length === 0) await fs.rmdir(albumDirectory(albumId));
  } catch {
    // A missing or non-empty folder is fine; folders are recreated on demand.
  }
}

/**
 * Rescue files that exist in an album folder but are not in the history index
 * (for example images older than the 200-record index cap). They are moved to
 * the outputs root instead of being deleted with the album folder.
 */
async function rescueUnindexedAlbumFiles(albumId) {
  const directory = albumDirectory(albumId);
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return 0;
  }

  let moved = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const source = path.join(directory, entry.name);
    let target = path.join(OUTPUTS_DIR, entry.name);
    let counter = 1;
    while (await fileExists(target)) {
      const extension = path.extname(entry.name);
      const base = path.basename(entry.name, extension);
      target = path.join(OUTPUTS_DIR, `${base}-orphan-${counter}${extension}`);
      counter += 1;
    }
    try {
      await fs.rename(source, target);
      moved += 1;
    } catch (error) {
      console.warn(`[albums] 无法移出画册文件 ${entry.name}：${error.message}`);
    }
  }
  return moved;
}

/**
 * Move one generated image between the outputs root (uncategorized) and an
 * album folder. The history record is updated in place; the caller persists.
 */
async function relocateHistoryItem(item, targetAlbumId) {
  const currentRelative =
    normalizeRelativePath(item.relativePath, item.filename) ||
    relativePathForAlbum(item.albumId, item.filename);
  const candidates = [
    ...new Set([
      currentRelative,
      relativePathForAlbum(item.albumId, item.filename),
      item.filename,
    ]),
  ];

  let currentPath = '';
  for (const candidate of candidates) {
    if (!normalizeRelativePath(candidate, item.filename)) continue;
    const absolute = resolveOutputPath(candidate);
    if (await fileExists(absolute)) {
      currentPath = absolute;
      break;
    }
  }
  if (!currentPath) {
    throw new AppError('这条记录的原图文件已不存在。', 404, 'HISTORY_FILE_MISSING');
  }

  const targetRelative = relativePathForAlbum(targetAlbumId, item.filename);
  const targetPath = resolveOutputPath(targetRelative);

  if (path.resolve(currentPath) !== path.resolve(targetPath)) {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    if (await fileExists(targetPath)) {
      throw new AppError('目标画册中已存在同名文件，无法移动。', 409, 'OUTPUT_EXISTS');
    }
    await fs.rename(currentPath, targetPath);
  }

  const previousAlbumId = item.albumId;
  item.relativePath = targetRelative;
  item.url = buildImageUrl(targetRelative);
  item.albumId = targetAlbumId;
  if (previousAlbumId !== targetAlbumId) await cleanupEmptyAlbumDir(previousAlbumId);

  // Keep the sidecar next to the image and refresh both copies so the stored
  // `relativePath` / `albumId` / `url` are accurate after the move.
  if (path.resolve(currentPath) !== path.resolve(targetPath)) {
    const oldSidecar = sidecarPathForImage(currentPath);
    const targetSidecar = sidecarPathForImage(targetPath);
    if (await fileExists(oldSidecar)) {
      await fs.rename(oldSidecar, targetSidecar).catch(async () => {
        await fs.rm(oldSidecar, { force: true }).catch(() => {});
      });
    }
  }
  try {
    await attachMetadataForItem(item);
  } catch (error) {
    console.warn(`[metadata] 移动后刷新元数据失败：${error.message}`);
  }
  return item;
}

async function moveHistoryItemToAlbum(historyId, targetAlbumId) {
  const item = historyItems.find((entry) => entry.id === historyId);
  if (!item) {
    throw new AppError('没有找到这条历史记录，可能已被清理。', 404, 'HISTORY_NOT_FOUND');
  }

  let albumId = null;
  if (targetAlbumId !== null && targetAlbumId !== undefined && targetAlbumId !== '') {
    if (typeof targetAlbumId !== 'string' || !findAlbum(targetAlbumId)) {
      throw new AppError('目标画册不存在，可能已被删除。', 404, 'ALBUM_NOT_FOUND');
    }
    albumId = targetAlbumId;
  }

  const previousAlbumId = item.albumId;
  await relocateHistoryItem(item, albumId);
  await persistHistory();
  if (previousAlbumId !== albumId && clearAlbumCoverForItem(item)) {
    await persistAlbums();
  }
  return item;
}

/* ------------------------------------------------------------------ */
/* Trash (回收站) + prompt library + batch history operations          */
/* ------------------------------------------------------------------ */

function outputCandidatesForItem(item) {
  return [
    ...new Set(
      [
        normalizeRelativePath(item.relativePath, item.filename),
        relativePathForAlbum(item.albumId, item.filename),
        item.filename,
      ].filter(Boolean),
    ),
  ];
}

async function findExistingOutputPath(item) {
  for (const candidate of outputCandidatesForItem(item)) {
    if (!normalizeRelativePath(candidate, item.filename)) continue;
    const absolute = resolveOutputPath(candidate);
    if (await fileExists(absolute)) {
      return { relativePath: candidate, absolutePath: absolute };
    }
  }
  return null;
}

const TRASH_RECORD_ID_RE = /^[a-z0-9][a-z0-9_-]{7,79}$/i;

function normalizeTrashRecord(raw) {
  if (!isPlainObject(raw)) return null;
  const id = asString(raw.id, '').trim().slice(0, 80);
  if (!TRASH_RECORD_ID_RE.test(id)) return null;
  const trashFilename = path.basename(asString(raw.trashFilename, ''));
  if (!trashFilename || trashFilename !== asString(raw.trashFilename, '')) return null;
  const item = normalizeHistoryRecord(raw.item);
  if (!item) return null;
  const deletedAt = new Date(asString(raw.deletedAt, ''));
  return {
    id,
    filename: item.filename,
    trashFilename,
    item,
    deletedAt: Number.isNaN(deletedAt.getTime()) ? new Date().toISOString() : deletedAt.toISOString(),
  };
}

function normalizeTrashList(raw) {
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  const list = [];
  for (const row of rows) {
    const record = normalizeTrashRecord(row);
    if (!record) continue;
    list.push(record);
    if (list.length >= MAX_TRASH) break;
  }
  return list;
}

function publicTrashList() {
  return trashItems.map((record) => ({
    id: record.id,
    filename: record.filename,
    url: `/trash-files/${encodeURIComponent(record.trashFilename)}`,
    deletedAt: record.deletedAt,
    createdAt: record.item.createdAt,
    albumId: record.item.albumId,
    prompt: record.item.prompt,
    width: record.item.width,
    height: record.item.height,
    model: record.item.model,
  }));
}

async function persistTrash() {
  const snapshot = clone(trashItems);
  await queueWrite(() => atomicWriteJson(TRASH_FILE, snapshot));
}

async function uniqueTrashFilename(originalFilename) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `${crypto.randomBytes(6).toString('hex')}-${originalFilename}`;
    if (!(await fileExists(path.join(TRASH_DIR, candidate)))) return candidate;
  }
  throw new AppError('无法为回收站文件生成唯一文件名。', 500, 'TRASH_NAME_CONFLICT');
}

/**
 * Move one gallery image into the hidden trash folder and record how to restore
 * it. The history entry itself is removed by the caller. Returns the trash
 * record, or null when the image file was already gone (nothing to restore).
 */
async function moveHistoryItemToTrash(item) {
  const found = await findExistingOutputPath(item);
  if (!found) return null;

  const trashFilename = await uniqueTrashFilename(item.filename);
  await fs.mkdir(TRASH_DIR, { recursive: true });
  await fs.rename(found.absolutePath, path.join(TRASH_DIR, trashFilename));
  // The sidecar is regenerated from the trash record on restore instead of
  // following the PNG into the hidden folder.
  await removeMetadataSidecarForImage(found.absolutePath);

  const record = {
    id: crypto.randomUUID(),
    filename: item.filename,
    trashFilename,
    item: clone(item),
    deletedAt: new Date().toISOString(),
  };
  trashItems.unshift(record);

  // Keep the trash bounded; the oldest entries are removed for good.
  while (trashItems.length > MAX_TRASH) {
    const overflow = trashItems.pop();
    if (!overflow) break;
    await fs.rm(path.join(TRASH_DIR, overflow.trashFilename), { force: true }).catch(() => {});
  }

  return record;
}

async function deleteHistoryItem(historyId, { permanent = false } = {}) {
  const index = historyItems.findIndex((entry) => entry.id === historyId);
  if (index < 0) {
    throw new AppError('没有找到这条历史记录，可能已被清理。', 404, 'HISTORY_NOT_FOUND');
  }

  const item = historyItems[index];
  let trashed = false;

  if (permanent) {
    for (const candidate of outputCandidatesForItem(item)) {
      if (!normalizeRelativePath(candidate, item.filename)) continue;
      const absolute = resolveOutputPath(candidate);
      await fs.rm(absolute, { force: true }).catch(() => {});
      await removeMetadataSidecarForImage(absolute);
    }
    await fs.rm(path.join(OUTPUTS_DIR, item.filename), { force: true }).catch(() => {});
    await fs
      .rm(sidecarPathForImage(path.join(OUTPUTS_DIR, item.filename)), { force: true })
      .catch(() => {});
  } else {
    const record = await moveHistoryItemToTrash(item);
    trashed = Boolean(record);
    if (!trashed) {
      // The file vanished earlier; just drop the stale index entry.
      await fs.rm(path.join(OUTPUTS_DIR, item.filename), { force: true }).catch(() => {});
    }
  }

  historyItems.splice(index, 1);
  await persistHistory();
  if (trashed) await persistTrash();
  if (clearAlbumCoverForItem(item)) await persistAlbums();
  await cleanupEmptyAlbumDir(item.albumId);
  return { item, trashed };
}

async function batchTrashHistoryItems(rawIds) {
  const ids = Array.isArray(rawIds) ? rawIds : [];
  const unique = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !id) continue;
    if (!unique.includes(id)) unique.push(id);
    if (unique.length >= MAX_BATCH_IDS) break;
  }
  if (unique.length === 0) {
    throw new AppError('请选择要删除的作品。', 400, 'IDS_REQUIRED');
  }

  const trashedIds = [];
  const failed = [];
  let coversChanged = false;

  for (const id of unique) {
    const index = historyItems.findIndex((entry) => entry.id === id);
    if (index < 0) {
      failed.push({ id, message: '没有找到这条历史记录' });
      continue;
    }
    const item = historyItems[index];
    try {
      const record = await moveHistoryItemToTrash(item);
      // Even a stale record whose file already vanished is removed from the
      // gallery; report it as trashed so the client drops the card too.
      trashedIds.push(id);
      if (!record) {
        await fs.rm(path.join(OUTPUTS_DIR, item.filename), { force: true }).catch(() => {});
      }
      historyItems.splice(index, 1);
      if (clearAlbumCoverForItem(item)) coversChanged = true;
      await cleanupEmptyAlbumDir(item.albumId);
    } catch (error) {
      failed.push({ id, message: error.message });
    }
  }

  if (trashedIds.length > 0) await persistHistory();
  if (trashedIds.length > 0) await persistTrash();
  if (coversChanged) await persistAlbums();
  return { trashed: trashedIds, failed };
}

async function restoreTrashItem(trashId) {
  const index = trashItems.findIndex((entry) => entry.id === trashId);
  if (index < 0) {
    throw new AppError('回收站中没有这条记录，可能已被清理。', 404, 'TRASH_NOT_FOUND');
  }

  const record = trashItems[index];
  const source = path.join(TRASH_DIR, record.trashFilename);
  if (!(await fileExists(source))) {
    trashItems.splice(index, 1);
    await persistTrash();
    throw new AppError('回收站中的图片文件已不存在。', 404, 'TRASH_FILE_MISSING');
  }

  const original = record.item;
  const albumId = original.albumId && findAlbum(original.albumId) ? original.albumId : null;
  let filename = original.filename;
  let targetRelative = relativePathForAlbum(albumId, filename);
  let targetAbsolute = resolveOutputPath(targetRelative);

  const originalExtension = path.extname(original.filename).replace('.', '').toLowerCase();
  const extension = originalExtension === 'jpeg' ? 'jpg' : originalExtension || 'png';
  let guard = 0;
  while (await fileExists(targetAbsolute)) {
    filename = makeOutputFilename(extension);
    targetRelative = relativePathForAlbum(albumId, filename);
    targetAbsolute = resolveOutputPath(targetRelative);
    guard += 1;
    if (guard > 20) {
      throw new AppError('无法为恢复的图片生成唯一文件名。', 500, 'OUTPUT_EXISTS');
    }
  }

  await fs.mkdir(path.dirname(targetAbsolute), { recursive: true });
  await fs.rename(source, targetAbsolute);

  const restored = normalizeHistoryRecord({
    ...original,
    id: historyItems.some((entry) => entry.id === original.id)
      ? crypto.randomUUID()
      : original.id,
    filename,
    relativePath: targetRelative,
    albumId,
  });
  if (!restored) {
    throw new AppError('回收站记录已损坏，无法恢复。', 500, 'TRASH_INVALID');
  }

  historyItems.unshift(restored);
  if (historyItems.length > MAX_HISTORY) historyItems = historyItems.slice(0, MAX_HISTORY);
  trashItems.splice(index, 1);
  await persistHistory();
  await persistTrash();
  try {
    await attachMetadataForItem(restored);
  } catch (error) {
    console.warn(`[metadata] 恢复后写入元数据失败：${error.message}`);
  }
  return restored;
}

async function deleteTrashItem(trashId, { keepRecord = false } = {}) {
  const index = trashItems.findIndex((entry) => entry.id === trashId);
  if (index < 0) {
    throw new AppError('回收站中没有这条记录，可能已被清理。', 404, 'TRASH_NOT_FOUND');
  }
  const record = trashItems[index];
  await fs.rm(path.join(TRASH_DIR, record.trashFilename), { force: true }).catch(() => {});
  if (!keepRecord) {
    trashItems.splice(index, 1);
    await persistTrash();
  }
  return record;
}

async function emptyTrash() {
  const count = trashItems.length;
  for (const record of trashItems) {
    await fs.rm(path.join(TRASH_DIR, record.trashFilename), { force: true }).catch(() => {});
  }
  trashItems = [];
  await persistTrash();
  return { deleted: count };
}

/* Prompt library (提示词收藏) ----------------------------------------- */

function normalizePromptRecord(raw) {
  if (!isPlainObject(raw)) return null;
  const name = asString(raw.name, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PROMPT_NAME);
  if (!name) return null;
  const positive = asString(raw.positive, '').trim().slice(0, MAX_RERENDER_PROMPT);
  const negative = asString(raw.negative, '').trim().slice(0, 8_000);
  if (!positive && !negative) return null;
  const createdAt = new Date(asString(raw.createdAt, ''));
  return {
    id: asString(raw.id, '').trim().slice(0, 80) || crypto.randomUUID(),
    name,
    positive,
    negative,
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date().toISOString() : createdAt.toISOString(),
  };
}

function normalizePromptList(raw) {
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.prompts) ? raw.prompts : [];
  const list = [];
  const ids = new Set();
  const names = new Set();
  for (const row of rows) {
    const record = normalizePromptRecord(row);
    if (!record) continue;
    if (ids.has(record.id)) continue;
    const nameKey = record.name.toLowerCase();
    if (names.has(nameKey)) continue;
    ids.add(record.id);
    names.add(nameKey);
    list.push(record);
    if (list.length >= MAX_PROMPTS) break;
  }
  return list;
}

async function persistPrompts() {
  const snapshot = clone(prompts);
  await queueWrite(() => atomicWriteJson(PROMPTS_FILE, snapshot));
}

async function savePrompt(rawBody) {
  const body = isPlainObject(rawBody) ? rawBody : {};
  const name = asString(body.name, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PROMPT_NAME);
  if (!name) {
    throw new AppError('请填写提示词名称。', 400, 'PROMPT_NAME_REQUIRED');
  }
  const positive = asString(body.positive, '').trim().slice(0, MAX_RERENDER_PROMPT);
  const negative = asString(body.negative, '').trim().slice(0, 8_000);
  if (!positive && !negative) {
    throw new AppError('正向与负面提示词至少要填写一项。', 400, 'PROMPT_EMPTY');
  }

  const id = asString(body.id, '').trim().slice(0, 80);
  const existing = id ? prompts.find((entry) => entry.id === id) : null;
  if (id && !existing) {
    throw new AppError('提示词收藏不存在，可能已被删除。', 404, 'PROMPT_NOT_FOUND');
  }
  if (
    prompts.some(
      (entry) => entry.id !== existing?.id && entry.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new AppError(`提示词「${name}」已存在，请换一个名称。`, 409, 'PROMPT_EXISTS');
  }
  if (!existing && prompts.length >= MAX_PROMPTS) {
    throw new AppError(`提示词收藏已达上限（${MAX_PROMPTS} 条）。`, 409, 'PROMPT_LIMIT');
  }

  if (existing) {
    existing.name = name;
    existing.positive = positive;
    existing.negative = negative;
    await persistPrompts();
    return existing;
  }

  const record = {
    id: crypto.randomUUID(),
    name,
    positive,
    negative,
    createdAt: new Date().toISOString(),
  };
  prompts.unshift(record);
  await persistPrompts();
  return record;
}

async function deletePrompt(id) {
  const index = prompts.findIndex((entry) => entry.id === id);
  if (index < 0) {
    throw new AppError('提示词收藏不存在，可能已被删除。', 404, 'PROMPT_NOT_FOUND');
  }
  const [record] = prompts.splice(index, 1);
  await persistPrompts();
  return record;
}

/* History ordering + batch album moves --------------------------------- */

async function reorderHistoryItems(rawIds) {
  const ids = Array.isArray(rawIds) ? rawIds : [];
  const unique = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !id) continue;
    if (!unique.includes(id)) unique.push(id);
    if (unique.length >= MAX_HISTORY) break;
  }
  if (unique.length === 0) {
    throw new AppError('排序列表为空。', 400, 'ORDER_IDS_REQUIRED');
  }

  const byId = new Map(historyItems.map((item) => [item.id, item]));
  const ordered = unique.map((id) => byId.get(id)).filter(Boolean);
  if (ordered.length === 0) {
    throw new AppError('排序列表中没有有效作品。', 400, 'ORDER_IDS_INVALID');
  }

  // The client only sends the items it can see (one album / uncategorized / all).
  // Fill exactly those slots so items outside the filter keep their positions.
  const orderedIds = new Set(ordered.map((item) => item.id));
  const slots = [];
  historyItems.forEach((item, index) => {
    if (orderedIds.has(item.id)) slots.push(index);
  });
  slots.forEach((slot, offset) => {
    historyItems[slot] = ordered[offset];
  });

  await persistHistory();
  return clone(historyItems);
}

async function moveHistoryItemsToAlbum(rawIds, rawAlbumId) {
  const ids = Array.isArray(rawIds) ? rawIds : [];
  const unique = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !id) continue;
    if (!unique.includes(id)) unique.push(id);
    if (unique.length >= MAX_BATCH_IDS) break;
  }
  if (unique.length === 0) {
    throw new AppError('请选择要移动的作品。', 400, 'IDS_REQUIRED');
  }

  let albumId = null;
  if (rawAlbumId !== null && rawAlbumId !== undefined && rawAlbumId !== '') {
    if (typeof rawAlbumId !== 'string' || !findAlbum(rawAlbumId)) {
      throw new AppError('目标画册不存在，可能已被删除。', 404, 'ALBUM_NOT_FOUND');
    }
    albumId = rawAlbumId;
  }

  const moved = [];
  const failed = [];
  let coversChanged = false;
  for (const id of unique) {
    const item = historyItems.find((entry) => entry.id === id);
    if (!item) {
      failed.push({ id, message: '没有找到这条历史记录' });
      continue;
    }
    const previousAlbumId = item.albumId;
    try {
      await relocateHistoryItem(item, albumId);
      moved.push(item);
      if (previousAlbumId !== albumId && clearAlbumCoverForItem(item)) coversChanged = true;
    } catch (error) {
      failed.push({ id, message: error.message });
    }
  }

  if (moved.length > 0) await persistHistory();
  if (coversChanged) await persistAlbums();
  return { items: clone(moved), moved: moved.length, failed };
}

async function deleteAlbum(albumId) {
  const album = findAlbum(albumId);
  if (!album) {
    throw new AppError('画册不存在，可能已被删除。', 404, 'ALBUM_NOT_FOUND');
  }

  const affected = historyItems.filter((item) => item.albumId === albumId);
  const errors = [];
  let moved = 0;
  for (const item of affected) {
    try {
      await relocateHistoryItem(item, null);
      moved += 1;
    } catch (error) {
      errors.push(`${item.filename}: ${error.message}`);
    }
  }
  if (moved > 0) await persistHistory();
  if (errors.length > 0) {
    throw new AppError(
      `画册中部分图片移动失败，画册未删除：${errors.slice(0, 3).join('；')}`,
      500,
      'ALBUM_DELETE_FAILED',
    );
  }

  // Files that are not in the history index still belong to the user; move them
  // to the unclassified root instead of deleting them with the folder.
  const rescued = await rescueUnindexedAlbumFiles(albumId);

  albums = albums.filter((entry) => entry.id !== albumId);
  await persistAlbums();
  // Only remove the directory when it is actually empty.
  await fs.rmdir(albumDirectory(albumId)).catch(() => {});
  return { deleted: albumId, moved, rescued };
}

/* ------------------------------------------------------------------ */
/* Generation pipeline                                                 */
/* ------------------------------------------------------------------ */

function emitStage(onStage, payload) {
  try {
    onStage?.(payload);
  } catch (error) {
    console.warn('[stream] 阶段事件发送失败：', error.message);
  }
}

function makeOutputFilename(extension) {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `nai-${date}-${time}-${crypto.randomBytes(3).toString('hex')}.${extension}`;
}

async function renderWithNovelAi(novai, prompt, onStage = () => {}, { albumId = null, signal } = {}) {
  emitStage(onStage, {
    stage: 'nai',
    message: '正在调用 NovelAI 生图…',
    progress: 45,
  });

  const { raw, seed, contentType } = await requestNovelAi(novai, prompt, signal);

  emitStage(onStage, {
    stage: 'unzip',
    message: '正在从 NovelAI ZIP 中解压图片…',
    progress: 82,
  });

  const image = extractImageFromNaiResponse(raw, contentType);
  const filename = makeOutputFilename(image.extension);
  const relativePath = relativePathForAlbum(albumId, filename);
  const absolutePath = resolveOutputPath(relativePath);

  emitStage(onStage, {
    stage: 'save',
    message: albumId ? '正在保存图片到画册文件夹…' : '正在保存图片到本地 outputs/…',
    progress: 94,
  });

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, image.buffer);
  return { filename, relativePath, albumId, seed };
}

function makeHistoryRecord({
  filename,
  relativePath,
  albumId = null,
  parentId = '',
  recordId = '',
  variantId = '',
  userText = '',
  prompt,
  llmTags,
  novai,
  seed,
  llmProvider,
  llmModel,
  startedAt,
}) {
  const safeRelativePath = relativePath || relativePathForAlbum(albumId, filename);
  return {
    id: crypto.randomUUID(),
    filename,
    relativePath: safeRelativePath,
    url: buildImageUrl(safeRelativePath),
    albumId,
    parentId,
    recordId,
    variantId,
    userText,
    prompt,
    llmTags,
    negativePrompt: novai.negativePrompt,
    model: novai.model,
    sampler: novai.sampler,
    noiseSchedule: novai.noiseSchedule,
    steps: novai.steps,
    scale: novai.scale,
    cfgRescale: novai.cfgRescale,
    width: novai.width,
    height: novai.height,
    seed,
    qualityToggle: novai.qualityToggle,
    llmProvider,
    llmModel,
    createdAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
  };
}

function resolveTargetAlbumId(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;
  if (typeof rawValue !== 'string' || !findAlbum(rawValue)) {
    throw new AppError('目标画册不存在，可能已被删除。', 404, 'ALBUM_NOT_FOUND');
  }
  return rawValue;
}

async function runGeneration(userText, onStage = () => {}, { albumId = null, signal } = {}) {
  const startedAt = Date.now();
  const cfg = clone(activeConfig);
  const text = asString(userText, '').trim();

  if (!cfg.novelai.apiKey) {
    throw new AppError('还没有配置 NovelAI API Key，请先在左侧填写并保存。', 400, 'NAI_API_KEY_MISSING');
  }

  const targetAlbumId = resolveTargetAlbumId(albumId);
  let record = findRecordByText(text);
  let variant = record?.variants?.[record.variants.length - 1] || null;
  let usedExistingVariant = Boolean(record && variant && variant.llmTags);

  if (!usedExistingVariant) {
    if (!cfg.llm.apiKey) {
      throw new AppError('还没有配置 LLM API Key，请先在左侧填写并保存。', 400, 'LLM_API_KEY_MISSING');
    }

    emitStage(onStage, {
      stage: 'llm',
      message: '正在请求 LLM 生成 Danbooru 标签…',
      progress: 15,
    });

    const generated = await generateTagsWithOpenAi(cfg.llm, text, signal);
    if (record) {
      variant = await appendRecordVariant(record, {
        title: generated.title,
        llmTags: generated.tags,
        llmModel: cfg.llm.model,
      });
    } else {
      ({ record, variant } = await createRecordWithVariant(text, {
        title: generated.title,
        llmTags: generated.tags,
        llmModel: cfg.llm.model,
      }));
    }
  } else {
    emitStage(onStage, {
      stage: 'nai',
      message: '已匹配到同名记录，沿用当前 Tag 版本生成新图…',
      progress: 25,
    });
  }

  const finalPrompt = buildFinalPrompt(cfg.novelai, variant.llmTags);
  if (!finalPrompt) {
    throw new AppError('最终提示词为空，请检查基础提示词与 LLM 输出。', 400, 'EMPTY_PROMPT');
  }

  const { filename, relativePath, seed } = await renderWithNovelAi(
    cfg.novelai,
    finalPrompt,
    onStage,
    { albumId: targetAlbumId, signal },
  );

  const recordItem = makeHistoryRecord({
    filename,
    relativePath,
    albumId: targetAlbumId,
    recordId: record.id,
    variantId: variant.id,
    userText: record.userText,
    prompt: finalPrompt,
    llmTags: variant.llmTags,
    novai: cfg.novelai,
    seed,
    llmProvider: 'openai',
    llmModel: variant.llmModel || cfg.llm.model,
    startedAt,
  });

  await addHistoryRecord(recordItem);
  record.updatedAt = new Date().toISOString();
  try {
    await persistRecords();
  } catch (error) {
    console.warn(`[records] 更新记录失败：${error.message}`);
  }
  // Best effort: the image is already saved and listed even if metadata export
  // fails (for example a read-only disk hiccup).
  try {
    await attachMetadataForItem(recordItem);
  } catch (error) {
    console.warn(`[metadata] 生成后写入元数据失败：${error.message}`);
  }
  return recordItem;
}

async function rerollRecordVariant(recordId, onStage = () => {}, { signal } = {}) {
  const cfg = clone(activeConfig);
  const record = findRecordById(recordId);
  if (!record) {
    throw new AppError('没有找到这条记录，可能已被清理。', 404, 'RECORD_NOT_FOUND');
  }
  if (!record.userText) {
    throw new AppError('这条旧记录没有保存原始输入，无法重 roll Tags。', 400, 'RECORD_TEXT_MISSING');
  }
  if (!cfg.llm.apiKey) {
    throw new AppError('还没有配置 LLM API Key，请先在左侧填写并保存。', 400, 'LLM_API_KEY_MISSING');
  }

  emitStage(onStage, {
    stage: 'llm',
    message: '正在重新生成 Tag 版本…',
    progress: 30,
  });

  const generated = await generateTagsWithOpenAi(cfg.llm, record.userText, signal);
  const variant = await appendRecordVariant(record, {
    title: generated.title,
    llmTags: generated.tags,
    llmModel: cfg.llm.model,
  });

  return {
    record: publicRecord(record),
    variant: clone(variant),
  };
}

async function renderRecordVariant(
  recordId,
  variantId,
  onStage = () => {},
  { albumId = null, signal } = {},
) {
  const startedAt = Date.now();
  const cfg = clone(activeConfig);
  if (!cfg.novelai.apiKey) {
    throw new AppError('还没有配置 NovelAI API Key，请先在左侧填写并保存。', 400, 'NAI_API_KEY_MISSING');
  }

  const record = findRecordById(recordId);
  if (!record) {
    throw new AppError('没有找到这条记录，可能已被清理。', 404, 'RECORD_NOT_FOUND');
  }
  const variant = record.variants.find((entry) => entry.id === variantId);
  if (!variant) {
    throw new AppError('没有找到这个 Tag 版本。', 404, 'VARIANT_NOT_FOUND');
  }

  const targetAlbumId = resolveTargetAlbumId(albumId);
  const finalPrompt = buildFinalPrompt(cfg.novelai, variant.llmTags);
  if (!finalPrompt) {
    throw new AppError('最终提示词为空，请检查基础提示词与该 Tag 版本。', 400, 'EMPTY_PROMPT');
  }

  const { filename, relativePath, seed } = await renderWithNovelAi(
    cfg.novelai,
    finalPrompt,
    onStage,
    { albumId: targetAlbumId, signal },
  );

  const item = makeHistoryRecord({
    filename,
    relativePath,
    albumId: targetAlbumId,
    recordId: record.id,
    variantId: variant.id,
    userText: record.userText,
    prompt: finalPrompt,
    llmTags: variant.llmTags,
    novai: cfg.novelai,
    seed,
    llmProvider: 'openai',
    llmModel: variant.llmModel || cfg.llm.model,
    startedAt,
  });

  await addHistoryRecord(item);
  record.updatedAt = new Date().toISOString();
  try {
    await persistRecords();
  } catch (error) {
    console.warn(`[records] 更新记录失败：${error.message}`);
  }
  try {
    await attachMetadataForItem(item);
  } catch (error) {
    console.warn(`[metadata] 生成后写入元数据失败：${error.message}`);
  }
  return item;
}

/**
 * Re-render one history item with its stored tags and sampling parameters,
 * skipping the LLM. `seedMode: 'same'` reproduces the original seed, anything
 * else uses a fresh random seed for a variation.
 */
async function rerenderFromHistory(historyId, options = {}, onStage = () => {}, { signal } = {}) {
  const startedAt = Date.now();
  const cfg = clone(activeConfig);
  const body = isPlainObject(options) ? options : {};

  if (!cfg.novelai.apiKey) {
    throw new AppError('还没有配置 NovelAI API Key，请先在左侧填写并保存。', 400, 'NAI_API_KEY_MISSING');
  }

  const source = historyItems.find((item) => item.id === historyId);
  if (!source) {
    throw new AppError('没有找到这条历史记录，可能已被清理。', 404, 'HISTORY_NOT_FOUND');
  }
  if (!source.prompt) {
    throw new AppError('这条历史记录没有保存最终 Tag，无法重绘。', 400, 'HISTORY_PROMPT_MISSING');
  }

  const ensured = ensureRecordForHistoryItem(source);
  const recordEntity = ensured.record;
  let variant = ensured.variant;
  if (ensured.changed) {
    await persistRecords();
    await persistHistory();
  }

  const sourceRelative =
    normalizeRelativePath(source.relativePath, source.filename) ||
    relativePathForAlbum(source.albumId, source.filename);
  const sourceExists =
    (await fileExists(resolveOutputPath(sourceRelative))) ||
    (await fileExists(path.join(OUTPUTS_DIR, source.filename)));
  if (!sourceExists) {
    throw new AppError('这条记录的原图文件已不存在。', 404, 'HISTORY_FILE_MISSING');
  }

  let prompt = source.prompt;
  if (typeof body.prompt === 'string') {
    prompt = body.prompt.trim().slice(0, MAX_RERENDER_PROMPT);
    if (!prompt) {
      throw new AppError('重画提示词不能为空。', 400, 'EMPTY_PROMPT');
    }
  }

  if (prompt !== source.prompt) {
    variant = await appendRecordVariant(recordEntity, {
      title: `手动编辑 · ${variant.title || 'Tag 版本'}`,
      llmTags: prompt,
      source: 'manual',
      llmModel: source.llmModel,
    });
  }

  const seedMode = body.seedMode === 'same' ? 'same' : 'new';
  const negativePrompt =
    typeof body.negativePrompt === 'string'
      ? body.negativePrompt.slice(0, 8_000)
      : source.negativePrompt;
  const model =
    typeof body.model === 'string' && body.model.trim()
      ? body.model.trim().slice(0, 120)
      : source.model || cfg.novelai.model;
  const sampler = NAI_SAMPLERS.has(body.sampler) ? body.sampler : source.sampler;
  const noiseSchedule = NOISE_SCHEDULES.has(body.noiseSchedule)
    ? body.noiseSchedule
    : source.noiseSchedule;

  const numeric = (value, fallback) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;

  let targetAlbumId = source.albumId && findAlbum(source.albumId) ? source.albumId : null;
  if (Object.prototype.hasOwnProperty.call(body, 'albumId')) {
    targetAlbumId = resolveTargetAlbumId(body.albumId);
  }

  // Reproduce the stored generation settings, but keep the current endpoint
  // and credential so the request still goes to the configured account.
  const novai = normalizeConfig({
    novelai: {
      ...cfg.novelai,
      model,
      sampler,
      noiseSchedule,
      steps: numeric(body.steps, source.steps),
      scale: numeric(body.scale, source.scale),
      cfgRescale: numeric(body.cfgRescale, source.cfgRescale),
      width: numeric(body.width, source.width),
      height: numeric(body.height, source.height),
      qualityToggle:
        typeof body.qualityToggle === 'boolean' ? body.qualityToggle : source.qualityToggle,
      negativePrompt,
      seed: seedMode === 'same' ? source.seed : -1,
    },
  }).novelai;

  const { filename, relativePath, seed } = await renderWithNovelAi(
    novai,
    prompt,
    onStage,
    { albumId: targetAlbumId, signal },
  );

  const record = makeHistoryRecord({
    filename,
    relativePath,
    albumId: targetAlbumId,
    parentId: source.id,
    recordId: recordEntity.id,
    variantId: variant.id,
    userText: recordEntity.userText,
    prompt,
    llmTags: variant.llmTags,
    novai,
    seed,
    llmProvider: source.llmProvider,
    llmModel: source.llmModel,
    startedAt,
  });

  await addHistoryRecord(record);
  recordEntity.updatedAt = new Date().toISOString();
  try {
    await persistRecords();
  } catch (error) {
    console.warn(`[records] 更新记录失败：${error.message}`);
  }
  // Best effort: the image is already saved and listed even if metadata export
  // fails (for example a read-only disk hiccup).
  try {
    await attachMetadataForItem(record);
  } catch (error) {
    console.warn(`[metadata] 生成后写入元数据失败：${error.message}`);
  }
  return record;
}

/* ------------------------------------------------------------------ */
/* Generation job queue + cancellation                                 */
/* ------------------------------------------------------------------ */

const jobs = []; // newest first
const jobQueue = []; // ids waiting, oldest first
const jobWaiters = new Map(); // job id -> Set<resolve>
let runningJob = null;
let queueProcessing = false;

function findJob(jobId) {
  return jobs.find((job) => job.id === jobId) || null;
}

function jobQueuePosition(job) {
  if (job.status !== 'queued') return 0;
  const index = jobQueue.indexOf(job.id);
  return index >= 0 ? index + 1 : 0;
}

function publicJob(job) {
  const now = Date.now();
  return {
    id: job.id,
    kind: job.kind,
    label: job.label,
    status: job.status,
    stage: job.stage,
    message: job.message,
    progress: job.progress,
    albumId: job.albumId,
    text: job.text.length > 120 ? `${job.text.slice(0, 120)}…` : job.text,
    historyId: job.historyId,
    recordId: job.recordId,
    variantId: job.variantId,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    elapsedMs: Math.max(0, (job.finishedAt || now) - (job.startedAt || job.createdAt)),
    position: jobQueuePosition(job),
    queueLength: jobQueue.length,
    result: job.result ? clone(job.result) : null,
    error: job.error ? { ...job.error } : null,
  };
}

function publicJobList() {
  return {
    jobs: jobs.map(publicJob),
    running: runningJob ? publicJob(runningJob) : null,
    queueLength: jobQueue.length,
    limits: {
      llmTimeoutSeconds: activeConfig.llm.timeoutSeconds,
      naiTimeoutSeconds: activeConfig.novelai.timeoutSeconds,
    },
  };
}

function trimJobHistory() {
  while (jobs.length > MAX_JOB_HISTORY) {
    let oldestFinished = -1;
    for (let index = jobs.length - 1; index >= 0; index -= 1) {
      const status = jobs[index].status;
      if (status !== 'queued' && status !== 'running') {
        oldestFinished = index;
        break;
      }
    }
    if (oldestFinished < 0) break;
    jobs.splice(oldestFinished, 1);
  }
}

function createJob(spec) {
  const kind = ['rerender', 'reroll', 'render'].includes(spec.kind)
    ? spec.kind
    : 'generate';
  const label =
    kind === 'rerender'
      ? '重画作品'
      : kind === 'reroll'
        ? '重 Roll Tags'
        : kind === 'render'
          ? '记录生图'
          : '文生图';
  const job = {
    id: crypto.randomUUID(),
    kind,
    label,
    status: 'queued',
    stage: 'queued',
    message: '等待开始…',
    progress: 0,
    albumId: spec.albumId ?? null,
    text: asString(spec.text, '').slice(0, MAX_INPUT_CHARS),
    historyId: asString(spec.historyId, ''),
    recordId: asString(spec.recordId, ''),
    variantId: asString(spec.variantId, ''),
    options: kind === 'rerender' && isPlainObject(spec.options) ? clone(spec.options) : null,
    createdAt: Date.now(),
    startedAt: 0,
    finishedAt: 0,
    result: null,
    error: null,
    errorStatus: 0,
    canceled: false,
    controller: null,
    listeners: new Set(),
  };
  jobs.unshift(job);
  trimJobHistory();
  return job;
}

function jobStagePayload(job) {
  return {
    stage: job.stage,
    message: job.message,
    progress: job.progress,
  };
}

function emitJobStage(job, stage) {
  if (Number.isFinite(Number(stage?.progress))) job.progress = Number(stage.progress);
  if (typeof stage?.stage === 'string' && stage.stage) job.stage = stage.stage;
  if (typeof stage?.message === 'string' && stage.message) job.message = stage.message;
  for (const listener of job.listeners) {
    try {
      listener('stage', jobStagePayload(job));
    } catch {
      /* listener errors must not break generation */
    }
  }
}

function notifyJobFinished(job) {
  const waiters = jobWaiters.get(job.id);
  if (waiters) {
    jobWaiters.delete(job.id);
    for (const resolve of waiters) {
      try {
        resolve(job);
      } catch {
        /* ignore */
      }
    }
  }
  for (const listener of job.listeners) {
    try {
      listener('finish', publicJob(job));
    } catch {
      /* ignore */
    }
  }
}

function waitForJob(job) {
  if (job.status === 'done' || job.status === 'error' || job.status === 'canceled') {
    return Promise.resolve(job);
  }
  return new Promise((resolve) => {
    let set = jobWaiters.get(job.id);
    if (!set) {
      set = new Set();
      jobWaiters.set(job.id, set);
    }
    set.add(resolve);
  });
}

function refreshQueuedMessages() {
  jobQueue.forEach((id, index) => {
    const job = findJob(id);
    if (!job || job.status !== 'queued') return;
    job.message = index === 0 ? '即将开始…' : `排队中 · 前方还有 ${index} 个任务`;
  });
}

async function runJob(job) {
  runningJob = job;
  job.status = 'running';
  job.stage = 'start';
  job.message = '正在启动…';
  job.progress = 2;
  job.startedAt = Date.now();
  job.controller = new AbortController();
  const signal = job.controller.signal;

  try {
    let result;
    if (job.kind === 'rerender') {
      result = await rerenderFromHistory(job.historyId, job.options || {}, (stage) => {
        emitJobStage(job, stage);
      }, { signal });
    } else if (job.kind === 'reroll') {
      result = await rerollRecordVariant(job.recordId, (stage) => {
        emitJobStage(job, stage);
      }, { signal });
    } else if (job.kind === 'render') {
      result = await renderRecordVariant(job.recordId, job.variantId, (stage) => {
        emitJobStage(job, stage);
      }, { albumId: job.albumId, signal });
    } else {
      result = await runGeneration(job.text, (stage) => {
        emitJobStage(job, stage);
      }, { albumId: job.albumId, signal });
    }

    // A late cancel that arrives after the file was written is ignored: the
    // work really completed, and reporting "canceled" would hide a saved image.
    job.status = 'done';
    job.stage = 'done';
    job.message = '生成完成';
    job.progress = 100;
    job.result = result;
  } catch (error) {
    if (job.canceled || isCancelError(error) || error?.code === 'CANCELED') {
      job.status = 'canceled';
      job.stage = 'canceled';
      job.message = '已取消';
      job.error = { message: '生成已取消。', code: 'CANCELED' };
    } else {
      const info = publicErrorInfo(error);
      job.status = 'error';
      job.stage = 'error';
      job.message = info.message;
      job.error = { message: info.message, code: info.code };
      job.errorStatus = info.status;
    }
  } finally {
    job.finishedAt = Date.now();
    job.controller = null;
    if (runningJob === job) runningJob = null;
    notifyJobFinished(job);
  }
}

async function processQueue() {
  if (queueProcessing) return;
  queueProcessing = true;
  try {
    while (jobQueue.length > 0) {
      const id = jobQueue.shift();
      const job = findJob(id);
      if (!job || job.status !== 'queued') {
        refreshQueuedMessages();
        continue;
      }
      try {
        await runJob(job);
      } catch (error) {
        // runJob handles its own errors; this is a last-resort guard so one
        // broken job can never wedge the queue.
        console.error('[jobs] 任务执行异常：', error);
        job.status = 'error';
        job.stage = 'error';
        job.message = '任务执行异常。';
        job.error = { message: '任务执行异常，请查看服务端日志。', code: 'JOB_FAILED' };
        job.errorStatus = 500;
        job.finishedAt = Date.now();
        if (runningJob === job) runningJob = null;
        notifyJobFinished(job);
      }
      refreshQueuedMessages();
    }
  } finally {
    queueProcessing = false;
    if (jobQueue.length > 0) setImmediate(() => processQueue());
  }
}

function enqueueJob(job) {
  job.status = 'queued';
  job.stage = 'queued';
  job.progress = 0;
  job.message = '等待开始…';
  jobQueue.push(job.id);
  refreshQueuedMessages();
  // Start on the next tick so SSE callers can subscribe to stage events first.
  setImmediate(() => processQueue());
  return job;
}

function cancelJob(jobId) {
  const job = findJob(jobId);
  if (!job) {
    throw new AppError('任务不存在，可能已完成或被清理。', 404, 'JOB_NOT_FOUND');
  }

  if (job.status === 'queued') {
    const index = jobQueue.indexOf(job.id);
    if (index >= 0) jobQueue.splice(index, 1);
    job.canceled = true;
    job.status = 'canceled';
    job.stage = 'canceled';
    job.message = '已取消';
    job.progress = 0;
    job.error = { message: '生成已取消。', code: 'CANCELED' };
    job.finishedAt = Date.now();
    refreshQueuedMessages();
    notifyJobFinished(job);
  } else if (job.status === 'running' && !job.canceled) {
    job.canceled = true;
    job.message = '正在取消当前生成…';
    job.stage = 'canceling';
    if (job.controller) job.controller.abort();
  }
  return job;
}

function dismissJob(jobId) {
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index < 0) {
    throw new AppError('任务不存在，可能已完成或被清理。', 404, 'JOB_NOT_FOUND');
  }
  const job = jobs[index];
  if (job.status === 'queued' || job.status === 'running') {
    throw new AppError('任务仍在进行中，请先取消。', 409, 'JOB_ACTIVE');
  }
  jobs.splice(index, 1);
  return job;
}

/* ------------------------------------------------------------------ */
/* Express app                                                         */
/* ------------------------------------------------------------------ */

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

const LOCAL_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || LOCAL_ORIGIN_RE.test(origin)) {
        callback(null, true);
        return;
      }
      const error = new Error('仅允许来自 localhost 的跨域请求。');
      error.statusCode = 403;
      error.code = 'CORS_FORBIDDEN';
      error.expose = true;
      callback(error);
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    maxAge: 600,
  }),
);

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function publicErrorInfo(error) {
  if (error instanceof AppError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error?.expose && Number.isInteger(error?.statusCode)) {
    return {
      status: error.statusCode,
      code: error.code || 'REQUEST_ERROR',
      message: error.message || '请求被拒绝。',
    };
  }
  console.error('[server] 未处理错误：', error);
  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: '服务器内部错误，请查看运行终端中的日志。',
  };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: APP_VERSION, storageReady });
});

app.get('/api/config', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ config: clone(activeConfig) });
});

app.post(
  '/api/config',
  asyncRoute(async (req, res) => {
    const config = await saveConfig(req.body);
    res.json({ config, savedAt: new Date().toISOString() });
  }),
);

app.get(
  '/api/history',
  asyncRoute(async (req, res) => {
    const items = clone(historyItems).filter((item) =>
      OUTPUT_FILENAME_RE.test(item.filename),
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json({ items });
  }),
);

app.get(
  '/api/records',
  asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ records: publicRecordList() });
  }),
);

app.get(
  '/api/records/:id',
  asyncRoute(async (req, res) => {
    const record = findRecordById(req.params.id);
    if (!record) {
      throw new AppError('没有找到这条记录，可能已被清理。', 404, 'RECORD_NOT_FOUND');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ record: publicRecord(record) });
  }),
);

app.patch(
  '/api/records/:id/variants/:variantId',
  asyncRoute(async (req, res) => {
    const { record, variant } = await updateRecordVariant(
      req.params.id,
      req.params.variantId,
      req.body,
    );
    res.json({
      record: publicRecord(record),
      variant: clone(variant),
    });
  }),
);

app.get(
  '/api/albums',
  asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ albums: publicAlbumList() });
  }),
);

app.post(
  '/api/albums',
  asyncRoute(async (req, res) => {
    const album = await createAlbum(req.body?.name);
    res.status(201).json({ album, albums: publicAlbumList() });
  }),
);

app.post(
  '/api/albums/:id',
  asyncRoute(async (req, res) => {
    const album = await renameAlbum(req.params.id, req.body?.name);
    res.json({ album, albums: publicAlbumList() });
  }),
);

app.post(
  '/api/albums/:id/cover',
  asyncRoute(async (req, res) => {
    const album = await setAlbumCover(req.params.id, req.body?.historyId ?? null);
    res.json({ album, albums: publicAlbumList() });
  }),
);

app.delete(
  '/api/albums/:id',
  asyncRoute(async (req, res) => {
    const result = await deleteAlbum(req.params.id);
    res.json({ ...result, albums: publicAlbumList() });
  }),
);

app.post(
  '/api/history/:id/album',
  asyncRoute(async (req, res) => {
    const item = await moveHistoryItemToAlbum(req.params.id, req.body?.albumId ?? null);
    res.json({ item: clone(item) });
  }),
);

app.delete(
  '/api/history/:id',
  asyncRoute(async (req, res) => {
    const result = await deleteHistoryItem(req.params.id, {
      permanent: req.query.permanent === '1',
    });
    res.json({
      deleted: result.item.id,
      filename: result.item.filename,
      trashed: result.trashed,
    });
  }),
);

app.post(
  '/api/history/order',
  asyncRoute(async (req, res) => {
    const items = await reorderHistoryItems(req.body?.ids);
    res.json({ items });
  }),
);

app.post(
  '/api/history/batch-album',
  asyncRoute(async (req, res) => {
    const result = await moveHistoryItemsToAlbum(req.body?.ids, req.body?.albumId ?? null);
    res.json({ ...result, albums: publicAlbumList() });
  }),
);

app.post(
  '/api/history/batch-delete',
  asyncRoute(async (req, res) => {
    const result = await batchTrashHistoryItems(req.body?.ids);
    res.json({ ...result, albums: publicAlbumList() });
  }),
);

/* Metadata export (PNG text chunks + sidecar JSON) ---------------------- */

app.get(
  '/api/history/:id/metadata',
  asyncRoute(async (req, res) => {
    const item = historyItems.find((entry) => entry.id === req.params.id);
    if (!item) {
      throw new AppError('没有找到这条历史记录，可能已被清理。', 404, 'HISTORY_NOT_FOUND');
    }
    const metadata = buildMetadataSnapshot(item);
    if (req.query.download === '1') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${sidecarNameForFilename(item.filename)}"`,
      );
      res.send(`${JSON.stringify(metadata, null, 2)}\n`);
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ metadata });
  }),
);

app.post(
  '/api/metadata/sync',
  asyncRoute(async (req, res) => {
    const result = await syncMetadataBatch(req.body?.ids);
    res.json(result);
  }),
);

app.get(
  '/api/metadata/archive',
  asyncRoute(async (req, res) => {
    const { buffer, count } = buildMetadataArchive();
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="nai-atelier-metadata-${stamp}.zip"`,
    );
    res.setHeader('X-Metadata-Count', String(count));
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }),
);

/* Trash (回收站) ------------------------------------------------------- */

app.get(
  '/api/trash',
  asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ items: publicTrashList() });
  }),
);

app.post(
  '/api/trash/:id/restore',
  asyncRoute(async (req, res) => {
    const item = await restoreTrashItem(req.params.id);
    res.json({ item: clone(item), items: publicTrashList() });
  }),
);

app.delete(
  '/api/trash/:id',
  asyncRoute(async (req, res) => {
    const record = await deleteTrashItem(req.params.id);
    res.json({ deleted: record.id, items: publicTrashList() });
  }),
);

app.delete(
  '/api/trash',
  asyncRoute(async (req, res) => {
    const result = await emptyTrash();
    res.json({ ...result, items: [] });
  }),
);

/* Prompt library (提示词收藏) ----------------------------------------- */

app.get(
  '/api/prompts',
  asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ prompts: clone(prompts) });
  }),
);

app.post(
  '/api/prompts',
  asyncRoute(async (req, res) => {
    const prompt = await savePrompt(req.body);
    res.json({ prompt: clone(prompt), prompts: clone(prompts) });
  }),
);

app.delete(
  '/api/prompts/:id',
  asyncRoute(async (req, res) => {
    const prompt = await deletePrompt(req.params.id);
    res.json({ deleted: prompt.id, prompts: clone(prompts) });
  }),
);

/* Generation job queue ------------------------------------------------- */

app.get(
  '/api/jobs',
  asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(publicJobList());
  }),
);

app.post(
  '/api/jobs',
  asyncRoute(async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {};
    let spec;
    if (body.kind === 'rerender') {
      spec = { kind: 'rerender', historyId: asString(body.historyId, ''), options: body };
    } else if (body.kind === 'reroll') {
      spec = rerollJobSpec(body);
    } else if (body.kind === 'render') {
      spec = renderRecordJobSpec(body);
    } else {
      spec = generateJobSpec(body);
    }
    const job = enqueueJob(createJob(spec));
    res.status(202).json({ job: publicJob(job), queueLength: jobQueue.length });
  }),
);

app.post(
  '/api/jobs/cancel-all',
  asyncRoute(async (req, res) => {
    const queued = [...jobQueue];
    for (const id of queued) {
      try {
        cancelJob(id);
      } catch {
        /* already gone */
      }
    }
    res.json(publicJobList());
  }),
);

app.post(
  '/api/jobs/:id/cancel',
  asyncRoute(async (req, res) => {
    const job = cancelJob(req.params.id);
    res.json({ job: publicJob(job), ...publicJobList() });
  }),
);

app.delete(
  '/api/jobs/:id',
  asyncRoute(async (req, res) => {
    const job = dismissJob(req.params.id);
    res.json({ deleted: job.id, ...publicJobList() });
  }),
);

function wantsEventStream(req) {
  return (
    String(req.get('accept') || '').includes('text/event-stream') ||
    req.query.stream === '1'
  );
}

function resolveJobAlbumId(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;
  if (typeof rawValue !== 'string' || !findAlbum(rawValue)) {
    throw new AppError('目标画册不存在，可能已被删除。', 404, 'ALBUM_NOT_FOUND');
  }
  return rawValue;
}

function generateJobSpec(body) {
  const source = isPlainObject(body) ? body : {};
  const text = typeof source.text === 'string' ? source.text.trim() : '';
  if (!text) {
    throw new AppError('请输入画面描述后再生成。', 400, 'EMPTY_INPUT');
  }
  if (text.length > MAX_INPUT_CHARS) {
    throw new AppError(
      `输入内容过长，最多支持 ${MAX_INPUT_CHARS} 个字符。`,
      400,
      'INPUT_TOO_LONG',
    );
  }
  return { kind: 'generate', text, albumId: resolveJobAlbumId(source.albumId) };
}

function rerollJobSpec(body) {
  const source = isPlainObject(body) ? body : {};
  const recordId = asString(source.recordId, '').trim();
  const record = recordId ? findRecordById(recordId) : null;
  if (!record) {
    throw new AppError('没有找到这条记录，可能已被清理。', 404, 'RECORD_NOT_FOUND');
  }
  if (!record.userText) {
    throw new AppError('这条旧记录没有保存原始输入，无法重 roll Tags。', 400, 'RECORD_TEXT_MISSING');
  }
  return { kind: 'reroll', recordId: record.id, text: record.userText };
}

function renderRecordJobSpec(body) {
  const source = isPlainObject(body) ? body : {};
  const recordId = asString(source.recordId, '').trim();
  const variantId = asString(source.variantId, '').trim();
  const record = recordId ? findRecordById(recordId) : null;
  if (!record) {
    throw new AppError('没有找到这条记录，可能已被清理。', 404, 'RECORD_NOT_FOUND');
  }
  const variant = variantId
    ? record.variants.find((entry) => entry.id === variantId)
    : null;
  if (!variant) {
    throw new AppError('没有找到这个 Tag 版本。', 404, 'VARIANT_NOT_FOUND');
  }
  return {
    kind: 'render',
    recordId: record.id,
    variantId: variant.id,
    text: record.userText,
    albumId: resolveJobAlbumId(source.albumId),
  };
}

/**
 * Queues one generation job and replies with either JSON or POST SSE progress.
 * Both legacy endpoints and the queue-aware frontend go through the same
 * single-concurrency queue, so a slow NovelAI request is never doubled up.
 */
async function respondWithJob(req, res, spec) {
  if (!wantsEventStream(req)) {
    const job = enqueueJob(createJob(spec));
    const finished = await waitForJob(job);
    if (finished.status === 'done') {
      res.json({ result: finished.result });
      return;
    }
    const info = finished.error || { message: '生成失败。', code: 'GENERATE_FAILED' };
    const status = finished.status === 'canceled' ? 499 : finished.errorStatus || 500;
    res.status(status).json({ error: { message: info.message, code: info.code } });
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  if (res.socket) res.socket.setNoDelay(true);

  let clientClosed = false;
  let heartbeat = null;
  let finished = false;
  const job = createJob(spec);

  const writeChunk = (chunk) => {
    if (clientClosed || res.writableEnded) return;
    try {
      res.write(chunk);
    } catch {
      clientClosed = true;
    }
  };

  const sendEvent = (event, payload) => {
    writeChunk(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const listener = (event, payload) => {
    if (event === 'stage') {
      sendEvent('stage', payload);
      return;
    }
    if (event === 'finish') {
      if (payload.status === 'done') {
        sendEvent('done', { result: payload.result });
      } else {
        sendEvent('error', {
          message: payload.error?.message || '生成失败。',
          code: payload.error?.code || 'GENERATE_FAILED',
        });
      }
      finished = true;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      job.listeners.delete(listener);
      if (!res.writableEnded) res.end();
    }
  };
  job.listeners.add(listener);

  heartbeat = setInterval(() => writeChunk(': heartbeat\n\n'), 15_000);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  res.on('close', () => {
    clientClosed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (!finished) {
      // The browser went away: stop the (possibly billed) upstream request.
      try {
        cancelJob(job.id);
      } catch {
        /* ignore */
      }
      job.listeners.delete(listener);
    }
  });

  enqueueJob(job);

  // Announce the queue position only when this request is actually waiting;
  // an idle queue produces the classic llm → nai → unzip → save stage flow.
  const position = jobQueuePosition(job);
  if (position > 1 || (position === 1 && runningJob)) {
    sendEvent('stage', { stage: 'queued', message: job.message, progress: 0 });
  }
}

app.post(
  '/api/llm/models',
  asyncRoute(async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {};
    const baseUrl = asString(body.baseUrl, activeConfig.llm.baseUrl).trim();
    const apiKey = asString(body.apiKey, activeConfig.llm.apiKey).trim();

    const models = await fetchLlmModels({ baseUrl, apiKey });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ models, fetchedAt: new Date().toISOString() });
  }),
);

app.post('/api/generate', (req, res, next) => {
  let spec;
  try {
    spec = generateJobSpec(req.body);
  } catch (error) {
    const info = publicErrorInfo(error);
    res.status(info.status).json({ error: { message: info.message, code: info.code } });
    return;
  }
  respondWithJob(req, res, spec).catch(next);
});

app.post('/api/history/:id/rerender', (req, res, next) => {
  const historyId = typeof req.params.id === 'string' ? req.params.id : '';
  const body = isPlainObject(req.body) ? req.body : {};
  respondWithJob(req, res, {
    kind: 'rerender',
    historyId,
    options: body,
  }).catch(next);
});

/* Trash thumbnails live in outputs/.trash, which /outputs deliberately hides. */
app.use(
  '/trash-files',
  express.static(TRASH_DIR, {
    index: false,
    dotfiles: 'allow',
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
    },
  }),
);

/* Static generated images are intentionally served from disk, not memory. */
app.use(
  '/outputs',
  express.static(OUTPUTS_DIR, {
    index: false,
    dotfiles: 'deny',
    maxAge: '7d',
    immutable: true,
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }),
);

app.use(express.static(PUBLIC_DIR, {
  index: 'index.html',
  extensions: ['html'],
  setHeaders(res) {
    // This is a local app with no build step: never let the browser keep an old
    // app.js/style.css after an update.
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
  },
}));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: { message: '接口不存在。', code: 'NOT_FOUND' } });
    return;
  }
  res.status(404).type('text/plain; charset=utf-8').send('404 Not Found');
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({
      error: { message: '请求体不是合法的 JSON。', code: 'INVALID_JSON' },
    });
    return;
  }
  if (error?.type === 'entity.too.large') {
    res.status(413).json({
      error: { message: '请求体过大。', code: 'BODY_TOO_LARGE' },
    });
    return;
  }

  const info = publicErrorInfo(error);
  res.status(info.status).json({ error: { message: info.message, code: info.code } });
});

/* ------------------------------------------------------------------ */
/* Startup                                                             */
/* ------------------------------------------------------------------ */

async function bootstrap() {
  await initializeStorage();

  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, HOST, () => {
      console.log('');
      console.log('  NAI Atelier  ·  LLM × NovelAI');
      console.log(`  Local     http://${HOST}:${PORT}`);
      console.log(`  Config    ${CONFIG_FILE}`);
      console.log(`  Outputs   ${OUTPUTS_DIR}`);
      console.log('  Press Ctrl+C to stop.');
      console.log('');
      resolve(server);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`端口 ${PORT} 已被占用。请通过 PORT 环境变量指定其他端口。`));
        return;
      }
      reject(error);
    });
  });
}

if (require.main === module) {
  bootstrap().catch((error) => {
    console.error('[startup]', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  app,
  bootstrap,
  initializeStorage,
  normalizeConfig,
};
