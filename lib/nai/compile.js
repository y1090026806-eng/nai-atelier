'use strict';

const { promptTags, dedupeTags, tagDedupeKey, joinTags, countTags } = require('../prompts/tags');

/**
 * 提示词编译：把「用户配置 + LLM 输出」编译成一次请求的最终提示词与角色表。
 *
 * 这一层的唯一职责是**决定内容**，不碰传输格式。payload.js 只负责把这里的结果
 * 转成 NovelAI 的 JSON 结构 —— 这样「角色提示词与 char_captions 必须同源同序」
 * 才有一个物理上的保证点。
 */

const MAX_SCENE_TAGS = 160;
const MAX_CHARACTER_TAGS = 80;
const MAX_TOTAL_TAGS = 220;

function clamp01(value, fallback = 0.5) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(1, Math.max(0, num));
}

function normalizeCenter(center, fallback = { x: 0.5, y: 0.5 }) {
  if (!center || typeof center !== 'object') return { ...fallback };
  return {
    x: Math.round(clamp01(center.x, fallback.x) * 1000) / 1000,
    y: Math.round(clamp01(center.y, fallback.y) * 1000) / 1000,
  };
}

/** 多个角色都没给坐标时，按人数给一组不重叠的默认站位。 */
function defaultCenters(count) {
  if (count <= 1) return [{ x: 0.5, y: 0.5 }];
  if (count === 2) return [{ x: 0.33, y: 0.5 }, { x: 0.67, y: 0.5 }];
  if (count === 3) return [{ x: 0.28, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.72, y: 0.5 }];
  return Array.from({ length: count }, (_, index) => ({
    x: Math.round(((index + 0.5) / count) * 1000) / 1000,
    y: 0.5,
  }));
}

function findByName(list, name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  return list.find((item) => String(item.name || '').trim().toLowerCase() === key) || null;
}

/** 角色是否显式给过坐标（0.5/0.5 也算给过，只有完全缺失才算没给）。 */
function hasCenter(item) {
  if (!item) return false;
  const source = item.center && typeof item.center === 'object' ? item.center : item;
  const x = Number(source.x !== undefined ? source.x : item.centerX);
  const y = Number(source.y !== undefined ? source.y : item.centerY);
  return Number.isFinite(x) || Number.isFinite(y);
}

/**
 * 合并「配置里的固定角色」与「LLM 本次识别出的角色」。
 *
 * 规则：
 * 1. LLM 给了角色 → 以 LLM 为准（它写的是这一张图里的动作/表情/服装）；
 *    配置里同名的角色只补 uc 与坐标这类 LLM 不该猜的字段。
 * 2. LLM 没给角色但配置里勾选了角色 → 用配置的角色，方便固定主角。
 * 3. 数量超过模型上限时截断并给出警告，不静默丢人。
 */
function mergeCharacters({ configCharacters = [], llmCharacters = [], maxCharacters = 10 } = {}) {
  const warnings = [];
  const configured = (Array.isArray(configCharacters) ? configCharacters : [])
    .filter((item) => item && item.enabled !== false)
    .map((item) => ({
      name: String(item.name || '').trim().slice(0, 60),
      prompt: String(item.prompt || '').trim(),
      uc: String(item.uc || '').trim(),
      // 没显式给坐标时留 null，交给 defaultCenters 自动排站位；
      // 硬塞 0.5 会让「双人图」两个人都叠在正中间。
      center: hasCenter(item) ? normalizeCenter(item.center || { x: item.centerX, y: item.centerY }) : null,
      source: 'config',
    }))
    .filter((item) => item.prompt || item.name);

  const fromLlm = (Array.isArray(llmCharacters) ? llmCharacters : [])
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      name: String(item.name || '').trim().slice(0, 60),
      prompt: String(item.prompt || '').trim(),
      uc: String(item.uc || '').trim(),
      center: item.center ? normalizeCenter(item.center) : null,
      source: 'llm',
    }))
    .filter((item) => item.prompt);

  let merged;
  if (fromLlm.length) {
    merged = fromLlm.map((item) => {
      const config = findByName(configured, item.name);
      return {
        ...item,
        uc: item.uc || config?.uc || '',
        center: item.center || config?.center || null,
      };
    });
    // LLM 没提到、但配置里明确勾选的角色，不强行塞进去；否则容易「多画一个人」。
    const dropped = configured.filter(
      (config) => config.prompt && !findByName(fromLlm, config.name),
    );
    if (dropped.length) {
      warnings.push(
        `配置里勾选了 ${dropped.map((item) => item.name || '未命名角色').join('、')}，但本次提示词没有提到，已跳过。`,
      );
    }
  } else {
    merged = configured.map((item) => ({ ...item, center: item.center }));
  }

  const max = Number.isFinite(maxCharacters) && maxCharacters >= 0 ? maxCharacters : 10;
  if (merged.length > max) {
    warnings.push(`角色数量 ${merged.length} 超过模型上限 ${max}，已截断后 ${max} 个。`);
    merged = merged.slice(0, max);
  }

  const centers = defaultCenters(merged.length);
  return {
    characters: merged.map((item, index) => ({
      name: item.name || `角色 ${index + 1}`,
      prompt: item.prompt,
      uc: item.uc,
      center: item.center || centers[index],
      enabled: true,
    })),
    warnings,
  };
}

