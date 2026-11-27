'use strict';

const { varietyBoostSigma } = require('./capabilities');

/**
 * NovelAI 请求体构造。
 *
 * 分两条协议线：
 * - V5（nai-diffusion-5-*）：`params_version: 4` + `stream:'msgpack'` +
 *   ucPresetId/qualityPresetId 字符串 + characterPrompts/char_captions，
 *   请求体走 multipart，响应是 msgpack 帧流。
 * - 旧模型（V4.5 / V4 / V3 / Furry）：`params_version: 3`，响应是 ZIP。
 *
 * 这里的角色数据**只来自 compile.js 的输出**，函数内部不再做任何合并或去重，
 * 保证 characterPrompts 与 v4_prompt.caption.char_captions 同源同序。
 */

const DEFAULT_UC_PRESET_ID = 'heavy';
const DEFAULT_QUALITY_PRESET_ID = 'standard';

function clampInt(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function baseParameters({ novai, capabilities, seed, negative, paramsVersion }) {
  const sampler = capabilities.lockedSampler || novai.sampler;
  const steps = capabilities.lockedSteps || clampInt(novai.steps, 28, 1, 50);

  return {
    width: novai.width,
    height: novai.height,
    n_samples: 1,
    seed,
    sampler,
    steps,
    scale: novai.scale,
    cfg_rescale: novai.cfgRescale,
    noise_schedule: novai.noiseSchedule,
    params_version: paramsVersion,
    negative_prompt: negative,
    dynamic_thresholding: false,
    controlnet_strength: 1,
    add_original_image: true,
    prefer_brownian: true,
  };
}

function buildV5Payload({ novai, compiled, capabilities, seed }) {
  const positive = compiled.positive;
  const negative = compiled.negative;
  const characters = compiled.characters || [];
  const useCoords = characters.length > 0;

  const parameters = {
    ...baseParameters({
      novai,
      capabilities,
      seed,
      negative,
      paramsVersion: capabilities.paramsVersion || 4,
    }),
    // V5 用字符串 id 取代旧的数字 ucPreset / 布尔 qualityToggle。
    ucPreset: 0,
    qualityToggle: true,
    ucPresetId: novai.ucPresetId || DEFAULT_UC_PRESET_ID,
    qualityPresetId: novai.qualityPresetId || DEFAULT_QUALITY_PRESET_ID,
    uc: negative,
    use_coords: useCoords,
    use_order: true,
    legacy_uc: false,
    // V5 传输协议：请求就用 msgpack，图片固定 PNG。
    stream: 'msgpack',
    image_format: 'png',
    normalize_reference_strength_multiple: true,
    straight_alpha: Boolean(novai.transparentBackground),
    characterPrompts: characters.map((item) => ({
      prompt: item.prompt,
      uc: item.uc || '',
      center: { x: item.center.x, y: item.center.y },
      enabled: true,
    })),
    v4_prompt: {
      caption: {
        base_caption: positive,
        char_captions: characters.map((item) => ({
          char_caption: item.prompt,
          centers: [{ x: item.center.x, y: item.center.y }],
        })),
      },
      use_coords: useCoords,
      use_order: true,
      legacy_uc: false,
    },
    v4_negative_prompt: {
      caption: {
        base_caption: negative,
        char_captions: characters.map((item) => ({
          char_caption: item.uc || '',
          centers: [{ x: item.center.x, y: item.center.y }],
        })),
      },
      use_coords: useCoords,
      use_order: false,
      legacy_uc: false,
    },
  };

  return {
    input: positive,
    model: novai.model,
    action: 'generate',
    parameters,
    // V5 的共享试用标记必须放在顶层，放进 parameters 会被忽略。
    use_new_shared_trial: true,
  };
}

function buildLegacyPayload({ novai, compiled, capabilities, seed }) {
  const positive = compiled.positive;
  const negative = compiled.negative;
  const characters = (compiled.characters || []).filter((item) => item.prompt);
  const supportsCharacters = capabilities.supportsCharacterPrompts && characters.length > 0;
  const useCoords = supportsCharacters
    ? characters.some(
        (item) => Math.abs(item.center.x - 0.5) > 0.001 || Math.abs(item.center.y - 0.5) > 0.001,
      )
    : false;

  const parameters = {
    ...baseParameters({
      novai,
      capabilities,
      seed,
      negative,
      paramsVersion: capabilities.paramsVersion || 3,
    }),
    ucPreset: 0,
    qualityToggle: Boolean(novai.qualityToggle),
    legacy: false,
    legacy_v3_extend: false,
  };

  if (capabilities.supportsCharacterPrompts) {
    parameters.characterPrompts = characters.map((item) => ({
      prompt: item.prompt,
      uc: item.uc || '',
      center: { x: item.center.x, y: item.center.y },
      enabled: true,
    }));
    parameters.use_coords = useCoords;
    parameters.legacy_uc = false;
    parameters.v4_prompt = {
      caption: {
        base_caption: positive,
        char_captions: characters.map((item) => ({
          char_caption: item.prompt,
          centers: [{ x: item.center.x, y: item.center.y }],
        })),
      },
      use_coords: useCoords,
      use_order: true,
      legacy_uc: false,
    };
    parameters.v4_negative_prompt = {
      caption: {
        base_caption: negative,
        char_captions: characters.map((item) => ({
          char_caption: item.uc || '',
          centers: [{ x: item.center.x, y: item.center.y }],
        })),
      },
      use_coords: useCoords,
      use_order: false,
      legacy_uc: false,
    };
  }

  // V4.5 的 variety_boost：按分辨率抬高 CFG 重缩放阈值。
  if (capabilities.supportsVarietyBoost && novai.varietyBoost) {
    parameters.skip_cfg_above_sigma = varietyBoostSigma(novai.width, novai.height);
  }

  return {
    input: positive,
    model: novai.model,
    action: 'generate',
    parameters,
  };
}

/** 统一出口：根据能力表选择协议，返回请求体 + 端点 + 传输方式。 */
function buildGenerationPayload({ novai, compiled, capabilities, seed }) {
  const isV5 = capabilities.transport === 'msgpack-stream';
  const payload = isV5
    ? buildV5Payload({ novai, compiled, capabilities, seed })
    : buildLegacyPayload({ novai, compiled, capabilities, seed });

  return {
    payload,
    endpointPath: capabilities.endpoint || (isV5 ? '/ai/generate-image-stream' : '/ai/generate-image'),
    transport: capabilities.transport,
    contentType: isV5 ? 'multipart/form-data' : 'application/json',
  };
}

module.exports = {
  buildV5Payload,
  buildLegacyPayload,
  buildGenerationPayload,
  DEFAULT_UC_PRESET_ID,
  DEFAULT_QUALITY_PRESET_ID,
};
