'use strict';

/**
 * 纯函数单测：能力表 / 提示词编译 / 请求体 / 结构化解析 / 预设导入导出 / Tag 口径。
 *
 * 不启动服务、不访问网络，毫秒级完成，所以可以随手加断言。
 * 端到端行为（HTTP 路由、真实请求形状）由 scripts/verify.js 覆盖。
 *
 * 用法：node scripts/test-nai.js
 */

const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const {
  MODEL_CAPABILITIES,
  resolveCapabilities,
  inferCapabilities,
  listModelCapabilities,
  varietyBoostSigma,
  normalizeUcPreset,
} = require(path.join(ROOT, 'lib/nai/capabilities.js'));
const {
  compilePrompt,
  mergeCharacters,
  defaultCenters,
  shouldUseCoords,
} = require(path.join(ROOT, 'lib/nai/compile.js'));
const {
  buildV5Payload,
  buildLegacyPayload,
  buildGenerationPayload,
} = require(path.join(ROOT, 'lib/nai/payload.js'));
const { parseStructuredOutput, extractJsonObject } = require(path.join(ROOT, 'lib/prompts/parse.js'));
const {
  getBuiltinPresets,
  parseImportText,
  mergeImportedPresets,
  exportPromptPresets,
  listPromptPresets,
  normalizeUserPresets,
} = require(path.join(ROOT, 'lib/prompts/presets.js'));
const { promptTags, tagDedupeKey, dedupeTags } = require(path.join(ROOT, 'lib/prompts/tags.js'));
const { classifyHttpStatus, retryDecision, NaiError } = require(path.join(ROOT, 'lib/nai/errors.js'));

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push({ name, error });
  }
}

/* ------------------------------------------------------------------ */
/* 夹具                                                                 */
/* ------------------------------------------------------------------ */