/**
 * 编译最终提示词。
 *
 * @param {object} options
 * @param {object} options.novai          规范化后的 novelai 配置
 * @param {object} options.capabilities   模型能力（capabilities.js）
 * @param {string} options.tags           LLM 产出的场景 tags
 * @param {Array}  options.characters     LLM 产出的角色（可空）
 * @param {string} options.extraNegative  LLM 产出的额外负面
 */
function compilePrompt({ novai, capabilities, tags = '', characters = [], extraNegative = '' }) {
  const warnings = [];
  const supportsCharacters = Boolean(capabilities?.supportsCharacterPrompts);
  // 不支持角色通道的模型（V3 / Furry）仍然可以把角色描述平铺进正向，
  // 所以这里给一个小的内联上限，而不是把角色直接丢掉。
  const maxCharacters = supportsCharacters ? capabilities.maxCharacters : 4;

  const merged = mergeCharacters({
    configCharacters: novai.characters,
    llmCharacters: characters,
    maxCharacters,
  });
  warnings.push(...merged.warnings);

  const sceneTags = dedupeTags(promptTags(tags));
  if (sceneTags.length > MAX_SCENE_TAGS) {
    warnings.push(`场景 tags 有 ${sceneTags.length} 个，超过建议的 ${MAX_SCENE_TAGS} 个，效果可能发散。`);
  }

  // V3 没有角色提示词通道，只能把角色描述平铺进正向。
  const inlineCharacters = supportsCharacters
    ? []
    : merged.characters.filter((item) => item.prompt).map((item) => item.prompt);

  const positive = dedupeTags([
    ...promptTags(novai.artistPrompt),
    ...sceneTags,
    ...inlineCharacters.flatMap((value) => promptTags(value)),
    ...promptTags(novai.basePositive),
  ]);

  const transparentHint = novai.transparentBackground
    ? ['tag_hint_transparent_background']
    : [];
  if (transparentHint.length) positive.push(...transparentHint);

  const countedCharacters = supportsCharacters
    ? merged.characters.filter((item) => item.prompt).length
    : 0;

  const negativeParts = [
    ...promptTags(novai.negativePrompt),
    ...promptTags(extraNegative),
  ];

  // 可选的「强制 SFW」：V5 Full 下把 nsfw 塞进负向。LWB 默认这么做，
  // 但本仓库默认关闭——用户没明说要全年龄出图时，替用户决定内容取向是不礼貌的。
  const isV5Full = capabilities?.family === 'v5' && /5-full(?!-medium)/.test(String(novai.model));
  if (isV5Full && novai.ucPresetId !== 'none' && novai.forceSfw) {
    const positiveHasNsfw = positive.some((tag) => tagDedupeKey(tag) === 'nsfw');
    if (!positiveHasNsfw) negativeParts.unshift('nsfw');
  }

  const negative = dedupeTags(negativeParts);

  const characterPrompts = supportsCharacters
    ? merged.characters
        .filter((item) => item.prompt)
        .map((item) => ({ ...item, prompt: joinTags(promptTags(item.prompt)) }))
    : [];

  for (const character of characterPrompts) {
    if (countTags(character.prompt) > MAX_CHARACTER_TAGS) {
      warnings.push(`角色「${character.name}」的提示词超过 ${MAX_CHARACTER_TAGS} 个 tag，建议精简。`);
    }
  }

  const totalTags = positive.length + characterPrompts.reduce((sum, item) => sum + countTags(item.prompt), 0);
  if (totalTags > MAX_TOTAL_TAGS) {
    warnings.push(`提示词总量 ${totalTags} 个 tag，超过建议的 ${MAX_TOTAL_TAGS} 个上限。`);
  }

  return {
    positive: positive.join(', '),
    negative: negative.join(', '),
    characters: characterPrompts,
    scenes: sceneTags.length,
    characterCount: countedCharacters,
    warnings,
  };
}

/** 是否真的需要用坐标：只有当某个角色不在正中心时才开启（LWB 同款判断）。 */
function shouldUseCoords(characters) {
  return (characters || []).some((item) => {
    const center = item.center || { x: 0.5, y: 0.5 };
    return Math.abs(center.x - 0.5) > 0.001 || Math.abs(center.y - 0.5) > 0.001;
  });
}

module.exports = {
  clamp01,
  normalizeCenter,
  defaultCenters,
  mergeCharacters,
  compilePrompt,
  shouldUseCoords,
  MAX_SCENE_TAGS,
  MAX_CHARACTER_TAGS,
  MAX_TOTAL_TAGS,
};
