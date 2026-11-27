'use strict';

const { normalizeCenter } = require('../nai/compile');

/**
 * 结构化 LLM 输出解析。
 *
 * 大模型「偶尔听话」是常态，所以这里的原则是：**能救就救，救不了就回退**。
 * - 先剥掉 ```json 代码块和各种前后解释文字；
 * - 解析失败或字段不合法 → 返回 null，由调用方回退到「一行 tags」的老解析器；
 * - 字段级容错：多给字段忽略，少给字段用默认值，坐标超范围钳到 0–1。
 */

const MAX_CHARACTERS_HARD_LIMIT = 10;

function stripCodeFence(text) {
  const value = String(text || '').trim();
  const fenced = value.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return value;
}

/** 从一段可能夹带解释文字的输出里截出最外层 JSON 对象。 */
function extractJsonObject(text) {
  const value = stripCodeFence(text);
  const start = value.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = value.slice(start, index + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function asText(value, limit) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, limit);
}

function normalizeCharacters(raw, maxCharacters) {
  const list = Array.isArray(raw) ? raw : [];
  const limit = Number.isFinite(maxCharacters)
    ? Math.max(0, Math.min(MAX_CHARACTERS_HARD_LIMIT, maxCharacters))
    : MAX_CHARACTERS_HARD_LIMIT;

  return list
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      name: asText(item.name, 60) || `角色 ${index + 1}`,
      prompt: asText(item.prompt, 4000),
      uc: asText(item.uc, 2000),
      center: item.center ? normalizeCenter(item.center) : null,
    }))
    .filter((item) => item.prompt)
    .slice(0, limit);
}

/**
 * 校验并规范化结构化输出。
 * 返回 null 表示「这不是一份可用的结构化结果」，调用方应回退。
 */
function normalizeStructuredPayload(raw, { maxCharacters = MAX_CHARACTERS_HARD_LIMIT } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const scene = asText(raw.scene ?? raw.tags ?? raw.prompt, 8000);
  const characters = normalizeCharacters(raw.characters, maxCharacters);
  if (!scene && !characters.length) return null;

  return {
    structured: true,
    title: asText(raw.title, 60),
    scene,
    characters,
    negative: asText(raw.negative ?? raw.uc, 4000),
  };
}

/** 便捷函数：文本 → 结构化结果 / null。 */
function parseStructuredOutput(text, options = {}) {
  const object = extractJsonObject(text);
  if (!object) return null;
  return normalizeStructuredPayload(object, options);
}

module.exports = {
  stripCodeFence,
  extractJsonObject,
  normalizeStructuredPayload,
  parseStructuredOutput,
  MAX_CHARACTERS_HARD_LIMIT,
};