function novai(overrides = {}) {
  return {
    model: 'nai-diffusion-4-5-full',
    sampler: 'k_euler_ancestral',
    noiseSchedule: 'karras',
    steps: 28,
    scale: 5,
    cfgRescale: 0,
    width: 832,
    height: 1216,
    basePositive: 'cinematic lighting',
    artistPrompt: 'artist:wlop',
    negativePrompt: 'lowres, bad hands',
    ucPresetId: 'heavy',
    qualityPresetId: 'standard',
    transparentBackground: false,
    varietyBoost: false,
    forceSfw: false,
    qualityToggle: true,
    characters: [],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* 能力表                                                               */
/* ------------------------------------------------------------------ */

check('V5 Full 走 msgpack 流式端点', () => {
  const caps = resolveCapabilities('nai-diffusion-5-full');
  assert.equal(caps.transport, 'msgpack-stream');
  assert.equal(caps.endpoint, '/ai/generate-image-stream');
  assert.equal(caps.paramsVersion, 4);
  assert.equal(caps.maxCharacters, 10);
});

check('V5 Medium 锁定蒸馏步数与采样器', () => {
  const caps = resolveCapabilities('nai-diffusion-5-full-medium');
  assert.equal(caps.lockedSteps, 14);
  assert.equal(caps.lockedSampler, 'k_euler_ancestral');
  assert.equal(caps.family, 'v5');
});

check('V4.5 走图片端点并支持角色提示词', () => {
  const caps = resolveCapabilities('nai-diffusion-4-5-full');
  assert.equal(caps.transport, 'image');
  assert.equal(caps.endpoint, '/ai/generate-image');
  assert.equal(caps.paramsVersion, 3);
  assert.equal(caps.supportsCharacterPrompts, true);
});

check('V3 不支持角色提示词', () => {
  const caps = resolveCapabilities('nai-diffusion-3-full');
  assert.equal(caps.maxCharacters, 0);
  assert.equal(caps.supportsCharacterPrompts, false);
});

check('未知模型按前缀推断，不抛错', () => {
  assert.equal(inferCapabilities('nai-diffusion-5-curated').family, 'v5');
  assert.equal(inferCapabilities('something-else').family, 'v3');
});

check('模型列表包含 V5 Medium', () => {
  assert.ok(listModelCapabilities().some((item) => item.id === 'nai-diffusion-5-full-medium'));
});

check('varietyBoost 阈值随分辨率缩放', () => {
  assert.equal(varietyBoostSigma(832, 1216), 58);
  assert.ok(varietyBoostSigma(2048, 2048) > 116);
  assert.equal(varietyBoostSigma(0, 0), 58);
});

check('ucPresetId 非法值回退到 heavy', () => {
  assert.equal(normalizeUcPreset('none'), 'none');
  assert.equal(normalizeUcPreset('胡说'), 'heavy');
  assert.equal(normalizeUcPreset(undefined), 'heavy');
});

/* ------------------------------------------------------------------ */
/* 提示词编译                                                           */
/* ------------------------------------------------------------------ */

check('双角色：characterPrompts 与 char_captions 同源同序', () => {
  const compiled = compilePrompt({
    novai: novai({
      characters: [
        { name: '梅', prompt: '1girl, silver_hair' },
        { name: '凛', prompt: '1boy, black_hair' },
      ],
    }),
    capabilities: resolveCapabilities('nai-diffusion-4-5-full'),
    tags: ['rain', 'city_lights'],
  });
  assert.equal(compiled.characters.length, 2);
  assert.deepEqual(compiled.characters.map((item) => item.prompt), ['1girl, silver_hair', '1boy, black_hair']);
  assert.deepEqual(compiled.characters.map((item) => item.center.x), [0.33, 0.67]);
});

check('LLM 角色优先于配置角色，缺失字段用配置补齐', () => {
  const { characters } = mergeCharacters({
    configCharacters: [{ name: '梅', prompt: 'configured', uc: 'bad hands', center: { x: 0.2, y: 0.4 } }],
    llmCharacters: [{ name: '梅', prompt: 'from llm' }],
    maxCharacters: 6,
  });
  assert.equal(characters.length, 1);
  assert.equal(characters[0].prompt, 'from llm');
  assert.equal(characters[0].uc, 'bad hands');
  assert.deepEqual(characters[0].center, { x: 0.2, y: 0.4 });
});

check('V3 把角色词内联进正向而不是发 characterPrompts', () => {
  const compiled = compilePrompt({
    novai: novai({ model: 'nai-diffusion-3-full', characters: [{ name: '梅', prompt: '1girl, silver_hair' }] }),
    capabilities: resolveCapabilities('nai-diffusion-3-full'),
    tags: ['rain'],
  });
  assert.match(compiled.positive, /1girl, silver_hair/);
  assert.equal(compiled.characters.length, 0);
});

check('forceSfw 才把 nsfw 塞进负向', () => {
  const caps = resolveCapabilities('nai-diffusion-5-full');
  const off = compilePrompt({ novai: novai({ model: 'nai-diffusion-5-full' }), capabilities: caps, tags: ['rain'] });
  const on = compilePrompt({
    novai: novai({ model: 'nai-diffusion-5-full', forceSfw: true }),
    capabilities: caps,
    tags: ['rain'],
  });
  assert.ok(!off.negative.includes('nsfw'));
  assert.ok(on.negative.startsWith('nsfw'));
});

check('正向已含 nsfw 时 forceSfw 不重复添加', () => {
  const caps = resolveCapabilities('nai-diffusion-5-full');
  const compiled = compilePrompt({
    novai: novai({ model: 'nai-diffusion-5-full', forceSfw: true }),
    capabilities: caps,
    tags: ['rain, nsfw'],
  });
  assert.equal(compiled.negative.split(',').filter((tag) => tag.trim() === 'nsfw').length, 0);
});

check('画师串与基础正向在场景词前后，顺序稳定', () => {
  const compiled = compilePrompt({
    novai: novai(),
    capabilities: resolveCapabilities('nai-diffusion-4-5-full'),
    tags: ['rain'],
  });
  assert.equal(compiled.positive, 'artist:wlop, rain, cinematic lighting');
});

check('空 Tag 不会产生空段', () => {
  const compiled = compilePrompt({
    novai: novai({ artistPrompt: '', basePositive: '' }),
    capabilities: resolveCapabilities('nai-diffusion-4-5-full'),
    tags: ['rain'],
  });
  assert.equal(compiled.positive, 'rain');
  assert.ok(!compiled.positive.includes(',,'));
});

check('默认坐标随人数变化，且全在中心时不启用坐标', () => {
  assert.deepEqual(defaultCenters(1), [{ x: 0.5, y: 0.5 }]);
  const two = defaultCenters(2);
  assert.ok(Math.abs(two[0].x - 0.33) < 0.01 && Math.abs(two[1].x - 0.67) < 0.01);
  assert.equal(shouldUseCoords([{ center: { x: 0.5, y: 0.5 } }]), false);
  assert.equal(shouldUseCoords([{ center: { x: 0.2, y: 0.5 } }]), true);
});

/* ------------------------------------------------------------------ */
/* 请求体                                                               */
/* ------------------------------------------------------------------ */

check('V5 请求体：params_version 4 + 流式 + 两组预设 id', () => {
  const model = 'nai-diffusion-5-full';
  const capabilities = resolveCapabilities(model);
  const nai = novai({ model });
  const compiled = compilePrompt({ novai: nai, capabilities, tags: ['rain'] });
  const payload = buildV5Payload({ novai: nai, compiled, capabilities, seed: 42 });
  assert.equal(payload.parameters.params_version, 4);
  assert.equal(payload.parameters.stream, 'msgpack');
  assert.equal(payload.parameters.ucPresetId, 'heavy');
  assert.equal(payload.parameters.qualityPresetId, 'standard');
  assert.equal(payload.use_new_shared_trial, true);
  assert.equal(payload.model, model);
});

check('V5 请求体带角色时开启 use_coords 并同步两处角色', () => {
  const model = 'nai-diffusion-5-full';
  const capabilities = resolveCapabilities(model);
  const nai = novai({
    model,
    characters: [
      { name: 'A', prompt: '1girl' },
      { name: 'B', prompt: '1boy' },
    ],
  });
  const compiled = compilePrompt({ novai: nai, capabilities, tags: ['rain'] });
  const payload = buildV5Payload({ novai: nai, compiled, capabilities, seed: 1 });
  assert.equal(payload.parameters.use_coords, true);
  assert.equal(payload.parameters.characterPrompts.length, 2);
  assert.equal(payload.parameters.v4_prompt.caption.char_captions.length, 2);
  assert.equal(payload.parameters.v4_negative_prompt.caption.char_captions.length, 2);
  assert.deepEqual(
    payload.parameters.v4_prompt.caption.char_captions.map((item) => item.char_caption),
    ['1girl', '1boy'],
  );
});

check('V5 Medium 请求体用锁定的步数与采样器', () => {
  const model = 'nai-diffusion-5-full-medium';
  const capabilities = resolveCapabilities(model);
  const nai = novai({ model, steps: 40, sampler: 'k_dpmpp_2m' });
  const compiled = compilePrompt({ novai: nai, capabilities, tags: ['rain'] });
  const payload = buildV5Payload({ novai: nai, compiled, capabilities, seed: 7 });
  assert.equal(payload.parameters.steps, 14);
  assert.equal(payload.parameters.sampler, 'k_euler_ancestral');
});

check('旧模型请求体：params_version 3、不发流式字段', () => {
  const model = 'nai-diffusion-4-5-full';
  const capabilities = resolveCapabilities(model);
  const nai = novai({ model });
  const compiled = compilePrompt({ novai: nai, capabilities, tags: ['rain'] });
  const payload = buildLegacyPayload({ novai: nai, compiled, capabilities, seed: 3 });
  assert.equal(payload.parameters.params_version, 3);
  assert.equal(payload.parameters.stream, undefined);
  assert.equal(payload.parameters.image_format, undefined);
  assert.equal((payload.parameters.characterPrompts || []).length, 0);
});

check('varietyBoost 只在支持的模型上写 skip_cfg_above_sigma', () => {
  const model = 'nai-diffusion-4-5-full';
  const capabilities = resolveCapabilities(model);
  const nai = novai({ model, varietyBoost: true });
  const compiled = compilePrompt({ novai: nai, capabilities, tags: ['rain'] });
  const boosted = buildLegacyPayload({ novai: nai, compiled, capabilities, seed: 1 });
  const plain = buildLegacyPayload({ novai: novai({ model }), compiled, capabilities, seed: 1 });
  assert.equal(boosted.parameters.skip_cfg_above_sigma, 58);
  assert.equal(plain.parameters.skip_cfg_above_sigma, undefined);
});

check('统一出口按能力表选端点与传输方式', () => {
  const model = 'nai-diffusion-5-full';
  const result = buildGenerationPayload({
    novai: novai({ model }),
    compiled: { positive: 'rain', negative: '', characters: [] },
    capabilities: resolveCapabilities(model),
    seed: 1,
  });
  assert.equal(result.endpointPath, '/ai/generate-image-stream');
  assert.equal(result.contentType, 'multipart/form-data');
  assert.equal(result.transport, 'msgpack-stream');
});

/* ------------------------------------------------------------------ */
/* 结构化解析                                                           */
/* ------------------------------------------------------------------ */

check('结构化输出：裸 JSON 直接解析', () => {
  const parsed = parseStructuredOutput(
    '{"title":"雨夜","scene":"1girl, rain, city_lights","characters":[{"name":"梅","prompt":"1girl, silver_hair"}],"negative":"lowres"}',
  );
  assert.equal(parsed.title, '雨夜');
  assert.equal(parsed.scene, '1girl, rain, city_lights');
  assert.equal(parsed.characters.length, 1);
  assert.equal(parsed.characters[0].name, '梅');
});

check('结构化输出：围栏 JSON 与前后废话都能剥掉', () => {
  const parsed = parseStructuredOutput(
    '好的，结果如下：\n```json\n{"scene":"rain","characters":[]}\n```\n还需要别的吗？',
  );
  assert.equal(parsed.scene, 'rain');
});

check('结构化输出：无法解析时返回 null 供回退', () => {
  assert.equal(parseStructuredOutput('1girl, solo, rain'), null);
  assert.equal(parseStructuredOutput(''), null);
  assert.equal(parseStructuredOutput(null), null);
});

check('结构化输出：scene 与 characters 全空视为无效', () => {
  assert.equal(parseStructuredOutput('{"title":"只有标题"}'), null);
});

check('结构化输出：角色数量被 maxCharacters 截断', () => {
  const parsed = parseStructuredOutput(
    JSON.stringify({
      scene: 'rain',
      characters: Array.from({ length: 12 }, (_, index) => ({ name: `c${index}`, prompt: `p${index}` })),
    }),
    { maxCharacters: 3 },
  );
  assert.equal(parsed.characters.length, 3);
});

check('坐标越界被钳到 0–1', () => {
  const parsed = parseStructuredOutput(
    JSON.stringify({ scene: 'rain', characters: [{ name: 'A', prompt: '1girl', center: { x: 2, y: -1 } }] }),
  );
  assert.deepEqual(parsed.characters[0].center, { x: 1, y: 0 });
});

check('extractJsonObject 能处理字符串里的花括号', () => {
  assert.deepEqual(extractJsonObject('前缀 {"scene":"a {b} c"} 后缀'), { scene: 'a {b} c' });
});

/* ------------------------------------------------------------------ */
/* 预设导入导出                                                         */
/* ------------------------------------------------------------------ */

check('内置预设至少 4 个且 id 带 builtin- 前缀', () => {
  const builtins = getBuiltinPresets();
  assert.ok(builtins.length >= 4);
  assert.ok(builtins.every((item) => item.id.startsWith('builtin-')));
  assert.ok(builtins.every((item) => item.blocks.length > 0));
});

check('内置预设含结构化输出模板', () => {
  const structured = getBuiltinPresets().find((item) => item.structuredOutput === true);
  assert.ok(structured, '缺少 structuredOutput:true 的内置预设');
  assert.match(structured.blocks.map((block) => block.content).join('\n'), /"characters"/);
});

check('导出再导入：内容无损', () => {
  const presets = normalizeUserPresets([
    { name: '我的预设', blocks: [{ role: 'system', content: '写 tag' }], structuredOutput: false },
  ]);
  const exported = exportPromptPresets(presets);
  const imported = parseImportText(exported);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].name, '我的预设');
  assert.equal(imported[0].blocks[0].content, '写 tag');
});

