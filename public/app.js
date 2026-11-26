'use strict';

/**
 * NAI Atelier — frontend.
 *
 * The app intentionally uses only browser APIs and DOM construction (no
 * template-string HTML for generated content), so tags and prompts always
 * render as text.
 */
(() => {
  const MAX_CHARS = 4000;

  const NAI_MODEL_LABELS = {
    'nai-diffusion-5-full': 'V5 Full',
    'nai-diffusion-5-curated': 'V5 Curated',
    'nai-diffusion-4-5-full': 'V4.5 Full',
    'nai-diffusion-4-5-curated': 'V4.5 Curated',
    'nai-diffusion-4-full': 'V4 Full',
    'nai-diffusion-4-curated-preview': 'V4 Curated',
    'nai-diffusion-3': 'V3',
    'nai-diffusion-furry-3': 'Furry V3',
  };

  const SAMPLER_LABELS = {
    k_euler_ancestral: 'Euler Ancestral',
    k_euler: 'Euler',
    k_dpmpp_2m: 'DPM++ 2M',
    k_dpmpp_sde: 'DPM++ SDE',
    k_dpmpp_2m_sde: 'DPM++ 2M SDE',
    k_dpmpp_2s_ancestral: 'DPM++ 2S Ancestral',
    ddim_v3: 'DDIM',
  };

  const NOISE_LABELS = {
    karras: 'Karras',
    native: 'Native',
    exponential: 'Exponential',
    polyexponential: 'Polyexponential',
  };

  const MODEL_SUGGESTIONS = [
    'deepseek-chat',
    'deepseek-reasoner',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gpt-4o-mini',
    'gpt-4.1-mini',
    'qwen-plus',
  ];

  const PROMPT_ROLE_LABELS = {
    system: 'System',
    assistant: 'Assistant',
    user: 'User',
  };

  const PROMPT_POSITION_LABELS = {
    before: '用户输入之前',
    after: '用户输入之后',
  };

  const MAX_PROMPT_BLOCKS = 24;
  const WEIGHT_MIN = 0.1;
  const WEIGHT_MAX = 2;
  const WEIGHT_STEP = 0.05;
  const JOB_POLL_MS = 800;
  const MAX_QUEUE_ROWS = 10;

  const RESOLUTION_PRESETS = {
    portrait: { width: 832, height: 1216 },
    landscape: { width: 1216, height: 832 },
    square: { width: 1024, height: 1024 },
    tall: { width: 768, height: 1344 },
    wide: { width: 1344, height: 768 },
  };

  const state = {
    loaded: false,
    dirty: false,
    saving: false,
    generating: false,
    jobs: [],
    jobsInitialized: false,
    handledJobIds: new Set(),
    sessionJobIds: new Set(),
    jobPollTimer: null,
    jobPollBusy: false,
    enqueuing: false,
    limits: { llmTimeoutSeconds: 120, naiTimeoutSeconds: 300 },
    selected: new Set(),
    dragItemId: '',
    dropTarget: null,
    trash: [],
    prompts: [],
    promptEditingId: '',
    tagWeightTokens: [],
    gotResult: false,
    lastCreatedId: '',
    lastFinishedJobId: '',
    editVersion: 0,
    history: [],
    albums: [],
    activeAlbumId: 'all',
    activeItem: null,
    lightboxItems: [],
    lightboxIndex: 0,
    promptBlocks: [],
    presets: [],
    activePresetId: 'current',
    naiPresets: [],
    activeNaiPresetId: 'current',
    availableModels: [],
    availableModelsBaseUrl: '',
    elapsedTimer: null,
    elapsedStart: 0,
    elapsedJobId: '',
    progressHideTimer: null,
    toastTimers: new Set(),
  };

  const ui = {};

  function cacheElements() {
    const ids = [
      'sidebar',
      'sidebar-close',
      'sidebar-toggle',
      'sidebar-backdrop',
      'llm-preset',
      'llm-preset-save',
      'llm-preset-delete',
      'llm-model',
      'llm-model-options',
      'llm-model-fetch',
      'llm-model-count',
      'llm-model-picker',
      'llm-model-list',
      'llm-api-key',
      'llm-base-url',
      'llm-temperature',
      'llm-top-p',
      'llm-max-tokens',
      'llm-timeout',
      'llm-reasoning',
      'prompt-blocks',
      'prompt-blocks-count',
      'prompt-block-add',
      'nai-api-key',
      'nai-preset',
      'nai-preset-save',
      'nai-preset-delete',
      'nai-model',
      'nai-sampler',
      'noise-schedule',
      'quality-toggle',
      'nai-timeout',
      'steps',
      'steps-value',
      'scale',
      'scale-value',
      'cfg-rescale',
      'cfg-rescale-value',
      'width',
      'width-value',
      'height',
      'height-value',
      'resolution-preset',
      'seed',
      'seed-random',
      'base-positive',
      'artist-prompt',
      'negative-prompt',
      'save-config',
      'save-state',
      'save-state-text',
      'refresh-history',
      'gallery-count',
      'gallery-grid',
      'gallery-empty',
      'gallery-scroll',
      'gallery-clear',
      'export-metadata',
      'album-chips',
      'album-new',
      'album-rename',
      'album-delete',
      'selection-bar',
      'selection-count',
      'selection-all',
      'selection-clear',
      'selection-album',
      'selection-move',
      'selection-delete',
      'open-trash',
      'trash-count',
      'open-prompt-library',
      'prompt-library-count',
      'empty-title',
      'empty-copy',
      'prompt-input',
      'char-count',
      'generate-btn',
      'generate-label',
      'generate-sub',
      'stage-row',
      'stage-text',
      'stage-detail',
      'cancel-job',
      'queue-panel',
      'queue-count',
      'queue-list',
      'queue-cancel-all',
      'progress-track',
      'progress-fill',
      'lightbox',
      'lightbox-image',
      'lightbox-close',
      'lightbox-date',
      'lightbox-chips',
      'lightbox-prev',
      'lightbox-next',
      'lightbox-counter',
      'lightbox-prompt-edit',
      'lightbox-negative-edit',
      'lightbox-prompt-reset',
      'lightbox-rerender-model',
      'lightbox-seed-mode',
      'lightbox-album',
      'lightbox-rerender',
      'lightbox-reuse',
      'lightbox-copy',
      'lightbox-delete',
      'lightbox-download',
      'lightbox-metadata',
      'lightbox-set-cover',
      'lightbox-save-prompt',
      'tag-weight-editor',
      'tag-weight-count',
      'tag-weight-list',
      'tag-weight-reset',
      'trash-dialog',
      'trash-close',
      'trash-empty',
      'trash-list',
      'trash-empty-text',
      'prompt-dialog',
      'prompt-dialog-close',
      'prompt-form',
      'prompt-id',
      'prompt-name',
      'prompt-form-mode',
      'prompt-positive',
      'prompt-negative',
      'prompt-form-reset',
      'prompt-save',
      'prompt-list',
      'prompt-list-count',
      'prompt-list-empty',
      'preset-dialog',
      'preset-dialog-form',
      'preset-dialog-title',
      'preset-dialog-help',
      'preset-name-label',
      'preset-name-input',
      'preset-dialog-error',
      'preset-dialog-cancel',
      'preset-dialog-confirm',
      'confirm-dialog',
      'confirm-dialog-form',
      'confirm-dialog-title',
      'confirm-dialog-message',
      'confirm-dialog-cancel',
      'confirm-dialog-ok',
      'toast-stack',
    ];

    for (const id of ids) {
      const key = id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      ui[key] = document.getElementById(id);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Small utilities                                                        */
  /* ---------------------------------------------------------------------- */

  function asText(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
  }

  function formatCardDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const pad = (number) => String(number).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatFullDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '未知时间';
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function formatDuration(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
    if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
    return `${(milliseconds / 1000).toFixed(1)}s`;
  }

  function modelLabel(modelId) {
    return NAI_MODEL_LABELS[modelId] || asText(modelId, 'NovelAI');
  }

  function samplerLabel(samplerId) {
    return SAMPLER_LABELS[samplerId] || asText(samplerId, '—');
  }

  function noiseLabel(noiseId) {
    return NOISE_LABELS[noiseId] || asText(noiseId, '—');
  }

  function llmProviderLabel(provider) {
    return provider === 'gemini' ? 'Gemini' : 'OpenAI 兼容';
  }

  function createMetaChip(text, accent = false) {
    const chip = document.createElement('span');
    chip.className = accent ? 'meta-chip meta-chip--accent' : 'meta-chip';
    chip.textContent = text;
    return chip;
  }

  function showToast(message, type = 'info', ttl = 4400) {
    const text = asText(message, '发生未知错误。');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.dataset.type = type;
    toast.textContent = text;
    toast.title = '点击关闭';

    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      state.toastTimers.delete(timer);
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 210);
    };
    const timer = window.setTimeout(remove, ttl);
    state.toastTimers.add(timer);
    toast.addEventListener('click', remove);
    ui.toastStack.append(toast);

    while (ui.toastStack.children.length > 4) {
      ui.toastStack.firstElementChild?.remove();
    }
  }

  async function requestJson(url, options = {}) {
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetch(url, {
        cache: 'no-store',
        ...options,
        headers,
      });
    } catch {
      throw new Error('无法连接本地服务，请确认 npm start 仍在运行。');
    }

    const contentType = response.headers.get('content-type') || '';
    let payload = null;
    if (contentType.includes('application/json')) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      throw new Error(
        payload?.error?.message || `本地服务请求失败（HTTP ${response.status}）。`,
      );
    }
    if (!payload || typeof payload !== 'object') {
      throw new Error('本地服务返回了无法解析的响应。');
    }
    return payload;
  }

  async function copyText(text) {
    const value = asText(text);
    if (!value) {
      showToast('没有可复制的 Tag。', 'warning');
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.top = '-9999px';
        area.style.opacity = '0';
        document.body.append(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        if (!ok) throw new Error('execCommand copy failed');
      }
      showToast('最终 Tag 已复制到剪贴板。', 'success', 2400);
    } catch {
      showToast('复制失败，请在详情面板中手动选择文本。', 'error');
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Save state + dirty tracking                                            */
  /* ---------------------------------------------------------------------- */

  function setSaveState(kind, text) {
    ui.saveState.dataset.state = kind;
    ui.saveStateText.textContent = text;
  }

  function markDirty() {
    if (!state.loaded) return;
    state.editVersion += 1;
    state.dirty = true;
    setSaveState('dirty', '有未保存的更改');
  }

  function collectConfig() {
    return {
      llm: {
        ...collectLlmSettings(),
        presets: state.presets.map((preset) => clonePreset(preset)),
      },
      novelai: {
        ...collectNaiSettings(),
        presets: state.naiPresets.map((preset) => cloneNaiPreset(preset)),
      },
    };
  }

  async function persistConfig({ silent = false } = {}) {
    if (state.saving) {
      throw new Error('配置正在保存，请稍后再试。');
    }

    const versionAtSave = state.editVersion;
    state.saving = true;
    ui.saveConfig.disabled = true;
    setSaveState('saving', '正在保存配置…');

    try {
      const payload = await requestJson('/api/config', {
        method: 'POST',
        body: JSON.stringify(collectConfig()),
      });

      if (state.editVersion === versionAtSave) {
        state.dirty = false;
        setSaveState('saved', '配置已保存');
        if (!silent) showToast('配置已保存到 data/config.json。', 'success');
      } else {
        // The user edited a field while the request was in flight. Keep the
        // newer UI state marked as unsaved instead of claiming it was persisted.
        state.dirty = true;
        setSaveState('dirty', '有新的未保存更改');
      }
      return payload.config;
    } catch (error) {
      setSaveState('error', '配置保存失败');
      throw error;
    } finally {
      state.saving = false;
      ui.saveConfig.disabled = false;
    }
  }

  async function handleSave() {
    try {
      await persistConfig();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  /* ---------------------------------------------------------------------- */
  /* LLM settings, presets, prompt structure, model list                    */
  /* ---------------------------------------------------------------------- */

  function uid() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function clonePromptBlocks(blocks) {
    return (Array.isArray(blocks) ? blocks : []).map((block) => ({
      id: asText(block?.id) || uid(),
      role: ['system', 'assistant', 'user'].includes(block?.role) ? block.role : 'system',
      position: block?.position === 'after' ? 'after' : 'before',
      enabled: block?.enabled !== false,
      content: asText(block?.content),
    }));
  }

  function clonePreset(preset) {
    return {
      id: preset.id,
      name: preset.name,
      apiKey: preset.apiKey,
      baseUrl: preset.baseUrl,
      model: preset.model,
      temperature: preset.temperature,
      topP: preset.topP,
      maxTokens: preset.maxTokens,
      reasoningEffort: preset.reasoningEffort,
      timeoutSeconds: preset.timeoutSeconds,
      promptBlocks: clonePromptBlocks(preset.promptBlocks),
      availableModels: [...(preset.availableModels || [])],
      availableModelsBaseUrl: preset.availableModelsBaseUrl || '',
    };
  }

  function normalizePreset(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      id: asText(raw.id) || uid(),
      name: asText(raw.name) || '未命名预设',
      apiKey: asText(raw.apiKey),
      baseUrl: asText(raw.baseUrl),
      model: asText(raw.model),
      temperature: Number.isFinite(Number(raw.temperature)) ? Number(raw.temperature) : 0.4,
      topP: Number.isFinite(Number(raw.topP)) ? Number(raw.topP) : 1,
      maxTokens: Number.isFinite(Number(raw.maxTokens)) ? Number(raw.maxTokens) : 1024,
      reasoningEffort: ['low', 'medium', 'high'].includes(raw.reasoningEffort)
        ? raw.reasoningEffort
        : '',
      timeoutSeconds: Number.isFinite(Number(raw.timeoutSeconds))
        ? Number(raw.timeoutSeconds)
        : 120,
      promptBlocks: clonePromptBlocks(raw.promptBlocks),
      availableModels: Array.isArray(raw.availableModels)
        ? raw.availableModels.filter((model) => typeof model === 'string')
        : [],
      availableModelsBaseUrl: asText(raw.availableModelsBaseUrl),
    };
  }

  function collectLlmSettings() {
    return {
      apiKey: ui.llmApiKey.value.trim(),
      baseUrl: ui.llmBaseUrl.value.trim(),
      model: ui.llmModel.value.trim(),
      temperature: Number(ui.llmTemperature.value),
      topP: Number(ui.llmTopP.value),
      maxTokens: Number(ui.llmMaxTokens.value),
      reasoningEffort: ui.llmReasoning.value,
      timeoutSeconds: Number(ui.llmTimeout.value),
      promptBlocks: clonePromptBlocks(state.promptBlocks),
      availableModels: [...state.availableModels],
      availableModelsBaseUrl: state.availableModelsBaseUrl,
    };
  }

  function applyLlmSettings(settings) {
    ui.llmApiKey.value = asText(settings.apiKey);
    ui.llmBaseUrl.value = asText(settings.baseUrl, 'https://api.deepseek.com/v1');
    ui.llmModel.value = asText(settings.model, 'deepseek-chat');

    const numeric = [
      [ui.llmTemperature, settings.temperature, '0.4'],
      [ui.llmTopP, settings.topP, '1'],
      [ui.llmMaxTokens, settings.maxTokens, '1024'],
      [ui.llmTimeout, settings.timeoutSeconds, '120'],
    ];
    for (const [input, value, fallback] of numeric) {
      input.value = Number.isFinite(Number(value)) ? String(value) : fallback;
    }

    ui.llmReasoning.value = ['low', 'medium', 'high'].includes(settings.reasoningEffort)
      ? settings.reasoningEffort
      : '';

    state.promptBlocks = clonePromptBlocks(settings.promptBlocks);
    state.availableModels = Array.isArray(settings.availableModels)
      ? settings.availableModels.filter((model) => typeof model === 'string')
      : [];
    state.availableModelsBaseUrl = asText(settings.availableModelsBaseUrl);

    renderPromptBlocks();
    refreshModelSuggestions();
    renderModelPicker();
  }

  /* Model list ------------------------------------------------------------ */

  function setModelSuggestions(models) {
    const values = [];
    const add = (value) => {
      const id = asText(value).trim();
      if (!id || values.includes(id)) return;
      values.push(id);
    };

    for (const model of models) add(model);
    add(ui.llmModel.value);
    if (values.length === 0) for (const model of MODEL_SUGGESTIONS) add(model);

    ui.llmModelOptions.replaceChildren(
      ...values.map((value) => {
        const option = document.createElement('option');
        option.value = value;
        return option;
      }),
    );
  }

  function refreshModelSuggestions() {
    setModelSuggestions(
      state.availableModels.length > 0 ? state.availableModels : MODEL_SUGGESTIONS,
    );
  }

  function renderModelPicker() {
    const models = state.availableModels;
    const baseUrl = ui.llmBaseUrl.value.trim();
    const visible =
      models.length > 0 &&
      (!state.availableModelsBaseUrl || state.availableModelsBaseUrl === baseUrl);

    ui.llmModelPicker.hidden = !visible;
    ui.llmModelCount.textContent = visible ? `${models.length} 个可用` : '';

    if (!visible) {
      ui.llmModelList.replaceChildren();
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const model of models) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'model-option';
      row.textContent = model;
      row.title = model;
      row.dataset.model = model;
      row.addEventListener('click', () => {
        ui.llmModel.value = model;
        markDirty();
        syncModelPickerSelection();
      });
      fragment.append(row);
    }
    ui.llmModelList.replaceChildren(fragment);
    syncModelPickerSelection();
  }

  function syncModelPickerSelection() {
    const current = ui.llmModel.value.trim();
    for (const row of ui.llmModelList.children) {
      row.classList.toggle('is-active', row.dataset.model === current);
    }
  }

  async function persistModelList() {
    try {
      await requestJson('/api/config', {
        method: 'POST',
        body: JSON.stringify({
          llm: {
            availableModels: state.availableModels,
            availableModelsBaseUrl: state.availableModelsBaseUrl,
          },
        }),
      });
    } catch {
      // Persisting the list is a convenience; generation works without it.
    }
  }

  async function handleFetchModels() {
    const baseUrl = ui.llmBaseUrl.value.trim();
    const apiKey = ui.llmApiKey.value.trim();

    if (!baseUrl) {
      showToast('请先填写 LLM Base URL。', 'warning');
      focusField(ui.llmBaseUrl);
      return;
    }
    if (!apiKey) {
      showToast('请先填写 LLM API Key 再拉取模型。', 'warning');
      focusField(ui.llmApiKey);
      return;
    }

    const button = ui.llmModelFetch;
    button.disabled = true;
    button.textContent = '拉取中…';

    try {
      const payload = await requestJson('/api/llm/models', {
        method: 'POST',
        body: JSON.stringify({ baseUrl, apiKey }),
      });
      const models = Array.isArray(payload.models)
        ? payload.models.filter((model) => typeof model === 'string' && model.trim())
        : [];

      if (models.length === 0) throw new Error('接口没有返回可用的模型。');

      state.availableModels = models;
      state.availableModelsBaseUrl = baseUrl;
      if (!ui.llmModel.value.trim()) {
        ui.llmModel.value = models[0];
        markDirty();
      }

      refreshModelSuggestions();
      renderModelPicker();
      await persistModelList();

      showToast(`已拉取 ${models.length} 个模型，已列在模型输入框下方。`, 'success', 3800);
    } catch (error) {
      showToast(error.message || '拉取模型失败。', 'error', 6000);
    } finally {
      button.disabled = false;
      button.textContent = '拉取模型';
    }
  }

  /* Prompt structure ------------------------------------------------------ */

  function updatePromptBlockCount() {
    ui.promptBlocksCount.textContent = `${state.promptBlocks.length} 段`;
    ui.promptBlockAdd.disabled = state.promptBlocks.length >= MAX_PROMPT_BLOCKS;
  }

  function createTinyButton(text, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pb-btn';
    button.textContent = text;
    button.title = label;
    button.setAttribute('aria-label', label);
    return button;
  }

  function makePromptSelect(labels, value, ariaLabel) {
    const select = document.createElement('select');
    select.className = 'prompt-block-select';
    select.setAttribute('aria-label', ariaLabel);
    for (const [optionValue, label] of Object.entries(labels)) {
      select.append(new Option(label, optionValue));
    }
    select.value = value;
    return select;
  }

  function renderPromptBlocks() {
    const fragment = document.createDocumentFragment();

    state.promptBlocks.forEach((block, index) => {
      const card = document.createElement('div');
      card.className = 'prompt-block';
      card.dataset.id = block.id;

      const head = document.createElement('div');
      head.className = 'prompt-block-head';

      const role = makePromptSelect(PROMPT_ROLE_LABELS, block.role, '提示词角色');
      role.addEventListener('change', () => {
        block.role = role.value;
        markDirty();
      });

      const position = makePromptSelect(PROMPT_POSITION_LABELS, block.position, '插入位置');
      position.addEventListener('change', () => {
        block.position = position.value;
        markDirty();
      });

      const actions = document.createElement('div');
      actions.className = 'prompt-block-actions';

      const up = createTinyButton('↑', '上移');
      up.disabled = index === 0;
      up.addEventListener('click', () => movePromptBlock(block.id, -1));

      const down = createTinyButton('↓', '下移');
      down.disabled = index === state.promptBlocks.length - 1;
      down.addEventListener('click', () => movePromptBlock(block.id, 1));

      const remove = createTinyButton('×', '删除这段提示词');
      remove.addEventListener('click', () => removePromptBlock(block.id));

      actions.append(up, down, remove);
      head.append(role, position, actions);

      const area = document.createElement('textarea');
      area.rows = 3;
      area.spellcheck = false;
      area.value = block.content;
      area.placeholder =
        block.role === 'system' ? '系统指令，例如标签生成规则…' : '这段提示词的内容…';
      area.addEventListener('input', () => {
        block.content = area.value;
        markDirty();
      });

      card.append(head, area);
      fragment.append(card);
    });

    ui.promptBlocks.replaceChildren(fragment);
    updatePromptBlockCount();
  }

  function addPromptBlock() {
    if (state.promptBlocks.length >= MAX_PROMPT_BLOCKS) return;
    state.promptBlocks.push({
      id: uid(),
      role: 'system',
      position: 'before',
      enabled: true,
      content: '',
    });
    markDirty();
    renderPromptBlocks();
    const areas = ui.promptBlocks.querySelectorAll('textarea');
    areas[areas.length - 1]?.focus();
  }

  function removePromptBlock(id) {
    state.promptBlocks = state.promptBlocks.filter((block) => block.id !== id);
    markDirty();
    renderPromptBlocks();
  }

  function movePromptBlock(id, delta) {
    const index = state.promptBlocks.findIndex((block) => block.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= state.promptBlocks.length) return;

    const [block] = state.promptBlocks.splice(index, 1);
    state.promptBlocks.splice(target, 0, block);
    markDirty();
    renderPromptBlocks();
  }

  /* Presets --------------------------------------------------------------- */

  function renderPresetSelect() {
    const options = [new Option('当前配置', 'current')];
    for (const preset of state.presets) options.push(new Option(preset.name, preset.id));

    ui.llmPreset.replaceChildren(...options);

    const selected = state.presets.some((preset) => preset.id === state.activePresetId)
      ? state.activePresetId
      : 'current';
    ui.llmPreset.value = selected;
    state.activePresetId = selected;
    ui.llmPresetDelete.disabled = selected === 'current';
    ui.llmPresetSave.textContent = selected === 'current' ? '保存预设' : '更新预设';
    ui.llmPresetSave.title =
      selected === 'current'
        ? '把当前 LLM 配置保存为预设（可自定义名称）'
        : '更新当前选中的预设，或修改它的名称';
  }

  function defaultPresetName(settings) {
    let host = '自定义端点';
    try {
      host = new URL(settings.baseUrl).hostname || host;
    } catch {
      /* keep the fallback label */
    }

    const base = `${host} · ${settings.model || '未命名模型'}`;
    let name = base;
    let counter = 2;
    while (state.presets.some((preset) => preset.name === name)) {
      name = `${base} (${counter})`;
      counter += 1;
    }
    return name.slice(0, 60);
  }

  /* Preset naming dialog --------------------------------------------------- */

  let presetDialogResolve = null;
  let presetDialogValidate = null;

  function askPresetName({
    title,
    help,
    value = '',
    validate = null,
    label = '预设名称',
    placeholder = '例如：DeepSeek 推理 / V5 竖图',
    confirmLabel = '保存',
    maxLength = 60,
  }) {
    if (presetDialogResolve) {
      const pending = presetDialogResolve;
      presetDialogResolve = null;
      pending(null);
    }

    ui.presetDialogTitle.textContent = title;
    ui.presetDialogHelp.textContent = help;
    ui.presetNameLabel.textContent = label;
    ui.presetNameInput.value = value;
    ui.presetNameInput.placeholder = placeholder;
    ui.presetNameInput.maxLength = maxLength;
    ui.presetDialogConfirm.textContent = confirmLabel;
    ui.presetDialogError.textContent = '';
    presetDialogValidate = validate;

    return new Promise((resolve) => {
      presetDialogResolve = resolve;
      if (!ui.presetDialog.open) ui.presetDialog.showModal();
      window.setTimeout(() => {
        ui.presetNameInput.focus();
        ui.presetNameInput.select();
      }, 30);
    });
  }

  let confirmDialogResolve = null;

  function askConfirm({ title, message, confirmLabel = '确认', tone = '' }) {
    if (confirmDialogResolve) {
      const pending = confirmDialogResolve;
      confirmDialogResolve = null;
      pending(false);
    }

    ui.confirmDialogTitle.textContent = title;
    ui.confirmDialogMessage.textContent = message;
    ui.confirmDialogOk.textContent = confirmLabel;
    ui.confirmDialogOk.classList.toggle('btn-danger', tone === 'danger');
    ui.confirmDialogOk.classList.toggle('btn-primary', tone !== 'danger');

    return new Promise((resolve) => {
      confirmDialogResolve = resolve;
      if (!ui.confirmDialog.open) ui.confirmDialog.showModal();
      window.setTimeout(() => ui.confirmDialogCancel.focus(), 30);
    });
  }

  function closeConfirmDialog(value) {
    const resolve = confirmDialogResolve;
    confirmDialogResolve = null;
    if (ui.confirmDialog.open) ui.confirmDialog.close();
    if (resolve) resolve(value);
  }

  function closePresetDialog(value) {
    const resolve = presetDialogResolve;
    presetDialogResolve = null;
    presetDialogValidate = null;
    if (ui.presetDialog.open) ui.presetDialog.close();
    if (resolve) resolve(value);
  }

  function handlePresetDialogSubmit(event) {
    event.preventDefault();
    if (!presetDialogResolve) return;

    const name = ui.presetNameInput.value.trim().slice(0, ui.presetNameInput.maxLength || 60);
    if (!name) {
      ui.presetDialogError.textContent = '请填写预设名称。';
      ui.presetNameInput.focus();
      return;
    }

    if (typeof presetDialogValidate === 'function') {
      const error = presetDialogValidate(name);
      if (error) {
        ui.presetDialogError.textContent = error;
        return;
      }
    }

    closePresetDialog(name);
  }

  async function handlePresetSave() {
    const selectedId = ui.llmPreset.value;
    const selected =
      selectedId !== 'current'
        ? state.presets.find((item) => item.id === selectedId)
        : null;
    const settings = collectLlmSettings();
    const suggested = selected ? selected.name : defaultPresetName(settings);

    const name = await askPresetName({
      title: selected ? '重命名 / 更新 LLM 预设' : '保存 LLM 预设',
      help: '预设会保存 Base URL、Key、模型、参数、提示词结构与已拉取模型列表。',
      value: suggested,
      validate: (value) =>
        state.presets.some((item) => item.id !== selected?.id && item.name === value)
          ? '已存在同名预设，请换一个名称。'
          : '',
    });
    if (!name) return;

    let preset = selected;
    const updated = Boolean(preset);
    const previousPresets = JSON.parse(JSON.stringify(state.presets));
    const previousActive = state.activePresetId;

    if (preset) {
      preset.name = name;
      Object.assign(preset, settings);
    } else {
      preset = { id: uid(), name, ...settings };
      state.presets.push(preset);
      state.activePresetId = preset.id;
    }

    renderPresetSelect();

    try {
      await persistConfig();
      showToast(
        updated ? `已更新预设「${preset.name}」。` : `已保存预设「${preset.name}」。`,
        'success',
        3600,
      );
    } catch (error) {
      state.presets = previousPresets;
      state.activePresetId = previousActive;
      renderPresetSelect();
      showToast(error.message, 'error');
    }
  }

  async function handlePresetDelete() {
    const selectedId = ui.llmPreset.value;
    if (selectedId === 'current') return;

    const preset = state.presets.find((item) => item.id === selectedId);
    if (!preset) return;

    state.presets = state.presets.filter((item) => item.id !== selectedId);
    state.activePresetId = 'current';
    renderPresetSelect();

    try {
      await persistConfig();
      showToast(`已删除预设「${preset.name}」。`, 'success', 3200);
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  function handlePresetChange() {
    const selectedId = ui.llmPreset.value;
    state.activePresetId = selectedId;
    ui.llmPresetDelete.disabled = selectedId === 'current';
    if (selectedId === 'current') return;

    const preset = state.presets.find((item) => item.id === selectedId);
    if (!preset) return;

    applyLlmSettings(preset);
    markDirty();
    showToast(`已载入预设「${preset.name}」，保存后生效。`, 'info', 3800);
  }

  /* NovelAI presets -------------------------------------------------------- */

  function cloneNaiPreset(preset) {
    return {
      id: preset.id,
      name: preset.name,
      model: preset.model,
      sampler: preset.sampler,
      noiseSchedule: preset.noiseSchedule,
      steps: preset.steps,
      scale: preset.scale,
      cfgRescale: preset.cfgRescale,
      width: preset.width,
      height: preset.height,
      seed: preset.seed,
      qualityToggle: preset.qualityToggle,
      basePositive: preset.basePositive,
      artistPrompt: preset.artistPrompt,
      negativePrompt: preset.negativePrompt,
    };
  }

  function normalizeNaiPreset(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      id: asText(raw.id) || uid(),
      name: asText(raw.name) || '未命名预设',
      model: asText(raw.model, 'nai-diffusion-4-5-full'),
      sampler: asText(raw.sampler, 'k_euler_ancestral'),
      noiseSchedule: asText(raw.noiseSchedule, 'karras'),
      steps: Number.isFinite(Number(raw.steps)) ? Number(raw.steps) : 28,
      scale: Number.isFinite(Number(raw.scale)) ? Number(raw.scale) : 5,
      cfgRescale: Number.isFinite(Number(raw.cfgRescale)) ? Number(raw.cfgRescale) : 0,
      width: Number.isFinite(Number(raw.width)) ? Number(raw.width) : 832,
      height: Number.isFinite(Number(raw.height)) ? Number(raw.height) : 1216,
      seed: Number.isInteger(Number(raw.seed)) ? Number(raw.seed) : -1,
      qualityToggle: typeof raw.qualityToggle === 'boolean' ? raw.qualityToggle : true,
      basePositive: asText(raw.basePositive),
      artistPrompt: asText(raw.artistPrompt),
      negativePrompt: asText(raw.negativePrompt),
    };
  }

  function ensureSelectOption(select, value) {
    const id = asText(value).trim();
    if (!id) return;
    if (Array.from(select.options).some((option) => option.value === id)) {
      select.value = id;
      return;
    }
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id;
    select.append(option);
    select.value = id;
  }

  function collectNaiSettings({ includeKey = true } = {}) {
    const seedValue = Number.parseInt(ui.seed.value, 10);
    const timeout = Number.parseInt(ui.naiTimeout.value, 10);
    const settings = {
      model: ui.naiModel.value,
      sampler: ui.naiSampler.value,
      noiseSchedule: ui.noiseSchedule.value,
      steps: Number(ui.steps.value),
      scale: Number(ui.scale.value),
      cfgRescale: Number(ui.cfgRescale.value),
      width: Number(ui.width.value),
      height: Number(ui.height.value),
      seed: Number.isInteger(seedValue) && seedValue >= 0 ? seedValue : -1,
      qualityToggle: ui.qualityToggle.checked,
      timeoutSeconds: Number.isFinite(timeout) ? Math.min(900, Math.max(30, timeout)) : 300,
      basePositive: ui.basePositive.value,
      artistPrompt: ui.artistPrompt.value,
      negativePrompt: ui.negativePrompt.value,
    };
    if (includeKey) settings.apiKey = ui.naiApiKey.value.trim();
    return settings;
  }

  function applyNaiSettings(settings) {
    ensureSelectOption(ui.naiModel, settings.model || 'nai-diffusion-4-5-full');
    ensureSelectOption(ui.naiSampler, settings.sampler || 'k_euler_ancestral');
    ensureSelectOption(ui.noiseSchedule, settings.noiseSchedule || 'karras');

    const numeric = [
      [ui.steps, settings.steps, '28'],
      [ui.scale, settings.scale, '5'],
      [ui.cfgRescale, settings.cfgRescale, '0'],
      [ui.width, settings.width, '832'],
      [ui.height, settings.height, '1216'],
    ];
    for (const [input, value, fallback] of numeric) {
      input.value = Number.isFinite(Number(value)) ? String(value) : fallback;
    }

    // Timeout is account-level request config, not part of a NAI preset; only
    // overwrite the input when the caller actually provides a value.
    const timeout = Number(settings.timeoutSeconds);
    if (Number.isFinite(timeout) && timeout > 0) {
      ui.naiTimeout.value = String(Math.min(900, Math.max(30, timeout)));
    }

    const seed = Number(settings.seed);
    ui.seed.value = Number.isInteger(seed) && seed >= 0 ? String(seed) : '-1';
    ui.qualityToggle.checked =
      typeof settings.qualityToggle === 'boolean' ? settings.qualityToggle : true;
    ui.basePositive.value = asText(settings.basePositive);
    ui.artistPrompt.value = asText(settings.artistPrompt);
    ui.negativePrompt.value = asText(settings.negativePrompt);

    syncRangeDisplays();
    updateResolutionPreset();
  }

  function defaultNaiPresetName(settings) {
    const base = `${modelLabel(settings.model)} · ${settings.width}×${settings.height}`;
    let name = base;
    let counter = 2;
    while (state.naiPresets.some((preset) => preset.name === name)) {
      name = `${base} (${counter})`;
      counter += 1;
    }
    return name.slice(0, 60);
  }

  function renderNaiPresetSelect() {
    const options = [new Option('当前配置', 'current')];
    for (const preset of state.naiPresets) options.push(new Option(preset.name, preset.id));
    ui.naiPreset.replaceChildren(...options);

    const selected = state.naiPresets.some((preset) => preset.id === state.activeNaiPresetId)
      ? state.activeNaiPresetId
      : 'current';
    ui.naiPreset.value = selected;
    state.activeNaiPresetId = selected;
    ui.naiPresetDelete.disabled = selected === 'current';
    ui.naiPresetSave.textContent = selected === 'current' ? '保存预设' : '更新预设';
    ui.naiPresetSave.title =
      selected === 'current'
        ? '把当前 NovelAI 配置保存为预设（可自定义名称）'
        : '更新当前选中的预设，或修改它的名称';
  }

  async function handleNaiPresetSave() {
    const selectedId = ui.naiPreset.value;
    const selected =
      selectedId !== 'current'
        ? state.naiPresets.find((item) => item.id === selectedId)
        : null;
    const settings = collectNaiSettings({ includeKey: false });
    const suggested = selected ? selected.name : defaultNaiPresetName(settings);

    const name = await askPresetName({
      title: selected ? '重命名 / 更新 NovelAI 预设' : '保存 NovelAI 预设',
      help: '预设保存模型、采样参数、尺寸、Seed 与提示词；不包含 API Key 和 Base URL。',
      value: suggested,
      validate: (value) =>
        state.naiPresets.some((item) => item.id !== selected?.id && item.name === value)
          ? '已存在同名预设，请换一个名称。'
          : '',
    });
    if (!name) return;

    let preset = selected;
    const updated = Boolean(preset);
    const previousPresets = JSON.parse(JSON.stringify(state.naiPresets));
    const previousActive = state.activeNaiPresetId;

    if (preset) {
      preset.name = name;
      Object.assign(preset, settings);
    } else {
      preset = { id: uid(), name, ...settings };
      state.naiPresets.push(preset);
      state.activeNaiPresetId = preset.id;
    }

    renderNaiPresetSelect();

    try {
      await persistConfig();
      showToast(
        updated ? `已更新预设「${preset.name}」。` : `已保存预设「${preset.name}」。`,
        'success',
        3600,
      );
    } catch (error) {
      state.naiPresets = previousPresets;
      state.activeNaiPresetId = previousActive;
      renderNaiPresetSelect();
      showToast(error.message, 'error');
    }
  }

  async function handleNaiPresetDelete() {
    const selectedId = ui.naiPreset.value;
    if (selectedId === 'current') return;

    const preset = state.naiPresets.find((item) => item.id === selectedId);
    if (!preset) return;

    state.naiPresets = state.naiPresets.filter((item) => item.id !== selectedId);
    state.activeNaiPresetId = 'current';
    renderNaiPresetSelect();

    try {
      await persistConfig();
      showToast(`已删除预设「${preset.name}」。`, 'success', 3200);
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  function handleNaiPresetChange() {
    const selectedId = ui.naiPreset.value;
    state.activeNaiPresetId = selectedId;
    ui.naiPresetDelete.disabled = selectedId === 'current';
    if (selectedId === 'current') return;

    const preset = state.naiPresets.find((item) => item.id === selectedId);
    if (!preset) return;

    applyNaiSettings(preset);
    markDirty();
    showToast(`已载入预设「${preset.name}」，保存后生效。`, 'info', 3800);
  }

  function updateRangeFill(input) {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const value = Number(input.value);
    const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--range-fill', `${Math.min(100, Math.max(0, fill))}%`);
  }

  function syncRangeDisplays() {
    ui.stepsValue.textContent = ui.steps.value;
    ui.scaleValue.textContent = Number(ui.scale.value).toFixed(1);
    ui.cfgRescaleValue.textContent = Number(ui.cfgRescale.value).toFixed(2);
    ui.widthValue.textContent = ui.width.value;
    ui.heightValue.textContent = ui.height.value;

    for (const input of [ui.steps, ui.scale, ui.cfgRescale, ui.width, ui.height]) {
      updateRangeFill(input);
    }
  }

  function updateResolutionPreset() {
    const width = Number(ui.width.value);
    const height = Number(ui.height.value);
    const match = Object.entries(RESOLUTION_PRESETS).find(
      ([, size]) => size.width === width && size.height === height,
    );
    ui.resolutionPreset.value = match ? match[0] : 'custom';
  }

  function applyDimensions(width, height) {
    ui.width.value = String(width);
    ui.height.value = String(height);
    ui.widthValue.textContent = ui.width.value;
    ui.heightValue.textContent = ui.height.value;
    updateRangeFill(ui.width);
    updateRangeFill(ui.height);
    updateResolutionPreset();
  }

  function onResolutionPresetChange() {
    const preset = RESOLUTION_PRESETS[ui.resolutionPreset.value];
    if (!preset) {
      markDirty();
      return;
    }
    applyDimensions(preset.width, preset.height);
    markDirty();
  }

  function onDimensionInput() {
    ui.widthValue.textContent = ui.width.value;
    ui.heightValue.textContent = ui.height.value;
    updateRangeFill(ui.width);
    updateRangeFill(ui.height);
    updateResolutionPreset();
  }

  /* ---------------------------------------------------------------------- */
  /* Config load                                                            */
  /* ---------------------------------------------------------------------- */

  function applyConfig(config) {
    const llm = config?.llm || {};
    const novai = config?.novelai || {};

    applyLlmSettings(llm);

    state.presets = Array.isArray(llm.presets)
      ? llm.presets.map(normalizePreset).filter(Boolean)
      : [];
    state.activePresetId = 'current';
    renderPresetSelect();

    ui.naiApiKey.value = asText(novai.apiKey);

    applyNaiSettings(novai);

    state.naiPresets = Array.isArray(novai.presets)
      ? novai.presets.map(normalizeNaiPreset).filter(Boolean)
      : [];
    state.activeNaiPresetId = 'current';
    renderNaiPresetSelect();
  }

  async function loadConfig() {
    const payload = await requestJson('/api/config');
    applyConfig(payload.config);
  }

  /* ---------------------------------------------------------------------- */
  /* History + gallery                                                      */
  /* ---------------------------------------------------------------------- */

  function isValidHistoryItem(item) {
    return Boolean(
      item &&
        typeof item.id === 'string' &&
        typeof item.url === 'string' &&
        /^\/outputs\/(?:albums\/[a-z0-9_-]+\/)?[a-z0-9._-]+\.(png|jpe?g|webp)$/i.test(item.url),
    );
  }

  function normalizeHistoryItem(item) {
    if (!isValidHistoryItem(item)) return null;
    return {
      id: item.id,
      filename: asText(item.filename, ''),
      relativePath: asText(item.relativePath, ''),
      url: item.url,
      albumId: asText(item.albumId) || null,
      parentId: asText(item.parentId),
      prompt: asText(item.prompt),
      llmTags: asText(item.llmTags),
      negativePrompt: asText(item.negativePrompt),
      model: asText(item.model, 'nai-diffusion-4-5-full'),
      sampler: asText(item.sampler, 'k_euler_ancestral'),
      noiseSchedule: asText(item.noiseSchedule, 'karras'),
      steps: Number.isFinite(Number(item.steps)) ? Number(item.steps) : 28,
      scale: Number.isFinite(Number(item.scale)) ? Number(item.scale) : 5,
      cfgRescale: Number.isFinite(Number(item.cfgRescale)) ? Number(item.cfgRescale) : 0,
      width: Number.isFinite(Number(item.width)) ? Number(item.width) : 832,
      height: Number.isFinite(Number(item.height)) ? Number(item.height) : 1216,
      seed: Number.isInteger(Number(item.seed)) ? Number(item.seed) : -1,
      qualityToggle: Boolean(item.qualityToggle),
      llmProvider: asText(item.llmProvider, 'openai'),
      llmModel: asText(item.llmModel),
      createdAt: asText(item.createdAt),
      elapsedMs: Number(item.elapsedMs) || 0,
    };
  }

  function albumName(albumId) {
    return state.albums.find((album) => album.id === albumId)?.name || '未知画册';
  }

  function activeAlbum() {
    return state.albums.find((album) => album.id === state.activeAlbumId) || null;
  }

  function itemMatchesFilter(item) {
    if (state.activeAlbumId === 'all') return true;
    if (state.activeAlbumId === 'uncategorized') return !item.albumId;
    return item.albumId === state.activeAlbumId;
  }

  function visibleHistory() {
    return state.history.filter(itemMatchesFilter);
  }

  function renderAlbums() {
    if (
      state.activeAlbumId !== 'all' &&
      state.activeAlbumId !== 'uncategorized' &&
      !state.albums.some((album) => album.id === state.activeAlbumId)
    ) {
      state.activeAlbumId = 'all';
    }

    const entries = [
      { id: 'all', name: '全部', count: state.history.length },
      {
        id: 'uncategorized',
        name: '未分类',
        count: state.history.filter((item) => !item.albumId).length,
      },
      ...state.albums.map((album) => ({
        id: album.id,
        name: album.name,
        count: state.history.filter((item) => item.albumId === album.id).length,
        album,
      })),
    ];

    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'album-chip';
      chip.dataset.album = entry.id;
      chip.setAttribute('role', 'tab');
      chip.setAttribute(
        'aria-selected',
        String(state.activeAlbumId === entry.id),
      );
      chip.title = entry.album
        ? `画册「${entry.name}」· outputs/albums/${entry.id}`
        : entry.name;

      if (entry.album) {
        if (entry.album.coverUrl) {
          const cover = document.createElement('img');
          cover.className = 'album-chip-cover';
          cover.src = entry.album.coverUrl;
          cover.alt = '';
          cover.loading = 'lazy';
          cover.decoding = 'async';
          cover.draggable = false;
          cover.title = '画册封面';
          chip.append(cover);
        } else {
          const cover = document.createElement('span');
          cover.className = 'album-chip-cover album-chip-cover--empty';
          cover.setAttribute('aria-hidden', 'true');
          chip.append(cover);
        }
      }

      const name = document.createElement('span');
      name.className = 'album-chip-name';
      name.textContent = entry.name;

      const count = document.createElement('span');
      count.className = 'album-chip-count';
      count.textContent = String(entry.count);

      chip.append(name, count);
      chip.addEventListener('click', () => {
        state.activeAlbumId = entry.id;
        renderAlbums();
        renderGallery();
        ui.galleryScroll.scrollTo({ top: 0, behavior: 'smooth' });
      });

      // Dropping a dragged card on an album chip moves it (or the whole
      // selection) into that album; "未分类" is a valid target as well.
      if (entry.id !== 'all') {
        chip.addEventListener('dragover', (event) => {
          if (!state.dragItemId) return;
          event.preventDefault();
          try {
            event.dataTransfer.dropEffect = 'move';
          } catch {
            /* ignore */
          }
          chip.classList.add('album-chip--drop');
        });
        chip.addEventListener('dragleave', () => {
          chip.classList.remove('album-chip--drop');
        });
        chip.addEventListener('drop', (event) => {
          event.preventDefault();
          chip.classList.remove('album-chip--drop');
          const ids = dragMoveIds();
          if (ids.length === 0) return;
          const target = entry.id === 'uncategorized' ? null : entry.id;
          moveItemsToAlbum(ids, target);
        });
      }

      fragment.append(chip);
    }
    ui.albumChips.replaceChildren(fragment);

    const album = activeAlbum();
    ui.albumRename.hidden = !album;
    ui.albumDelete.hidden = !album;
    ui.albumNew.disabled = state.albums.length >= 60;
    ui.albumNew.title =
      state.albums.length >= 60
        ? '画册数量已达上限（60 个）。'
        : '在 outputs/albums 下新建一个画册文件夹';

    renderSelectionAlbumOptions();
  }

  function renderSelectionAlbumOptions() {
    if (!ui.selectionAlbum) return;
    const previous = ui.selectionAlbum.value;
    const options = [new Option('未分类', '')];
    for (const album of state.albums) options.push(new Option(album.name, album.id));
    ui.selectionAlbum.replaceChildren(...options);
    const stillThere = Array.from(ui.selectionAlbum.options).some(
      (option) => option.value === previous,
    );
    ui.selectionAlbum.value = stillThere ? previous : '';
  }

  function updateEmptyCopy() {
    const album = activeAlbum();
    if (state.activeAlbumId === 'uncategorized') {
      ui.emptyTitle.textContent = '未分类还是空的。';
      ui.emptyCopy.textContent =
        '生成作品时保持「未分类」，或把画册中的作品移回这里。所有图片仍保存在 outputs/。';
      return;
    }
    if (album) {
      ui.emptyTitle.textContent = `画册「${album.name}」还是空的。`;
      ui.emptyCopy.textContent =
        '在下方生成新作品，或把已有作品移动到这本画册。画册对应 outputs/albums/ 下的独立文件夹。';
      return;
    }
    ui.emptyTitle.textContent = '把一句话，变成一幅画。';
    ui.emptyCopy.textContent =
      '在下方描述任意画面。LLM 会先提炼成英文 Danbooru Tags，再交由 NovelAI 渲染成图。';
  }

  function renderGallery() {
    ui.galleryGrid.replaceChildren();
    updateEmptyCopy();

    const items = visibleHistory();
    if (items.length === 0) {
      ui.galleryEmpty.hidden = false;
      ui.galleryGrid.hidden = true;
      updateGalleryCount();
      refreshSelectionUI();
      return;
    }

    ui.galleryEmpty.hidden = true;
    ui.galleryGrid.hidden = false;

    const fragment = document.createDocumentFragment();
    for (const item of items) {
      fragment.append(createArtCard(item, false));
    }
    ui.galleryGrid.append(fragment);
    updateGalleryCount();
    refreshSelectionUI();
  }

  function appendGeneratedCard(item) {
    const normalized = normalizeHistoryItem(item);
    if (!normalized) {
      throw new Error('服务端返回的图片记录格式无效。');
    }

    state.lastCreatedId = normalized.id;
    state.history = state.history.filter((entry) => entry.id !== normalized.id);
    state.history.unshift(normalized);

    ui.galleryEmpty.hidden = true;
    ui.galleryGrid.hidden = false;

    if (itemMatchesFilter(normalized)) {
      ui.galleryGrid.prepend(createArtCard(normalized, true));
      updateGalleryCount();
      window.requestAnimationFrame(() => {
        ui.galleryScroll.scrollTo({ top: 0, behavior: 'smooth' });
      });
    } else {
      renderGallery();
    }
    renderAlbums();
  }

  function updateGalleryCount() {
    const visible = visibleHistory().length;
    ui.galleryCount.textContent =
      state.activeAlbumId === 'all'
        ? `${visible} 张`
        : `${visible} / ${state.history.length} 张`;
    ui.galleryCount.title = activeAlbum()
      ? `当前画册：${activeAlbum().name}`
      : state.activeAlbumId === 'uncategorized'
        ? '当前：未分类'
        : '全部作品';
  }

  function createArtCard(item, fresh) {
    const card = document.createElement('article');
    card.className = fresh ? 'art-card art-card--new' : 'art-card';
    card.dataset.id = item.id;
    card.draggable = true;
    card.classList.toggle('is-selected', state.selected.has(item.id));

    const selectButton = document.createElement('button');
    selectButton.type = 'button';
    selectButton.className = 'card-select';
    selectButton.dataset.id = item.id;
    selectButton.setAttribute('aria-pressed', String(state.selected.has(item.id)));
    selectButton.setAttribute('aria-label', '选择这张作品');
    selectButton.title = '选择这张作品（批量移动 / 删除 / 拖拽排序）';
    selectButton.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.4 8.5l3.1 3.1 6.1-6.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    selectButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleSelection(item.id);
    });

    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'art-thumb';
    thumb.draggable = true;
    thumb.setAttribute('aria-label', '查看图片大图与最终 Tag');

    const image = document.createElement('img');
    image.src = item.url;
    image.alt = item.prompt ? `NovelAI 作品：${item.prompt.slice(0, 80)}` : 'NovelAI 生成图片';
    image.loading = fresh ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.draggable = false;

    const viewLabel = document.createElement('span');
    viewLabel.className = 'art-view';
    viewLabel.textContent = '查看大图';

    thumb.append(image, viewLabel);
    thumb.addEventListener('click', () => openLightbox(item));

    const body = document.createElement('div');
    body.className = 'art-body';

    const head = document.createElement('div');
    head.className = 'art-head';

    const date = document.createElement('span');
    date.className = 'art-date';
    date.textContent = formatCardDate(item.createdAt);
    date.title = formatFullDate(item.createdAt);

    const actions = document.createElement('div');
    actions.className = 'art-actions';

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'card-action';
    copyButton.textContent = '复制';
    copyButton.title = '复制最终 Tag';
    copyButton.setAttribute('aria-label', '复制最终 Tag');
    copyButton.addEventListener('click', () => copyText(item.prompt));

    const downloadLink = document.createElement('a');
    downloadLink.className = 'card-action';
    downloadLink.href = item.url;
    downloadLink.download = item.filename || 'novelai.png';
    downloadLink.textContent = '下载';
    downloadLink.title = '下载原图';
    downloadLink.setAttribute('aria-label', '下载原图');

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'card-action card-action--danger';
    deleteButton.textContent = '删除';
    deleteButton.title = '移入回收站（可恢复）';
    deleteButton.setAttribute('aria-label', '删除这张作品');
    deleteButton.addEventListener('click', () => deleteHistoryItem(item));

    actions.append(copyButton, downloadLink, deleteButton);
    head.append(date, actions);

    const prompt = document.createElement('p');
    prompt.className = 'art-prompt';
    prompt.textContent = item.prompt || '（无提示词记录）';
    prompt.title = item.prompt || '';

    const meta = document.createElement('div');
    meta.className = 'art-meta';
    meta.append(
      createMetaChip(modelLabel(item.model), true),
      createMetaChip(`${item.width}×${item.height}`),
      createMetaChip(`${item.steps} steps`),
      createMetaChip(samplerLabel(item.sampler)),
    );

    const albumRow = document.createElement('div');
    albumRow.className = 'art-album';
    const albumLabel = document.createElement('span');
    albumLabel.className = 'art-album-label';
    albumLabel.textContent = '画册';
    const albumSelect = document.createElement('select');
    albumSelect.className = 'art-album-select';
    albumSelect.setAttribute('aria-label', '把这张作品移动到画册');
    albumSelect.append(new Option('未分类', ''));
    for (const album of state.albums) albumSelect.append(new Option(album.name, album.id));
    albumSelect.value = item.albumId || '';
    albumSelect.addEventListener('change', () => {
      moveItemToAlbum(item, albumSelect.value || null);
    });
    albumRow.append(albumLabel, albumSelect);

    card.addEventListener('dragstart', (event) => beginCardDrag(event, item, card));
    card.addEventListener('dragend', () => endCardDrag(card));
    thumb.addEventListener('dragstart', (event) => beginCardDrag(event, item, card));
    thumb.addEventListener('dragend', () => endCardDrag(card));
    card.addEventListener('dragover', (event) => dragOverCard(event, item, card));
    card.addEventListener('dragleave', () => {
      card.classList.remove('drop-before', 'drop-after');
    });
    card.addEventListener('drop', (event) => dropOnCard(event, item, card));

    body.append(head, prompt, meta, albumRow);
    card.append(selectButton, thumb, body);
    return card;
  }

  /* ---------------------------------------------------------------------- */
  /* Selection, drag ordering and batch operations                          */
  /* ---------------------------------------------------------------------- */

  function toggleSelection(id) {
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    refreshSelectionUI();
  }

  function clearSelection() {
    state.selected.clear();
    refreshSelectionUI();
  }

  function refreshSelectionUI() {
    const known = new Set(state.history.map((item) => item.id));
    for (const id of [...state.selected]) {
      if (!known.has(id)) state.selected.delete(id);
    }

    const count = state.selected.size;
    ui.selectionBar.hidden = count === 0;
    ui.selectionCount.textContent = String(count);
    ui.selectionDelete.textContent = count > 0 ? `批量删除 (${count})` : '批量删除';
    ui.selectionMove.disabled = count === 0;

    for (const card of ui.galleryGrid.children) {
      const selected = state.selected.has(card.dataset.id);
      card.classList.toggle('is-selected', selected);
      const button = card.querySelector('.card-select');
      if (button) button.setAttribute('aria-pressed', String(selected));
    }
  }

  function selectAllVisible() {
    for (const item of visibleHistory()) state.selected.add(item.id);
    refreshSelectionUI();
  }

  function dragMoveIds() {
    if (!state.dragItemId) return [];
    if (!state.selected.has(state.dragItemId)) return [state.dragItemId];
    return [...state.selected];
  }

  function beginCardDrag(event, item, card) {
    state.dragItemId = item.id;
    state.dropTarget = null;
    card.classList.add('is-dragging');
    try {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.id);
    } catch {
      /* older browsers */
    }
  }

  function endCardDrag(card) {
    state.dragItemId = '';
    state.dropTarget = null;
    card.classList.remove('is-dragging');
    for (const child of ui.galleryGrid.children) {
      child.classList.remove('drop-before', 'drop-after');
    }
  }

  function dragOverCard(event, item, card) {
    if (!state.dragItemId || state.dragItemId === item.id) return;
    if (!visibleHistory().some((entry) => entry.id === state.dragItemId)) return;
    event.preventDefault();
    try {
      event.dataTransfer.dropEffect = 'move';
    } catch {
      /* ignore */
    }
    const rect = card.getBoundingClientRect();
    const after = event.clientX > rect.left + rect.width / 2;
    for (const child of ui.galleryGrid.children) {
      child.classList.remove('drop-before', 'drop-after');
    }
    card.classList.add(after ? 'drop-after' : 'drop-before');
    state.dropTarget = { id: item.id, after };
  }

  function dropOnCard(event, item, card) {
    event.preventDefault();
    card.classList.remove('drop-before', 'drop-after');
    const dragging = state.dragItemId;
    const target =
      state.dropTarget && state.dropTarget.id === item.id
        ? state.dropTarget
        : { id: item.id, after: true };
    state.dropTarget = null;
    if (!dragging || dragging === item.id) return;

    const visibleIds = visibleHistory().map((entry) => entry.id);
    if (!visibleIds.includes(dragging) || !visibleIds.includes(item.id)) return;

    const ordered = visibleIds.filter((id) => id !== dragging);
    const baseIndex = ordered.indexOf(item.id);
    if (baseIndex < 0) return;
    ordered.splice(baseIndex + (target.after ? 1 : 0), 0, dragging);
    applyGalleryOrder(ordered);
  }

  function applyGalleryOrder(orderedIds) {
    const items = orderedIds
      .map((id) => state.history.find((entry) => entry.id === id))
      .filter(Boolean);
    if (items.length !== orderedIds.length) return;

    const visibleSet = new Set(orderedIds);
    const slots = [];
    state.history.forEach((entry, index) => {
      if (visibleSet.has(entry.id)) slots.push(index);
    });
    slots.forEach((slot, index) => {
      state.history[slot] = items[index];
    });
    renderGallery();

    requestJson('/api/history/order', {
      method: 'POST',
      body: JSON.stringify({ ids: orderedIds }),
    })
      .then(() => showToast('已保存新的作品排序。', 'success', 2200))
      .catch((error) => {
        showToast(error.message || '排序保存失败。', 'error');
        loadHistory().catch(() => {});
      });
  }

  function applyAlbumsFromPayload(payload) {
    if (Array.isArray(payload?.albums)) {
      applyAlbumRows(payload.albums);
    } else {
      renderAlbums();
    }
  }

  async function moveItemsToAlbum(ids, albumId) {
    const list = [...new Set(Array.isArray(ids) ? ids : [])].filter(Boolean);
    if (list.length === 0) return;

    try {
      const payload = await requestJson('/api/history/batch-album', {
        method: 'POST',
        body: JSON.stringify({ ids: list, albumId }),
      });

      for (const raw of payload.items || []) {
        const updated = normalizeHistoryItem(raw);
        if (updated) replaceHistoryItem(updated);
      }
      applyAlbumsFromPayload(payload);
      state.selected.clear();
      renderGallery();
      if (ui.lightbox.open && state.activeItem) {
        refreshLightboxState(state.activeItem, { preserveEdits: true });
      }

      const targetName = albumId ? albumName(albumId) : '未分类';
      const movedCount = Number(payload.moved) || list.length;
      showToast(`已把 ${movedCount} 张作品移动到「${targetName}」。`, 'success', 2800);
      if (Array.isArray(payload.failed) && payload.failed.length > 0) {
        showToast(`${payload.failed.length} 张作品移动失败。`, 'warning', 3600);
      }
    } catch (error) {
      showToast(error.message || '批量移动失败。', 'error');
      loadHistory().catch(() => {});
    }
  }

  function handleSelectionMove() {
    const ids = [...state.selected];
    if (ids.length === 0) return;
    moveItemsToAlbum(ids, ui.selectionAlbum.value || null);
  }

  async function trashHistoryItems(ids, { successMessage = '' } = {}) {
    const list = [...new Set(Array.isArray(ids) ? ids : [])].filter(Boolean);
    if (list.length === 0) return 0;

    try {
      const payload = await requestJson('/api/history/batch-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: list }),
      });
      const removed = new Set(payload.trashed || []);
      state.history = state.history.filter((entry) => !removed.has(entry.id));

      const activeGone = state.activeItem && removed.has(state.activeItem.id);
      if (activeGone) {
        closeLightbox();
        state.activeItem = null;
      }

      for (const id of removed) state.selected.delete(id);
      applyAlbumsFromPayload(payload);
      renderGallery();
      loadTrash().catch(() => {});

      if (successMessage) {
        showToast(successMessage, 'success', 3000);
      } else {
        showToast(`已把 ${removed.size} 张作品移入回收站，可随时恢复。`, 'success', 3000);
      }
      if (Array.isArray(payload.failed) && payload.failed.length > 0) {
        showToast(`${payload.failed.length} 张作品删除失败。`, 'warning', 3600);
      }
      return removed.size;
    } catch (error) {
      showToast(error.message || '批量删除失败。', 'error');
      return 0;
    }
  }

  async function handleSelectionDelete() {
    const ids = [...state.selected];
    if (ids.length === 0) return;
    const confirmed = await askConfirm({
      title: `删除选中的 ${ids.length} 张作品？`,
      message: '图片会移入回收站（outputs/.trash），可以随时恢复；不会真正删除文件。',
      confirmLabel: '移入回收站',
      tone: 'danger',
    });
    if (!confirmed) return;
    await trashHistoryItems(ids);
  }

  async function handleClearGallery() {
    const items = visibleHistory();
    if (items.length === 0) {
      showToast('当前视图没有可清空的作品。', 'warning');
      return;
    }

    const label =
      state.activeAlbumId === 'all'
        ? '全部作品'
        : activeAlbum()
          ? `画册「${activeAlbum().name}」`
          : '「未分类」';
    const confirmed = await askConfirm({
      title: `清空${label}？`,
      message: `当前视图的 ${items.length} 张作品会全部移入回收站，可以随时恢复；图片文件不会真正删除。`,
      confirmLabel: '移入回收站',
      tone: 'danger',
    });
    if (!confirmed) return;
    await trashHistoryItems(
      items.map((item) => item.id),
      { successMessage: `已把 ${items.length} 张作品移入回收站。` },
    );
  }

  async function loadHistory() {
    const payload = await requestJson('/api/history');
    const items = Array.isArray(payload.items) ? payload.items : [];
    state.history = items.map(normalizeHistoryItem).filter(Boolean);
    renderAlbums();
    renderGallery();
    return state.history.length;
  }

  function normalizeAlbumRow(album) {
    if (
      !album ||
      typeof album.id !== 'string' ||
      !album.id ||
      typeof album.name !== 'string' ||
      !album.name.trim()
    ) {
      return null;
    }
    return {
      id: album.id,
      name: album.name.trim(),
      createdAt: asText(album.createdAt),
      count: Number(album.count) || 0,
      coverId: asText(album.coverId),
      coverUrl: asText(album.coverUrl),
      explicitCoverId: asText(album.explicitCoverId),
    };
  }

  function applyAlbumRows(rows) {
    state.albums = (Array.isArray(rows) ? rows : [])
      .map(normalizeAlbumRow)
      .filter(Boolean);
    renderAlbums();
  }

  async function loadAlbums() {
    const payload = await requestJson('/api/albums');
    applyAlbumRows(Array.isArray(payload.albums) ? payload.albums : []);
    // History may have rendered before the album list arrived; rebuild the
    // cards so every album option is present in the per-card selector.
    if (state.history.length > 0) renderGallery();
    if (ui.lightbox.open && state.activeItem) {
      refreshLightboxState(state.activeItem, { preserveEdits: true });
    }
    return state.albums.length;
  }

  async function handleExportMetadata() {
    if (ui.exportMetadata.disabled) return;
    ui.exportMetadata.disabled = true;
    const originalLabel = ui.exportMetadata.textContent;
    ui.exportMetadata.textContent = '导出中…';

    try {
      const payload = await requestJson('/api/metadata/sync', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const anchor = document.createElement('a');
      anchor.href = '/api/metadata/archive';
      anchor.download = 'nai-atelier-metadata.zip';
      anchor.style.display = 'none';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();

      const synced = Number(payload?.synced) || 0;
      const failed = Array.isArray(payload?.failed) ? payload.failed.length : 0;
      showToast(
        failed > 0
          ? `已同步 ${synced} 张作品的元数据（${failed} 张失败），正在下载 JSON 压缩包。`
          : `已把 ${synced} 张作品的参数写入 PNG 与配套 JSON，正在下载压缩包。`,
        failed > 0 ? 'warning' : 'success',
        5400,
      );
    } catch (error) {
      showToast(error.message || '导出元数据失败。', 'error');
    } finally {
      ui.exportMetadata.disabled = false;
      ui.exportMetadata.textContent = originalLabel;
    }
  }

  async function handleRefreshHistory() {
    ui.refreshHistory.disabled = true;
    try {
      const [, count] = await Promise.all([
        loadAlbums(),
        loadHistory(),
        loadTrash(),
        loadPrompts(),
        loadJobs(),
      ]);
      showToast(`画廊已刷新，共 ${count} 张作品。`, 'success', 2600);
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      ui.refreshHistory.disabled = false;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Albums: create / rename / delete / move images                         */
  /* ---------------------------------------------------------------------- */

  function replaceHistoryItem(updated) {
    const index = state.history.findIndex((entry) => entry.id === updated.id);
    if (index >= 0) state.history[index] = updated;
    else state.history.unshift(updated);
  }

  async function moveItemToAlbum(item, albumId) {
    try {
      const payload = await requestJson(
        `/api/history/${encodeURIComponent(item.id)}/album`,
        {
          method: 'POST',
          body: JSON.stringify({ albumId }),
        },
      );
      const updated = normalizeHistoryItem(payload.item);
      if (!updated) throw new Error('服务端返回的作品记录格式无效。');

      replaceHistoryItem(updated);
      if (state.activeItem?.id === updated.id) state.activeItem = updated;

      // Re-read the album list: the server may have cleared a cover that pointed
      // at the moved image, and counts/cover fallbacks must stay accurate.
      await loadAlbums().catch(() => {
        renderAlbums();
      });
      renderGallery();
      if (ui.lightbox.open) refreshLightboxState(updated, { preserveEdits: true });

      showToast(
        updated.albumId
          ? `已移动到画册「${albumName(updated.albumId)}」。`
          : '已移动到「未分类」。',
        'success',
        2600,
      );
    } catch (error) {
      showToast(error.message || '移动作品失败。', 'error');
      renderGallery();
      if (ui.lightbox.open) refreshLightboxState(state.activeItem);
    }
  }

  async function handleCreateAlbum() {
    const name = await askPresetName({
      title: '新建画册',
      help: '画册会在 outputs/albums/ 下建立独立文件夹，图片归档后会真正移动到该文件夹；名称最长 40 字。',
      label: '画册名称',
      placeholder: '例如：风景、角色设计、待选',
      value: '',
      confirmLabel: '新建',
      maxLength: 40,
      validate: (value) =>
        state.albums.some((album) => album.name.toLowerCase() === value.toLowerCase())
          ? '已存在同名画册，请换一个名称。'
          : '',
    });
    if (!name) return;

    try {
      const payload = await requestJson('/api/albums', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      applyAlbumsFromPayload(payload);
      state.activeAlbumId = payload.album?.id || state.activeAlbumId;
      renderGallery();
      showToast(`已新建画册「${name}」。`, 'success', 3000);
    } catch (error) {
      showToast(error.message || '新建画册失败。', 'error');
    }
  }

  async function handleRenameAlbum() {
    const album = activeAlbum();
    if (!album) return;

    const name = await askPresetName({
      title: '重命名画册',
      help: '只修改显示名称，画册文件夹与其中的图片不会移动；名称最长 40 字。',
      label: '画册名称',
      placeholder: '输入新的画册名称',
      value: album.name,
      confirmLabel: '保存',
      maxLength: 40,
      validate: (value) =>
        state.albums.some(
          (entry) => entry.id !== album.id && entry.name.toLowerCase() === value.toLowerCase(),
        )
          ? '已存在同名画册，请换一个名称。'
          : '',
    });
    if (!name || name === album.name) return;

    try {
      const payload = await requestJson(`/api/albums/${encodeURIComponent(album.id)}`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      applyAlbumsFromPayload(payload);
      renderGallery();
      showToast(`画册已重命名为「${name}」。`, 'success', 3000);
    } catch (error) {
      showToast(error.message || '重命名画册失败。', 'error');
    }
  }

  async function handleDeleteAlbum() {
    const album = activeAlbum();
    if (!album) return;

    const count = state.history.filter((item) => item.albumId === album.id).length;
    const confirmed = await askConfirm({
      title: `删除画册「${album.name}」？`,
      message:
        count > 0
          ? `画册中的 ${count} 张作品会移回「未分类」，占用的图片文件不会被删除；画册文件夹会被移除。`
          : '画册是空的，删除后文件夹会被移除。',
      confirmLabel: '删除画册',
      tone: 'danger',
    });
    if (!confirmed) return;

    try {
      await requestJson(`/api/albums/${encodeURIComponent(album.id)}`, {
        method: 'DELETE',
      });
      state.activeAlbumId = 'uncategorized';
      await Promise.all([loadAlbums(), loadHistory()]);
      showToast(`已删除画册「${album.name}」，作品已移回未分类。`, 'success', 3600);
    } catch (error) {
      showToast(error.message || '删除画册失败。', 'error');
    }
  }

  async function deleteHistoryItem(item) {
    const confirmed = await askConfirm({
      title: '删除这张作品？',
      message: `图片会移入回收站${item.albumId ? `（画册「${albumName(item.albumId)}」）` : ''}，可以随时恢复；不会真正删除文件。`,
      confirmLabel: '移入回收站',
      tone: 'danger',
    });
    if (!confirmed) return;

    const oldItems = state.lightboxItems.slice();
    const oldIndex = state.lightboxIndex;
    try {
      await requestJson(`/api/history/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      });
      state.history = state.history.filter((entry) => entry.id !== item.id);
      state.selected.delete(item.id);
      renderAlbums();
      renderGallery();
      loadTrash().catch(() => {});
      loadAlbums().catch(() => {});

      if (state.activeItem?.id === item.id && ui.lightbox.open) {
        const nextItems = oldItems.filter((entry) => entry.id !== item.id);
        state.lightboxItems = nextItems;
        if (nextItems.length > 0) {
          state.lightboxIndex = Math.min(oldIndex, nextItems.length - 1);
          showLightboxItem(nextItems[state.lightboxIndex]);
        } else {
          closeLightbox();
        }
      }

      showToast('已移入回收站，可随时恢复。', 'success', 2800);
    } catch (error) {
      showToast(error.message || '删除作品失败。', 'error');
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Recycle bin                                                            */
  /* ---------------------------------------------------------------------- */

  function normalizeTrashRow(raw) {
    if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
    return {
      id: raw.id,
      filename: asText(raw.filename),
      url: asText(raw.url),
      deletedAt: asText(raw.deletedAt),
      createdAt: asText(raw.createdAt),
      albumId: asText(raw.albumId) || null,
      prompt: asText(raw.prompt),
      width: Number(raw.width) || 0,
      height: Number(raw.height) || 0,
      model: asText(raw.model),
    };
  }

  function updateTrashBadge() {
    ui.trashCount.textContent = String(state.trash.length);
    ui.openTrash.classList.toggle('is-active', state.trash.length > 0);
  }

  async function loadTrash() {
    const payload = await requestJson('/api/trash');
    state.trash = (Array.isArray(payload.items) ? payload.items : [])
      .map(normalizeTrashRow)
      .filter(Boolean);
    updateTrashBadge();
    if (ui.trashDialog.open) renderTrashList();
    return state.trash.length;
  }

  function renderTrashList() {
    const fragment = document.createDocumentFragment();

    for (const item of state.trash) {
      const row = document.createElement('div');
      row.className = 'trash-item';
      row.dataset.id = item.id;

      const thumb = document.createElement('img');
      thumb.className = 'trash-thumb';
      thumb.src = item.url;
      thumb.alt = item.prompt ? `回收站作品：${item.prompt.slice(0, 60)}` : '回收站作品';
      thumb.loading = 'lazy';
      thumb.decoding = 'async';

      const meta = document.createElement('div');
      meta.className = 'trash-meta';

      const date = document.createElement('span');
      date.className = 'trash-date';
      date.textContent = `${formatCardDate(item.deletedAt)} 移除`;
      date.title = formatFullDate(item.deletedAt);

      const prompt = document.createElement('p');
      prompt.className = 'trash-prompt';
      prompt.textContent = item.prompt || '（无提示词记录）';
      prompt.title = item.prompt || '';

      const album = document.createElement('span');
      album.className = 'trash-album';
      album.textContent = item.albumId ? `画册 · ${albumName(item.albumId)}` : '未分类';

      meta.append(date, prompt, album);

      const actions = document.createElement('div');
      actions.className = 'trash-actions';

      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'mini-btn';
      restore.textContent = '恢复';
      restore.title = '恢复到原画册，图片文件会移回 outputs';
      restore.addEventListener('click', () => restoreTrashItem(item));

      const purge = document.createElement('button');
      purge.type = 'button';
      purge.className = 'mini-btn mini-btn--danger';
      purge.textContent = '彻底删除';
      purge.title = '永久删除图片文件，无法恢复';
      purge.addEventListener('click', () => purgeTrashItem(item));

      actions.append(restore, purge);
      row.append(thumb, meta, actions);
      fragment.append(row);
    }

    ui.trashList.replaceChildren(fragment);
    ui.trashEmptyText.hidden = state.trash.length > 0;
    ui.trashEmpty.disabled = state.trash.length === 0;
    ui.trashList.hidden = state.trash.length === 0;
  }

  async function openTrashDialog() {
    try {
      await loadTrash();
    } catch (error) {
      showToast(error.message || '回收站加载失败。', 'error');
      return;
    }
    renderTrashList();
    if (!ui.trashDialog.open) ui.trashDialog.showModal();
  }

  function closeTrashDialog() {
    if (ui.trashDialog.open) ui.trashDialog.close();
  }

  async function restoreTrashItem(item) {
    try {
      const payload = await requestJson(
        `/api/trash/${encodeURIComponent(item.id)}/restore`,
        { method: 'POST' },
      );
      const restored = normalizeHistoryItem(payload.item);
      if (restored) {
        state.history = state.history.filter((entry) => entry.id !== restored.id);
        state.history.unshift(restored);
      }
      state.trash = (Array.isArray(payload.items) ? payload.items : state.trash)
        .map(normalizeTrashRow)
        .filter(Boolean);
      updateTrashBadge();
      renderTrashList();
      renderAlbums();
      renderGallery();
      showToast('已恢复到画廊。', 'success', 2600);
    } catch (error) {
      showToast(error.message || '恢复失败。', 'error');
    }
  }

  async function purgeTrashItem(item) {
    const confirmed = await askConfirm({
      title: '彻底删除这张作品？',
      message: '图片文件会从本机永久删除，无法恢复。',
      confirmLabel: '永久删除',
      tone: 'danger',
    });
    if (!confirmed) return;

    try {
      const payload = await requestJson(`/api/trash/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      });
      state.trash = (Array.isArray(payload.items) ? payload.items : [])
        .map(normalizeTrashRow)
        .filter(Boolean);
      updateTrashBadge();
      renderTrashList();
      showToast('已永久删除。', 'success', 2400);
    } catch (error) {
      showToast(error.message || '彻底删除失败。', 'error');
    }
  }

  async function emptyTrashBin() {
    if (state.trash.length === 0) {
      showToast('回收站已经是空的。', 'info', 2000);
      return;
    }
    const confirmed = await askConfirm({
      title: `清空回收站（${state.trash.length} 张）？`,
      message: '回收站中的图片文件会从本机永久删除，无法恢复。',
      confirmLabel: '永久清空',
      tone: 'danger',
    });
    if (!confirmed) return;

    try {
      await requestJson('/api/trash', { method: 'DELETE' });
      state.trash = [];
      updateTrashBadge();
      renderTrashList();
      showToast('回收站已清空。', 'success', 2600);
    } catch (error) {
      showToast(error.message || '清空回收站失败。', 'error');
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Prompt library (提示词收藏)                                             */
  /* ---------------------------------------------------------------------- */

  function normalizePromptRow(raw) {
    if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
    const name = asText(raw.name).trim();
    if (!name) return null;
    return {
      id: raw.id,
      name,
      positive: asText(raw.positive),
      negative: asText(raw.negative),
      createdAt: asText(raw.createdAt),
    };
  }

  function updatePromptBadge() {
    ui.promptLibraryCount.textContent = String(state.prompts.length);
    ui.openPromptLibrary.classList.toggle('is-active', state.prompts.length > 0);
  }

  async function loadPrompts() {
    const payload = await requestJson('/api/prompts');
    state.prompts = (Array.isArray(payload.prompts) ? payload.prompts : [])
      .map(normalizePromptRow)
      .filter(Boolean);
    updatePromptBadge();
    if (ui.promptDialog.open) renderPromptList();
    return state.prompts.length;
  }

  function promptSummary(prompt) {
    const parts = [];
    if (prompt.positive) parts.push(prompt.positive);
    if (prompt.negative) parts.push(`负面：${prompt.negative}`);
    return parts.join('  ·  ');
  }

  function renderPromptList() {
    const fragment = document.createDocumentFragment();

    for (const prompt of state.prompts) {
      const row = document.createElement('div');
      row.className = 'prompt-item';
      row.dataset.id = prompt.id;

      const head = document.createElement('div');
      head.className = 'prompt-item-head';

      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'prompt-item-name';
      name.textContent = prompt.name;
      name.title = '载入到左侧表单进行编辑';
      name.addEventListener('click', () => editPromptPreset(prompt));

      const date = document.createElement('span');
      date.className = 'prompt-item-date';
      date.textContent = formatCardDate(prompt.createdAt);

      head.append(name, date);

      const text = document.createElement('p');
      text.className = 'prompt-item-text';
      text.textContent = promptSummary(prompt) || '（空）';
      text.title = promptSummary(prompt);

      const actions = document.createElement('div');
      actions.className = 'prompt-item-actions';

      const add = (label, title, onClick, danger = false) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = danger ? 'mini-btn mini-btn--danger' : 'mini-btn';
        button.textContent = label;
        button.title = title;
        button.addEventListener('click', onClick);
        actions.append(button);
        return button;
      };

      if (prompt.positive) {
        add('正向', '追加到侧边栏的基础正向提示词', () =>
          insertPromptIntoTarget(prompt, 'base-positive'),
        );
      }
      if (prompt.negative) {
        add('负面', '追加到侧边栏的负面提示词', () =>
          insertPromptIntoTarget(prompt, 'negative-prompt'),
        );
      }
      add('灯箱', '追加到灯箱当前编辑的最终 Tag（需先打开作品）', () =>
        insertPromptIntoTarget(prompt, 'lightbox'),
      );
      add('复制', '复制正向与负面提示词', () =>
        copyText([prompt.positive, prompt.negative].filter(Boolean).join('\n')),
      );
      add(
        '删除',
        '删除这条提示词收藏',
        () => deletePromptPreset(prompt),
        true,
      );

      row.append(head, text, actions);
      fragment.append(row);
    }

    ui.promptList.replaceChildren(fragment);
    ui.promptListCount.textContent = String(state.prompts.length);
    ui.promptListEmpty.hidden = state.prompts.length > 0;
    ui.promptList.hidden = state.prompts.length === 0;
  }

  function appendPromptText(current, addition) {
    const base = asText(current).trim();
    const extra = asText(addition).trim();
    if (!extra) return base;
    if (!base) return extra;
    const cleaned = base.replace(/[,\s]+$/, '');
    return `${cleaned}, ${extra}`;
  }

  function insertPromptIntoTarget(prompt, target) {
    if (target === 'lightbox') {
      if (!ui.lightbox.open) {
        showToast('请先打开一张作品的大图，再插入灯箱。', 'warning');
        return;
      }
      const text = appendPromptText(ui.lightboxPromptEdit.value, prompt.positive);
      ui.lightboxPromptEdit.value = text;
      if (prompt.negative) {
        ui.lightboxNegativeEdit.value = appendPromptText(
          ui.lightboxNegativeEdit.value,
          prompt.negative,
        );
      }
      ui.tagWeightEditor.open = true;
      renderTagWeights();
      showToast(`已把「${prompt.name}」插入灯箱提示词。`, 'success', 2600);
      return;
    }

    if (target === 'negative-prompt') {
      ui.negativePrompt.value = appendPromptText(ui.negativePrompt.value, prompt.positive);
      if (prompt.negative) {
        ui.negativePrompt.value = appendPromptText(ui.negativePrompt.value, prompt.negative);
      }
      markDirty();
      showToast(`已把「${prompt.name}」追加到负面提示词。`, 'success', 2600);
      return;
    }

    ui.basePositive.value = appendPromptText(ui.basePositive.value, prompt.positive);
    markDirty();
    showToast(`已把「${prompt.name}」追加到基础正向提示词。`, 'success', 2600);
  }

  function resetPromptForm({ silent = false } = {}) {
    state.promptEditingId = '';
    ui.promptId.value = '';
    ui.promptName.value = '';
    ui.promptPositive.value = '';
    ui.promptNegative.value = '';
    ui.promptFormMode.textContent = '新建';
    ui.promptSave.textContent = '保存收藏';
    if (!silent) ui.promptName.focus();
  }

  function editPromptPreset(prompt) {
    state.promptEditingId = prompt.id;
    ui.promptId.value = prompt.id;
    ui.promptName.value = prompt.name;
    ui.promptPositive.value = prompt.positive;
    ui.promptNegative.value = prompt.negative;
    ui.promptFormMode.textContent = '编辑中';
    ui.promptSave.textContent = '更新收藏';
    ui.promptName.focus();
    ui.promptName.select();
  }

  async function handlePromptFormSubmit(event) {
    event.preventDefault();
    const name = ui.promptName.value.trim();
    const positive = ui.promptPositive.value.trim();
    const negative = ui.promptNegative.value.trim();

    if (!name) {
      showToast('请填写提示词名称。', 'warning');
      ui.promptName.focus();
      return;
    }
    if (!positive && !negative) {
      showToast('正向与负面提示词至少要填写一项。', 'warning');
      return;
    }

    ui.promptSave.disabled = true;
    try {
      await requestJson('/api/prompts', {
        method: 'POST',
        body: JSON.stringify({
          id: state.promptEditingId || undefined,
          name,
          positive,
          negative,
        }),
      });
      await loadPrompts();
      resetPromptForm({ silent: true });
      showToast(`已保存提示词收藏「${name}」。`, 'success', 2800);
    } catch (error) {
      showToast(error.message || '保存提示词收藏失败。', 'error');
    } finally {
      ui.promptSave.disabled = false;
    }
  }

  async function deletePromptPreset(prompt) {
    const confirmed = await askConfirm({
      title: `删除提示词收藏「${prompt.name}」？`,
      message: '只会删除这条收藏，不影响已生成的作品。',
      confirmLabel: '删除收藏',
      tone: 'danger',
    });
    if (!confirmed) return;

    try {
      await requestJson(`/api/prompts/${encodeURIComponent(prompt.id)}`, {
        method: 'DELETE',
      });
      await loadPrompts();
      if (state.promptEditingId === prompt.id) resetPromptForm({ silent: true });
      showToast('已删除这条提示词收藏。', 'success', 2400);
    } catch (error) {
      showToast(error.message || '删除提示词收藏失败。', 'error');
    }
  }

  async function openPromptDialog(prefill = null) {
    try {
      await loadPrompts();
    } catch (error) {
      showToast(error.message || '提示词收藏加载失败。', 'error');
      return;
    }
    renderPromptList();

    if (prefill) {
      state.promptEditingId = '';
      ui.promptId.value = '';
      ui.promptName.value = prefill.name || '';
      ui.promptPositive.value = prefill.positive || '';
      ui.promptNegative.value = prefill.negative || '';
      ui.promptFormMode.textContent = '新建';
      ui.promptSave.textContent = '保存收藏';
    }

    if (!ui.promptDialog.open) ui.promptDialog.showModal();
    window.setTimeout(() => {
      if (prefill) ui.promptName.focus();
      ui.promptName.select?.();
    }, 40);
  }

  function closePromptDialog() {
    if (ui.promptDialog.open) ui.promptDialog.close();
  }

  function handleLightboxSavePrompt() {
    const item = state.activeItem;
    if (!item) return;
    const suggestionBase = item.prompt
      ? item.prompt.split(',').slice(0, 3).join(', ').trim()
      : '';
    const name = suggestionBase
      ? suggestionBase.slice(0, 40)
      : `作品 · ${formatCardDate(item.createdAt)}`;
    openPromptDialog({
      name,
      positive: item.prompt || '',
      negative: item.negativePrompt || '',
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Tag weight editor                                                      */
  /* ---------------------------------------------------------------------- */

  function parseTagWeightToken(token) {
    let work = token.trim();
    let weight = 1;
    const weighted = work.match(/^\((.*):\s*([0-9]*\.?[0-9]+)\s*\)$/);
    if (weighted) {
      const value = Number(weighted[2]);
      if (Number.isFinite(value)) weight = value;
      work = weighted[1].trim();
    }
    for (let round = 0; round < 4; round += 1) {
      if (/^\(.*\)$/.test(work) || /^\[.*\]$/.test(work)) {
        work = work.slice(1, -1).trim();
        continue;
      }
      break;
    }
    return { base: work, weight: clampWeight(weight) };
  }

  function clampWeight(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 1;
    return Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, Math.round(number * 100) / 100));
  }

  function parseTagWeightList(value) {
    const tokens = [];
    let depth = 0;
    let current = '';

    for (const character of asText(value)) {
      if (character === '(' || character === '[') depth += 1;
      else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);

      if ((character === ',' || character === '\n') && depth === 0) {
        const trimmed = current.trim();
        if (trimmed) tokens.push(parseTagWeightToken(trimmed));
        current = '';
        continue;
      }
      current += character;
    }
    const trimmed = current.trim();
    if (trimmed) tokens.push(parseTagWeightToken(trimmed));
    return tokens.filter((token) => token.base);
  }

  function formatWeightNumber(weight) {
    return String(Number(clampWeight(weight).toFixed(2)));
  }

  function formatTagWeightToken(token) {
    if (Math.abs(token.weight - 1) < 0.001) return token.base;
    return `(${token.base}:${formatWeightNumber(token.weight)})`;
  }

  function joinTagWeightTokens(tokens) {
    return tokens.map(formatTagWeightToken).join(', ');
  }

  function renderTagWeights() {
    const tokens = parseTagWeightList(ui.lightboxPromptEdit.value);
    state.tagWeightTokens = tokens;
    ui.tagWeightCount.textContent = tokens.length > 0 ? `${tokens.length} 个 Tag` : '暂无 Tag';

    const fragment = document.createDocumentFragment();
    tokens.forEach((token, index) => {
      const chip = document.createElement('span');
      chip.className = 'tag-weight-chip';
      chip.classList.toggle('is-weighted', Math.abs(token.weight - 1) > 0.001);
      chip.dataset.weighted = String(Math.abs(token.weight - 1) > 0.001);

      const name = document.createElement('span');
      name.className = 'tag-weight-name';
      name.textContent = token.base;
      name.title = token.base;

      const minus = document.createElement('button');
      minus.type = 'button';
      minus.className = 'tag-weight-btn';
      minus.textContent = '−';
      minus.title = `降低「${token.base}」的权重`;
      minus.addEventListener('click', () =>
        setTagWeight(index, token.weight - WEIGHT_STEP),
      );

      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'tag-weight-input';
      input.min = String(WEIGHT_MIN);
      input.max = String(WEIGHT_MAX);
      input.step = String(WEIGHT_STEP);
      input.value = formatWeightNumber(token.weight);
      input.setAttribute('aria-label', `「${token.base}」的权重`);
      input.addEventListener('change', () => {
        setTagWeight(index, input.value);
      });

      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'tag-weight-btn';
      plus.textContent = '+';
      plus.title = `提高「${token.base}」的权重`;
      plus.addEventListener('click', () =>
        setTagWeight(index, token.weight + WEIGHT_STEP),
      );

      chip.append(name, minus, input, plus);
      fragment.append(chip);
    });

    ui.tagWeightList.replaceChildren(fragment);
  }

  function setTagWeight(index, nextWeight) {
    const tokens = parseTagWeightList(ui.lightboxPromptEdit.value);
    const token = tokens[index];
    if (!token) return;
    token.weight = clampWeight(nextWeight);
    ui.lightboxPromptEdit.value = joinTagWeightTokens(tokens);
    renderTagWeights();
  }

  function resetTagWeights() {
    const tokens = parseTagWeightList(ui.lightboxPromptEdit.value);
    if (tokens.length === 0) return;
    for (const token of tokens) token.weight = 1;
    ui.lightboxPromptEdit.value = joinTagWeightTokens(tokens);
    renderTagWeights();
    showToast('已把全部 Tag 权重重置为 1.0。', 'info', 2400);
  }

  /* ---------------------------------------------------------------------- */
  /* Lightbox                                                               */
  /* ---------------------------------------------------------------------- */

  function buildLightboxChips(item) {
    const chips = [
      createMetaChip(modelLabel(item.model), true),
      createMetaChip(`${item.width} × ${item.height}`),
      createMetaChip(`${item.steps} steps`),
      createMetaChip(`Guidance ${Number(item.scale).toFixed(1)}`),
      createMetaChip(samplerLabel(item.sampler)),
      createMetaChip(noiseLabel(item.noiseSchedule)),
      createMetaChip(`Seed ${item.seed >= 0 ? item.seed : '随机'}`),
      createMetaChip(`${llmProviderLabel(item.llmProvider)}${item.llmModel ? ` · ${item.llmModel}` : ''}`),
    ];

    if (item.cfgRescale > 0) {
      chips.push(createMetaChip(`CFG Rescale ${Number(item.cfgRescale).toFixed(2)}`));
    }
    if (item.albumId) {
      chips.push(createMetaChip(`画册 · ${albumName(item.albumId)}`));
    }
    if (item.parentId) {
      chips.push(createMetaChip('重画变体'));
    }
    return chips;
  }

  function lightboxListFor(item) {
    const filtered = visibleHistory();
    if (filtered.some((entry) => entry.id === item.id)) return filtered;
    return state.history;
  }

  function renderLightboxModelOptions(item) {
    const models = Object.keys(NAI_MODEL_LABELS);
    if (item.model && !models.includes(item.model)) models.push(item.model);
    ui.lightboxRerenderModel.replaceChildren(
      ...models.map((model) => new Option(modelLabel(model), model)),
    );
    ui.lightboxRerenderModel.value = item.model;
  }

  function renderLightboxAlbumOptions(item) {
    const options = [new Option('未分类', '')];
    for (const album of state.albums) options.push(new Option(album.name, album.id));
    ui.lightboxAlbum.replaceChildren(...options);
    ui.lightboxAlbum.value = item.albumId || '';
  }

  function showLightboxItem(item, { preserveEdits = false } = {}) {
    if (!item) return;
    state.activeItem = item;

    const index = state.lightboxItems.findIndex((entry) => entry.id === item.id);
    if (index >= 0) state.lightboxIndex = index;

    ui.lightboxImage.src = item.url;
    ui.lightboxImage.alt = item.prompt
      ? `NovelAI 作品：${item.prompt.slice(0, 120)}`
      : 'NovelAI 生成图片';
    ui.lightboxDate.textContent = formatFullDate(item.createdAt);
    ui.lightboxChips.replaceChildren(...buildLightboxChips(item));
    if (!preserveEdits) {
      ui.lightboxPromptEdit.value = item.prompt || '';
      ui.lightboxNegativeEdit.value = item.negativePrompt || '';
      ui.lightboxSeedMode.value = 'new';
      renderLightboxModelOptions(item);
    }
    ui.lightboxDownload.href = item.url;
    ui.lightboxDownload.setAttribute('download', item.filename || 'novelai.png');
    ui.lightboxMetadata.href = `/api/history/${encodeURIComponent(item.id)}/metadata?download=1`;
    ui.lightboxMetadata.setAttribute(
      'download',
      (item.filename || 'metadata.png').replace(/\.(png|jpe?g|webp)$/i, '.json'),
    );

    renderLightboxAlbumOptions(item);
    refreshLightboxCoverButton();
    renderTagWeights();

    const total = state.lightboxItems.length;
    ui.lightboxCounter.textContent = `${total > 0 ? state.lightboxIndex + 1 : 0} / ${total}`;
    ui.lightboxPrev.disabled = state.lightboxIndex <= 0;
    ui.lightboxNext.disabled = state.lightboxIndex >= total - 1;
  }

  function refreshLightboxCoverButton() {
    const item = state.activeItem;
    if (!item || !item.albumId) {
      ui.lightboxSetCover.hidden = true;
      ui.lightboxSetCover.disabled = false;
      return;
    }
    const album = state.albums.find((entry) => entry.id === item.albumId);
    // Only an explicitly chosen cover disables the button: the server also
    // returns a newest-image fallback for the chip thumbnail, and the user must
    // still be able to turn that fallback image into the real cover.
    const isCover = Boolean(album && album.explicitCoverId === item.id);
    ui.lightboxSetCover.hidden = false;
    ui.lightboxSetCover.textContent = isCover ? '当前封面' : '设为封面';
    ui.lightboxSetCover.disabled = isCover;
    ui.lightboxSetCover.title = isCover
      ? '这张作品已经是该画册的封面'
      : '把这张作品设为当前画册封面';
  }

  async function handleLightboxSetCover() {
    const item = state.activeItem;
    if (!item || !item.albumId) return;

    try {
      const payload = await requestJson(
        `/api/albums/${encodeURIComponent(item.albumId)}/cover`,
        {
          method: 'POST',
          body: JSON.stringify({ historyId: item.id }),
        },
      );
      applyAlbumsFromPayload(payload);
      refreshLightboxCoverButton();
      showToast(`已把这张作品设为「${albumName(item.albumId)}」的封面。`, 'success', 2600);
    } catch (error) {
      showToast(error.message || '设置画册封面失败。', 'error');
    }
  }

  function openLightbox(item) {
    state.lightboxItems = lightboxListFor(item);
    let index = state.lightboxItems.findIndex((entry) => entry.id === item.id);
    if (index < 0) {
      state.lightboxItems = [item];
      index = 0;
    }
    state.lightboxIndex = index;
    showLightboxItem(state.lightboxItems[index]);

    if (!ui.lightbox.open) {
      try {
        ui.lightbox.showModal();
      } catch {
        showToast('当前浏览器不支持大图预览。', 'error');
      }
    }
  }

  function refreshLightboxState(item, { preserveEdits = false } = {}) {
    if (!item) {
      closeLightbox();
      return;
    }
    state.lightboxItems = lightboxListFor(item);
    if (state.lightboxItems.length === 0) {
      closeLightbox();
      return;
    }
    const index = state.lightboxItems.findIndex((entry) => entry.id === item.id);
    state.lightboxIndex = index >= 0 ? index : 0;
    showLightboxItem(state.lightboxItems[state.lightboxIndex], { preserveEdits });
  }

  function stepLightbox(delta) {
    if (!ui.lightbox.open || state.lightboxItems.length === 0) return;
    const next = Math.min(
      state.lightboxItems.length - 1,
      Math.max(0, state.lightboxIndex + delta),
    );
    if (next === state.lightboxIndex) return;
    state.lightboxIndex = next;
    showLightboxItem(state.lightboxItems[next]);
  }

  function closeLightbox() {
    if (ui.lightbox.open) ui.lightbox.close();
  }

  function handleLightboxCopy() {
    if (state.activeItem) copyText(state.activeItem.prompt);
  }

  function handleLightboxPromptReset() {
    if (!state.activeItem) return;
    ui.lightboxPromptEdit.value = state.activeItem.prompt || '';
    ui.lightboxNegativeEdit.value = state.activeItem.negativePrompt || '';
    ui.lightboxSeedMode.value = 'new';
    ui.lightboxRerenderModel.value = state.activeItem.model;
    renderTagWeights();
    showToast('已恢复这张作品保存的原始 Tag、负面词与模型。', 'info', 2600);
  }

  function handleLightboxAlbumChange() {
    if (!state.activeItem) return;
    moveItemToAlbum(state.activeItem, ui.lightboxAlbum.value || null);
  }

  /* ---------------------------------------------------------------------- */
  /* Sidebar drawer                                                         */
  /* ---------------------------------------------------------------------- */

  function setSidebar(open, { focusClose = true } = {}) {
    ui.sidebar.classList.toggle('is-open', open);
    ui.sidebarBackdrop.classList.toggle('is-visible', open);
    document.body.classList.toggle('sidebar-open', open);
    ui.sidebarToggle.setAttribute('aria-expanded', String(open));

    if (open && focusClose) {
      window.setTimeout(() => ui.sidebarClose.focus(), 80);
    } else if (!open && ui.sidebar.contains(document.activeElement)) {
      ui.sidebarToggle.focus();
    }
  }

  function focusField(field) {
    if (window.innerWidth <= 900) setSidebar(true, { focusClose: false });
    window.requestAnimationFrame(() => {
      field.scrollIntoView({ behavior: 'smooth', block: 'center' });
      field.focus();
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Generation                                                             */
  /* ---------------------------------------------------------------------- */

  function validateForGeneration(config) {
    if (!config.llm.apiKey) {
      showToast('请先填写 LLM API Key。', 'warning');
      focusField(ui.llmApiKey);
      return false;
    }
    if (!config.llm.baseUrl) {
      showToast('请先填写 LLM Base URL。', 'warning');
      focusField(ui.llmBaseUrl);
      return false;
    }
    try {
      const parsed = new URL(config.llm.baseUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
    } catch {
      showToast('LLM Base URL 需要是有效的 http(s) 地址。', 'warning');
      focusField(ui.llmBaseUrl);
      return false;
    }
    if (!config.llm.model) {
      showToast('请先填写 LLM 模型名称。', 'warning');
      focusField(ui.llmModel);
      return false;
    }
    if (!config.novelai.apiKey) {
      showToast('请先填写 NovelAI API Key。', 'warning');
      focusField(ui.naiApiKey);
      return false;
    }
    return true;
  }

  function setStage(tone, message, detail = '') {
    ui.stageRow.dataset.tone = tone;
    ui.stageText.textContent = asText(message, '');
    ui.stageText.title = asText(message, '');
    ui.stageDetail.textContent = detail;
  }

  function setProgress(percent, visible) {
    if (visible) {
      window.clearTimeout(state.progressHideTimer);
      ui.progressTrack.hidden = false;
    }
    if (Number.isFinite(percent)) {
      ui.progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }
    if (!visible) ui.progressTrack.hidden = true;
  }

  function scheduleProgressHide() {
    window.clearTimeout(state.progressHideTimer);
    state.progressHideTimer = window.setTimeout(() => {
      if (!state.generating) ui.progressTrack.hidden = true;
    }, 900);
  }

  /* Jobs ------------------------------------------------------------------ */

  function normalizeJob(raw) {
    if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
    const status = ['queued', 'running', 'done', 'error', 'canceled'].includes(raw.status)
      ? raw.status
      : 'queued';
    return {
      id: raw.id,
      kind: raw.kind === 'rerender' ? 'rerender' : 'generate',
      label: asText(raw.label, '任务'),
      status,
      stage: asText(raw.stage),
      message: asText(raw.message),
      progress: Number.isFinite(Number(raw.progress)) ? Number(raw.progress) : 0,
      albumId: asText(raw.albumId) || null,
      text: asText(raw.text),
      historyId: asText(raw.historyId),
      createdAt: Number(raw.createdAt) || Date.now(),
      startedAt: Number(raw.startedAt) || 0,
      finishedAt: Number(raw.finishedAt) || 0,
      elapsedMs: Number(raw.elapsedMs) || 0,
      position: Number(raw.position) || 0,
      queueLength: Number(raw.queueLength) || 0,
      result: raw.result || null,
      error:
        raw.error && typeof raw.error === 'object'
          ? { message: asText(raw.error.message), code: asText(raw.error.code) }
          : null,
    };
  }

  function isActiveJob(job) {
    return job.status === 'queued' || job.status === 'running';
  }

  function ensureJobPolling() {
    if (state.jobPollTimer) return;
    state.jobPollTimer = window.setInterval(() => {
      pollJobs();
    }, JOB_POLL_MS);
    pollJobs();
  }

  function maybeStopJobPolling() {
    if (state.jobs.some(isActiveJob)) return;
    if (state.jobPollTimer) {
      window.clearInterval(state.jobPollTimer);
      state.jobPollTimer = null;
    }
  }

  async function pollJobs() {
    if (state.jobPollBusy) return;
    state.jobPollBusy = true;
    try {
      const payload = await requestJson('/api/jobs');
      applyJobsPayload(payload);
    } catch {
      // Polling is best-effort: the next tick retries without spamming the UI.
    } finally {
      state.jobPollBusy = false;
    }
  }

  function applyJobsPayload(payload) {
    const rows = Array.isArray(payload?.jobs) ? payload.jobs : [];
    state.jobs = rows.map(normalizeJob).filter(Boolean);

    if (payload?.limits && typeof payload.limits === 'object') {
      state.limits = {
        llmTimeoutSeconds:
          Number(payload.limits.llmTimeoutSeconds) || state.limits.llmTimeoutSeconds,
        naiTimeoutSeconds:
          Number(payload.limits.naiTimeoutSeconds) || state.limits.naiTimeoutSeconds,
      };
    }

    if (!state.jobsInitialized) {
      // Jobs that already finished while the page was closed are reflected in
      // the history list; only live jobs should trigger completion handling.
      for (const job of state.jobs) {
        if (isActiveJob(job)) {
          state.sessionJobIds.add(job.id);
        } else {
          state.handledJobIds.add(job.id);
        }
      }
      state.jobsInitialized = true;
    } else {
      // Oldest first so that, when several jobs finished during one poll, the
      // newest result ends up on top of the gallery.
      const finished = state.jobs
        .filter((job) => !isActiveJob(job) && !state.handledJobIds.has(job.id))
        .reverse();
      for (const job of finished) {
        state.handledJobIds.add(job.id);
        state.sessionJobIds.add(job.id);
        handleFinishedJob(job);
      }
    }

    state.generating = state.jobs.some((job) => job.status === 'running');
    updateGenerateButton();
    renderQueue();
    updateStageFromJobs();
    maybeStopJobPolling();
  }

  function handleFinishedJob(job) {
    if (job.status === 'done' && job.result) {
      try {
        appendGeneratedCard(job.result);
      } catch (error) {
        showToast(error.message || '生成完成，但图片记录无法显示。', 'error');
      }

      const albumId = job.result.albumId;
      const targetName = albumId ? albumName(albumId) : '未分类';
      state.lastFinishedJobId = job.id;

      if (job.kind === 'rerender') {
        showToast(
          `重画完成 · ${modelLabel(job.result.model)}${albumId ? ` · 画册「${targetName}」` : ''}`,
          'success',
          4200,
        );
        const created = state.history.find((entry) => entry.id === state.lastCreatedId);
        if (created) window.setTimeout(() => openLightbox(created), 240);
      } else {
        showToast(
          albumId
            ? `新作品已保存到画册「${targetName}」。`
            : '新作品已生成，并追加到画廊顶部。',
          'success',
          3200,
        );
      }

      setStage(
        'success',
        job.kind === 'rerender' ? '重画完成 · 新图已自动打开' : '生成完成 · 图片已保存',
        formatDuration(job.elapsedMs),
      );
      setProgress(100, true);
      scheduleProgressHide();
      return;
    }

    if (job.status === 'canceled') {
      showToast('已取消生成。', 'info', 2400);
      setStage('idle', '已取消生成 · 可以继续排队或调整提示词', 'CANCELED');
      setProgress(0, false);
      stopElapsedTimer();
      return;
    }

    if (job.status === 'error') {
      const message = job.error?.message || '生成失败，请稍后重试。';
      showToast(message, 'error', 6500);
      setStage('error', message, 'FAILED');
      setProgress(0, false);
      stopElapsedTimer();
    }
  }

  function updateGenerateButton() {
    const running = state.jobs.find((job) => job.status === 'running');
    ui.generateBtn.classList.toggle('is-loading', Boolean(running));
    ui.generateBtn.setAttribute('aria-busy', String(Boolean(running)));
    ui.generateLabel.textContent = running ? '加入队列' : '生成';
    ui.generateSub.textContent = running ? 'ADD TO QUEUE' : 'GENERATE';
    ui.cancelJob.hidden = !running;
  }

  function updateStageFromJobs() {
    const running = state.jobs.find((job) => job.status === 'running');
    const queued = state.jobs.filter((job) => job.status === 'queued');

    if (running) {
      const suffix = queued.length > 0 ? ` · 队列还有 ${queued.length} 个` : '';
      setStage('running', `${running.message || '正在生成…'}${suffix}`, '');
      if (Number.isFinite(running.progress)) setProgress(running.progress, true);
      startElapsedTimer(running);
      return;
    }

    if (queued.length > 0) {
      setStage('queued', `队列中有 ${queued.length} 个任务等待开始…`, 'QUEUED');
      setProgress(4, true);
      stopElapsedTimer();
    }
  }

  /* Elapsed time + timeout heads-up ---------------------------------------- */

  function timeoutCapForJob(job) {
    if (!job) return 0;
    if (job.stage === 'llm') return Number(state.limits.llmTimeoutSeconds) || 0;
    if (job.stage === 'nai' || job.stage === 'unzip' || job.stage === 'save') {
      return Number(state.limits.naiTimeoutSeconds) || 0;
    }
    return 0;
  }

  function startElapsedTimer(job) {
    if (state.elapsedJobId !== job.id) {
      state.elapsedJobId = job.id;
      state.elapsedStart = job.startedAt || Date.now();
    }
    if (state.elapsedTimer) return;

    const tick = () => {
      const running = state.jobs.find((entry) => entry.status === 'running');
      if (!running) {
        stopElapsedTimer();
        return;
      }
      const start = running.startedAt || state.elapsedStart || Date.now();
      const elapsed = Math.max(0, Date.now() - start) / 1000;
      const cap = timeoutCapForJob(running);
      ui.stageDetail.textContent =
        cap > 0 ? `已用 ${elapsed.toFixed(1)}s / 上限 ${cap}s` : `已用 ${elapsed.toFixed(1)}s`;
      ui.stageDetail.classList.toggle('is-warning', cap > 0 && elapsed >= cap * 0.8);
    };

    tick();
    state.elapsedTimer = window.setInterval(tick, 250);
  }

  function stopElapsedTimer() {
    if (state.elapsedTimer) {
      window.clearInterval(state.elapsedTimer);
      state.elapsedTimer = null;
    }
    ui.stageDetail.classList.remove('is-warning');
  }

  /* Queue UI --------------------------------------------------------------- */

  function queueStatusText(job) {
    if (job.status === 'queued') return job.message || `排队中 · 第 ${job.position} 位`;
    if (job.status === 'running') return job.message || '正在生成…';
    if (job.status === 'done') return `已完成 · ${formatDuration(job.elapsedMs)}`;
    if (job.status === 'canceled') return '已取消';
    return job.error?.message || '失败';
  }

  function renderQueue() {
    const active = state.jobs.filter(isActiveJob);
    // Only list finished jobs that belong to this page session: older queue
    // history would otherwise push the gallery out of view on every reload.
    const finished = state.jobs.filter(
      (job) => !isActiveJob(job) && state.sessionJobIds.has(job.id),
    );
    const rows = [
      ...active,
      ...finished.slice(0, Math.max(0, MAX_QUEUE_ROWS - active.length)),
    ];

    ui.queuePanel.hidden = rows.length === 0;
    ui.queueCount.textContent = String(active.length);
    const queuedCount = state.jobs.filter((job) => job.status === 'queued').length;
    ui.queueCancelAll.hidden = queuedCount === 0;
    ui.queueCancelAll.disabled = queuedCount === 0;

    const fragment = document.createDocumentFragment();
    for (const job of rows) {
      const row = document.createElement('div');
      row.className = 'queue-item';
      row.dataset.status = job.status;
      row.dataset.id = job.id;

      const dot = document.createElement('span');
      dot.className = 'queue-item-dot';
      dot.setAttribute('aria-hidden', 'true');

      const main = document.createElement('div');
      main.className = 'queue-item-main';

      const top = document.createElement('div');
      top.className = 'queue-item-row';

      const label = document.createElement('span');
      label.className = 'queue-item-label';
      label.textContent = job.kind === 'rerender' ? '重画' : '文生图';

      const text = document.createElement('span');
      text.className = 'queue-item-text';
      text.textContent =
        job.kind === 'rerender'
          ? '历史作品重画'
          : job.text || '（无描述）';
      text.title = job.text || text.textContent;
      top.append(label, text);

      const bar = document.createElement('div');
      bar.className = 'queue-item-bar';
      const fill = document.createElement('span');
      fill.className = 'queue-item-fill';
      const progressValue =
        job.status === 'done' ? 100 : Math.min(100, Math.max(0, job.progress || 0));
      fill.style.width = `${progressValue}%`;
      bar.append(fill);

      const metaRow = document.createElement('div');
      metaRow.className = 'queue-item-meta';

      const statusText = document.createElement('span');
      statusText.className = 'queue-item-status';
      statusText.textContent = queueStatusText(job);
      statusText.title = statusText.textContent;

      const time = document.createElement('span');
      time.className = 'queue-item-time';
      time.textContent =
        job.status === 'queued'
          ? `第 ${job.position || 1} 位`
          : formatDuration(job.elapsedMs);
      metaRow.append(statusText, time);

      main.append(top, bar, metaRow);

      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'mini-btn queue-item-cancel';
      if (isActiveJob(job)) {
        action.textContent = job.status === 'running' ? '取消' : '移除';
        action.title =
          job.status === 'running'
            ? '中止当前生成请求'
            : '从排队中移除这个任务';
        action.addEventListener('click', () => cancelJob(job.id));
      } else {
        action.textContent = '关闭';
        action.title = '从任务列表移除这条已结束的记录';
        action.addEventListener('click', () => dismissJob(job.id));
      }

      row.append(dot, main, action);
      fragment.append(row);
    }

    ui.queueList.replaceChildren(fragment);
  }

  async function enqueueGenerationJob(spec) {
    const payload = await requestJson('/api/jobs', {
      method: 'POST',
      body: JSON.stringify(spec),
    });
    const job = normalizeJob(payload.job);
    if (job) {
      state.jobs = [job, ...state.jobs.filter((entry) => entry.id !== job.id)];
      state.sessionJobIds.add(job.id);
    }
    ensureJobPolling();
    renderQueue();
    updateGenerateButton();
    updateStageFromJobs();
    return job;
  }

  async function cancelJob(jobId) {
    try {
      await requestJson(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
      });
      showToast('已发送取消请求。', 'info', 2200);
      await pollJobs();
    } catch (error) {
      showToast(error.message || '取消生成失败。', 'error');
    }
  }

  function cancelRunningJob() {
    const running = state.jobs.find((job) => job.status === 'running');
    if (running) cancelJob(running.id);
  }

  async function cancelAllQueuedJobs() {
    try {
      await requestJson('/api/jobs/cancel-all', { method: 'POST' });
      showToast('已取消排队中的任务。', 'info', 2400);
      await pollJobs();
    } catch (error) {
      showToast(error.message || '取消排队任务失败。', 'error');
    }
  }

  async function dismissJob(jobId) {
    try {
      await requestJson(`/api/jobs/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
      });
      state.jobs = state.jobs.filter((job) => job.id !== jobId);
      renderQueue();
      maybeStopJobPolling();
    } catch (error) {
      showToast(error.message || '移除任务记录失败。', 'error');
    }
  }

  async function loadJobs() {
    const payload = await requestJson('/api/jobs');
    applyJobsPayload(payload);
    return state.jobs.length;
  }

  /* Composer --------------------------------------------------------------- */

  function updateComposerMetrics() {
    ui.charCount.textContent = `${ui.promptInput.value.length} / ${MAX_CHARS}`;
    ui.promptInput.style.height = 'auto';
    ui.promptInput.style.height = `${Math.min(ui.promptInput.scrollHeight, 156)}px`;
  }

  async function handleGenerate() {
    if (state.enqueuing) return;

    const text = ui.promptInput.value.trim();
    if (!text) {
      showToast('请先输入一段画面描述。', 'warning');
      ui.promptInput.focus();
      return;
    }

    const config = collectConfig();
    if (!validateForGeneration(config)) return;

    const albumId =
      state.activeAlbumId !== 'all' && state.activeAlbumId !== 'uncategorized'
        ? state.activeAlbumId
        : null;

    state.enqueuing = true;
    try {
      await persistConfig({ silent: true });
      const job = await enqueueGenerationJob({ kind: 'generate', text, albumId });
      ui.promptInput.value = '';
      updateComposerMetrics();
      setStage(
        'queued',
        job
          ? `已加入生成队列 · 共 ${state.jobs.filter(isActiveJob).length} 个任务`
          : '已加入生成队列',
        'QUEUED',
      );
      showToast('已加入生成队列，可在下方查看进度并取消。', 'info', 2600);
    } catch (error) {
      showToast(error.message || '加入生成队列失败。', 'error');
    } finally {
      state.enqueuing = false;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* History actions: re-render + reuse params                              */
  /* ---------------------------------------------------------------------- */

  async function handleRerender() {
    const item = state.activeItem;
    if (!item) return;
    if (state.enqueuing) return;

    const prompt = ui.lightboxPromptEdit.value.trim();
    if (!prompt) {
      showToast('重画提示词不能为空。', 'warning');
      ui.lightboxPromptEdit.focus();
      return;
    }

    const promptEdited = prompt !== (item.prompt || '').trim();
    const model = ui.lightboxRerenderModel.value || item.model;
    const seedMode = ui.lightboxSeedMode.value === 'same' ? 'same' : 'new';
    const targetAlbumId = ui.lightboxAlbum.value || null;

    state.enqueuing = true;
    try {
      await enqueueGenerationJob({
        kind: 'rerender',
        historyId: item.id,
        seedMode,
        prompt,
        negativePrompt: ui.lightboxNegativeEdit.value,
        model,
        albumId: targetAlbumId,
      });
      closeLightbox();
      setStage(
        'queued',
        `重画已加入队列${promptEdited ? ' · 使用编辑后的提示词' : ''}`,
        'QUEUED',
      );
      showToast(
        `重画任务已加入队列（${modelLabel(model)}${promptEdited ? ' · 编辑后的提示词' : ''}），完成后会自动打开新图。`,
        'info',
        3800,
      );
    } catch (error) {
      showToast(error.message || '重画加入队列失败。', 'error');
    } finally {
      state.enqueuing = false;
    }
  }

  function handleReuseParams() {
    const item = state.activeItem;
    if (!item) return;

    const hasOption = (select, value) =>
      Array.from(select.options).some((option) => option.value === value);

    // The history record can reference a model that the current <select> does
    // not list (for example one saved by hand in config.json).
    if (!hasOption(ui.naiModel, item.model)) {
      const option = document.createElement('option');
      option.value = item.model;
      option.textContent = modelLabel(item.model);
      ui.naiModel.append(option);
    }
    ui.naiModel.value = item.model;

    if (hasOption(ui.naiSampler, item.sampler)) ui.naiSampler.value = item.sampler;
    if (hasOption(ui.noiseSchedule, item.noiseSchedule)) {
      ui.noiseSchedule.value = item.noiseSchedule;
    }

    ui.steps.value = String(item.steps);
    ui.scale.value = String(item.scale);
    ui.cfgRescale.value = String(item.cfgRescale);
    ui.width.value = String(item.width);
    ui.height.value = String(item.height);
    ui.seed.value = item.seed >= 0 ? String(item.seed) : '-1';
    ui.qualityToggle.checked = item.qualityToggle;
    if (item.negativePrompt) ui.negativePrompt.value = item.negativePrompt;

    syncRangeDisplays();
    updateResolutionPreset();
    markDirty();
    closeLightbox();
    if (window.innerWidth <= 900) setSidebar(true, { focusClose: false });

    showToast('已把该作品的模型、采样、尺寸、Seed 与负面词填回左侧配置。', 'success', 4600);
  }

  /* ---------------------------------------------------------------------- */
  /* Event wiring                                                           */
  /* ---------------------------------------------------------------------- */

  function bindEvents() {
    // Secrets reveal.
    document.querySelectorAll('.secret-toggle').forEach((button) => {
      button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.secretTarget);
        if (!input) return;
        const revealing = input.type === 'password';
        input.type = revealing ? 'text' : 'password';
        button.textContent = revealing ? '隐藏' : '显示';
        button.setAttribute('aria-label', `${revealing ? '隐藏' : '显示'} API Key`);
      });
    });

    // LLM model list + presets + prompt structure.
    ui.llmModelFetch.addEventListener('click', handleFetchModels);
    ui.llmModel.addEventListener('input', syncModelPickerSelection);
    ui.llmBaseUrl.addEventListener('input', renderModelPicker);
    ui.llmPreset.addEventListener('change', handlePresetChange);
    ui.llmPresetSave.addEventListener('click', handlePresetSave);
    ui.llmPresetDelete.addEventListener('click', handlePresetDelete);
    ui.promptBlockAdd.addEventListener('click', addPromptBlock);

    // NovelAI presets.
    ui.naiPreset.addEventListener('change', handleNaiPresetChange);
    ui.naiPresetSave.addEventListener('click', handleNaiPresetSave);
    ui.naiPresetDelete.addEventListener('click', handleNaiPresetDelete);

    // Preset naming dialog.
    ui.presetDialogForm.addEventListener('submit', handlePresetDialogSubmit);
    ui.presetDialogCancel.addEventListener('click', () => closePresetDialog(null));
    ui.presetDialog.addEventListener('click', (event) => {
      if (event.target === ui.presetDialog) closePresetDialog(null);
    });
    ui.presetDialog.addEventListener('close', () => {
      const resolve = presetDialogResolve;
      presetDialogResolve = null;
      presetDialogValidate = null;
      if (resolve) resolve(null);
    });

    // Ranges and their live outputs.
    ui.steps.addEventListener('input', () => {
      ui.stepsValue.textContent = ui.steps.value;
      updateRangeFill(ui.steps);
    });
    ui.scale.addEventListener('input', () => {
      ui.scaleValue.textContent = Number(ui.scale.value).toFixed(1);
      updateRangeFill(ui.scale);
    });
    ui.cfgRescale.addEventListener('input', () => {
      ui.cfgRescaleValue.textContent = Number(ui.cfgRescale.value).toFixed(2);
      updateRangeFill(ui.cfgRescale);
    });
    ui.width.addEventListener('input', onDimensionInput);
    ui.height.addEventListener('input', onDimensionInput);
    ui.resolutionPreset.addEventListener('change', onResolutionPresetChange);

    // Seed helper.
    ui.seedRandom.addEventListener('click', () => {
      ui.seed.value = '-1';
      markDirty();
    });

    // Any form edit marks the config as dirty.
    const configControls = [
      ui.llmModel,
      ui.llmApiKey,
      ui.llmBaseUrl,
      ui.llmTemperature,
      ui.llmTopP,
      ui.llmMaxTokens,
      ui.llmTimeout,
      ui.llmReasoning,
      ui.naiApiKey,
      ui.naiModel,
      ui.naiSampler,
      ui.noiseSchedule,
      ui.qualityToggle,
      ui.naiTimeout,
      ui.steps,
      ui.scale,
      ui.cfgRescale,
      ui.width,
      ui.height,
      ui.seed,
      ui.basePositive,
      ui.artistPrompt,
      ui.negativePrompt,
    ];
    for (const control of configControls) {
      const eventName =
        control instanceof HTMLSelectElement || control.type === 'checkbox' ? 'change' : 'input';
      control.addEventListener(eventName, markDirty);
    }

    // Save.
    ui.saveConfig.addEventListener('click', handleSave);

    // Prompt composer.
    ui.promptInput.addEventListener('input', updateComposerMetrics);
    ui.promptInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        handleGenerate();
      }
    });
    updateComposerMetrics();

    ui.generateBtn.addEventListener('click', handleGenerate);
    ui.cancelJob.addEventListener('click', cancelRunningJob);
    ui.queueCancelAll.addEventListener('click', cancelAllQueuedJobs);

    // Gallery actions.
    ui.refreshHistory.addEventListener('click', handleRefreshHistory);
    ui.albumNew.addEventListener('click', handleCreateAlbum);
    ui.albumRename.addEventListener('click', handleRenameAlbum);
    ui.albumDelete.addEventListener('click', handleDeleteAlbum);
    ui.galleryClear.addEventListener('click', handleClearGallery);
    ui.exportMetadata.addEventListener('click', handleExportMetadata);

    // Batch selection.
    ui.selectionAll.addEventListener('click', selectAllVisible);
    ui.selectionClear.addEventListener('click', clearSelection);
    ui.selectionMove.addEventListener('click', handleSelectionMove);
    ui.selectionDelete.addEventListener('click', handleSelectionDelete);

    // Recycle bin.
    ui.openTrash.addEventListener('click', openTrashDialog);
    ui.trashClose.addEventListener('click', closeTrashDialog);
    ui.trashEmpty.addEventListener('click', emptyTrashBin);
    ui.trashDialog.addEventListener('click', (event) => {
      if (event.target === ui.trashDialog) closeTrashDialog();
    });

    // Prompt library.
    ui.openPromptLibrary.addEventListener('click', () => openPromptDialog());
    ui.promptDialogClose.addEventListener('click', closePromptDialog);
    ui.promptDialog.addEventListener('click', (event) => {
      if (event.target === ui.promptDialog) closePromptDialog();
    });
    ui.promptForm.addEventListener('submit', handlePromptFormSubmit);
    ui.promptFormReset.addEventListener('click', () => resetPromptForm());

    // Confirmation dialog (delete image / album).
    ui.confirmDialogForm.addEventListener('submit', (event) => {
      event.preventDefault();
      closeConfirmDialog(true);
    });
    ui.confirmDialogCancel.addEventListener('click', () => closeConfirmDialog(false));
    ui.confirmDialog.addEventListener('click', (event) => {
      if (event.target === ui.confirmDialog) closeConfirmDialog(false);
    });
    ui.confirmDialog.addEventListener('close', () => {
      const resolve = confirmDialogResolve;
      confirmDialogResolve = null;
      if (resolve) resolve(false);
    });

    // Lightbox.
    ui.lightboxClose.addEventListener('click', closeLightbox);
    ui.lightboxCopy.addEventListener('click', handleLightboxCopy);
    ui.lightboxRerender.addEventListener('click', handleRerender);
    ui.lightboxReuse.addEventListener('click', handleReuseParams);
    ui.lightboxDelete.addEventListener('click', () => {
      if (state.activeItem) deleteHistoryItem(state.activeItem);
    });
    ui.lightboxPromptReset.addEventListener('click', handleLightboxPromptReset);
    ui.lightboxPromptEdit.addEventListener('input', renderTagWeights);
    ui.lightboxAlbum.addEventListener('change', handleLightboxAlbumChange);
    ui.lightboxSetCover.addEventListener('click', handleLightboxSetCover);
    ui.lightboxSavePrompt.addEventListener('click', handleLightboxSavePrompt);
    ui.tagWeightReset.addEventListener('click', resetTagWeights);
    ui.lightboxPrev.addEventListener('click', () => stepLightbox(-1));
    ui.lightboxNext.addEventListener('click', () => stepLightbox(1));
    ui.lightbox.addEventListener('click', (event) => {
      if (event.target === ui.lightbox) closeLightbox();
    });
    ui.lightbox.addEventListener('close', () => {
      state.activeItem = null;
    });

    // Drawer (small screens).
    ui.sidebarToggle.addEventListener('click', () => setSidebar(true));
    ui.sidebarClose.addEventListener('click', () => setSidebar(false));
    ui.sidebarBackdrop.addEventListener('click', () => setSidebar(false));
    ui.sidebarToggle.setAttribute('aria-expanded', 'false');

    window.addEventListener('resize', () => {
      if (window.innerWidth > 900 && ui.sidebar.classList.contains('is-open')) {
        setSidebar(false);
      }
    });

    // Shortcuts.
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSave();
        return;
      }
      if (
        ui.lightbox.open &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      ) {
        const tag = document.activeElement?.tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
        event.preventDefault();
        stepLightbox(event.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (
        event.key === 'Escape' &&
        !ui.lightbox.open &&
        ui.sidebar.classList.contains('is-open')
      ) {
        setSidebar(false);
      }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Boot                                                                   */
  /* ---------------------------------------------------------------------- */

  async function init() {
    cacheElements();
    setModelSuggestions(MODEL_SUGGESTIONS);
    renderPromptBlocks();
    renderPresetSelect();
    renderNaiPresetSelect();
    bindEvents();
    syncRangeDisplays();
    updateResolutionPreset();

    const [configResult, historyResult, albumsResult, trashResult, promptsResult, jobsResult] =
      await Promise.allSettled([
        loadConfig(),
        loadHistory(),
        loadAlbums(),
        loadTrash(),
        loadPrompts(),
        loadJobs(),
      ]);

    state.loaded = true;

    if (configResult.status === 'fulfilled') {
      state.dirty = false;
      setSaveState('saved', '配置已加载');
    } else {
      setSaveState('error', '配置加载失败');
      showToast(
        configResult.reason?.message || '配置加载失败，请确认后端服务是否正常。',
        'error',
        6500,
      );
    }

    if (historyResult.status === 'rejected') {
      showToast(
        historyResult.reason?.message || '历史画廊加载失败，但生成功能仍可使用。',
        'warning',
        5500,
      );
    }

    if (albumsResult.status === 'rejected') {
      showToast(
        albumsResult.reason?.message || '画册列表加载失败，画廊仍可按全部作品查看。',
        'warning',
        5500,
      );
    }

    if (trashResult.status === 'rejected') {
      updateTrashBadge();
    }
    if (promptsResult.status === 'rejected') {
      updatePromptBadge();
    }
    if (jobsResult.status === 'rejected') {
      showToast(
        jobsResult.reason?.message || '生成队列加载失败，仍可新建生成任务。',
        'warning',
        5000,
      );
    }

    // Resume live polling when a generation was already running before reload.
    if (state.jobs.some(isActiveJob)) ensureJobPolling();
  }

  init();
})();