check('导出的 JSON 带 app/kind/version 标记', () => {
  const payload = JSON.parse(exportPromptPresets(normalizeUserPresets([])));
  assert.equal(payload.app, 'nai-atelier');
  assert.equal(payload.kind, 'nai-atelier/prompt-presets');
  assert.equal(payload.version, 1);
});

check('导入同名预设自动加序号，不覆盖已有', () => {
  const existing = normalizeUserPresets([{ name: '日常', blocks: [{ content: '旧' }] }]);
  const { presets, added, names } = mergeImportedPresets({
    existing,
    imported: [{ name: '日常', blocks: [{ content: '新' }] }],
  });
  assert.equal(added, 1);
  assert.deepEqual(names, ['日常 (2)']);
  assert.equal(presets.length, 2);
  assert.notEqual(presets[0].id, presets[1].id);
});

check('导入非法 JSON 抛错而不是静默吞掉', () => {
  assert.throws(() => parseImportText('{不是 json'));
  assert.throws(() => parseImportText(''));
});

check('列表把内置放前面并带 builtin 标记', () => {
  const list = listPromptPresets(normalizeUserPresets([{ name: '我的', blocks: [{ content: 'x' }] }]));
  assert.equal(list[0].builtin, true);
  assert.equal(list.at(-1).builtin, false);
});

/* ------------------------------------------------------------------ */
/* Tag 口径与错误分类                                                   */
/* ------------------------------------------------------------------ */

check('Tag 去重保留首个写法并忽略权重差异', () => {
  assert.deepEqual(dedupeTags(['1girl', '1girl', '(1girl:1.2)']), ['1girl']);
  assert.equal(tagDedupeKey('(Rain:1.3)'), 'rain');
  assert.deepEqual(promptTags('a, b,,c'), ['a', 'b', 'c']);
});

check('HTTP 状态码分类覆盖 400/401/402/429/5xx', () => {
  assert.equal(classifyHttpStatus(400, 'bad').kind, 'input');
  assert.equal(classifyHttpStatus(401).kind, 'auth');
  assert.equal(classifyHttpStatus(402).kind, 'quota');
  assert.equal(classifyHttpStatus(429).kind, 'busy');
  assert.equal(classifyHttpStatus(500).kind, 'provider');
  assert.equal(classifyHttpStatus(418).kind, 'unknown');
});

check('只有 429 与 5xx 值得重试，且次数受限', () => {
  const busy = classifyHttpStatus(429);
  assert.equal(retryDecision(busy, 0).retry, true);
  assert.equal(retryDecision(busy, 1).retry, true);
  assert.equal(retryDecision(busy, 2).retry, false);
  const provider = classifyHttpStatus(503);
  assert.equal(retryDecision(provider, 0).retry, true);
  assert.equal(retryDecision(provider, 1).retry, false);
  assert.equal(retryDecision(classifyHttpStatus(400), 0).retry, false);
});

check('NaiError 序列化保留可诊断字段', () => {
  const error = new NaiError('boom', { kind: 'quota', code: 'NAI_QUOTA', detail: 'no anlas' });
  const json = error.toJSON();
  assert.equal(json.kind, 'quota');
  assert.equal(json.detail, 'no anlas');
  assert.equal(error.status, 502);
});

check('能力表覆盖 UI 下拉里的每一个模型', () => {
  for (const [id, caps] of Object.entries(MODEL_CAPABILITIES)) {
    assert.ok(caps.label, `${id} 缺少 label`);
    assert.ok(caps.endpoint, `${id} 缺少端点`);
    assert.ok(['msgpack-stream', 'image'].includes(caps.transport), `${id} 传输方式不合法`);
  }
});

/* ------------------------------------------------------------------ */

if (failures.length) {
  for (const { name, error } of failures) {
    console.error(`FAIL ${name}`);
    console.error(`  ${error.message}`);
  }
}

console.log(`${passed}/${passed + failures.length} 项通过`);
process.exit(failures.length ? 1 : 0);
