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
  const MAX_NAI_PRESETS = 30;
  const GALLERY_DENSITY_KEY = 'nai-atelier.gallery-density';
  const GALLERY_VIEW_KEY = 'nai-atelier.gallery-view';
  const SIDEBAR_COLLAPSED_KEY = 'nai-atelier.sidebar-collapsed';
  const MOBILE_TAB_KEY = 'nai-atelier.mobile-tab';
  const MOBILE_TABS = ['gallery', 'generate', 'queue', 'settings'];

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
    galleryDensity: 'detailed',
    galleryDensityManual: false,
    viewMode: 'records',
    records: [],
    activeRecordId: '',
    textEditorSave: null,
    sidebarCollapsed: false,
    focusMode: false,
    composerExpanded: false,
    queueCollapsed: false,
    mobileTab: 'gallery',
  };

  const ui = {};

  function readPreference(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writePreference(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Preferences are best-effort; the UI still works without storage.
    }
  }

  function cacheElements() {
    const ids = [
      'app-shell',
      'sidebar',
      'sidebar-close',
      'sidebar-toggle',
      'focus-toggle',
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
      'nai-preset-export',
      'nai-preset-import',
      'nai-preset-file',
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
      'gallery-title',
      'gallery-grid',
      'gallery-empty',
      'gallery-scroll',
      'gallery-density',
      'gallery-view',
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
      'composer',
      'composer-expand',
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
      'queue-toggle',
      'queue-cancel-all',
      'progress-track',
      'progress-fill',
      'lightbox',
      'lightbox-image',
      'lightbox-visual',
      'lightbox-close',
      'lightbox-date',
      'lightbox-chips',
      'lightbox-original',
      'lightbox-original-text',
      'lightbox-reuse-text',
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
      'record-dialog',
      'record-dialog-title',
      'record-original-text',
      'record-reuse-text',
      'record-reroll',
      'record-close',
      'record-variants',
      'text-editor-dialog',
      'text-editor-form',
      'text-editor-title',
      'text-editor-help',
      'text-editor-input',
      'text-editor-close',
      'text-editor-cancel',
      'text-editor-save',
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
      'open-sync',
      'sync-dialog',
      'sync-close',
      'sync-device-name',
      'sync-port',
      'sync-token',
      'sync-token-copy',
      'sync-token-regenerate',
      'sync-enabled',
      'sync-address-hint',
      'sync-save',
      'sync-peer-url',
      'sync-peer-check',
      'sync-peer-hint',
      'sync-run',
      'sync-last',
      'sync-status',
      'toast-stack',
      'm-topbar',
      'm-album-btn',
      'm-album-label',
      'm-count',
      'm-view-btn',
      'm-more-btn',
      'm-composer-head',
      'm-open-settings',
      'm-recent',
      'm-tabbar',
      'm-tab-badge',
      'm-queue-page',
      'm-queue-list',
      'm-queue-count',
      'm-queue-cancel-all',
      'm-queue-empty',
      'm-queue-go',
      'm-album-sheet',
      'm-album-list',
      'm-album-sheet-close',
      'm-album-new',
      'm-album-rename',
      'm-album-delete',
      'm-actions-sheet',
      'm-actions-close',
    ];

    for (const id of ids) {
      const key = id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      ui[key] = document.getElementById(id);
    }

    ui.mTabButtons = [...document.querySelectorAll('#m-tabbar [data-tab]')];
  }

  /* ---------------------------------------------------------------------- */
  /* Layout preferences                                                     */
  /* ---------------------------------------------------------------------- */

  function defaultGalleryDensity() {
    if (isMobileLayout()) return 'detailed';
    return window.innerWidth <= 680 || window.innerHeight < 780
      ? 'compact'
      : 'detailed';
  }

  function applyGalleryDensity(mode, { persist = false } = {}) {
    const compact = mode === 'compact';
    state.galleryDensity = compact ? 'compact' : 'detailed';
    ui.galleryGrid.classList.toggle('is-compact', compact);
    ui.galleryDensity.setAttribute('aria-pressed', String(compact));
    ui.galleryDensity.setAttribute(
      'aria-label',
      compact ? '当前紧凑图墙，切换到详细卡片' : '当前详细卡片，切换到紧凑图墙',
    );
    ui.galleryDensity.textContent = compact ? '详细卡片' : '紧凑图墙';
    ui.galleryDensity.title = compact
      ? '当前：紧凑图墙（点击切换详细卡片）'
      : '当前：详细卡片（点击切换紧凑图墙）';
    if (persist) writePreference(GALLERY_DENSITY_KEY, state.galleryDensity);
  }

  function initGalleryDensity() {
    const stored = readPreference(GALLERY_DENSITY_KEY);
    if (stored === 'compact' || stored === 'detailed') {
      state.galleryDensityManual = true;
      applyGalleryDensity(stored);
      return;
    }
    applyGalleryDensity(defaultGalleryDensity());
  }

  function toggleGalleryDensity() {
    state.galleryDensityManual = true;
    applyGalleryDensity(
      state.galleryDensity === 'compact' ? 'detailed' : 'compact',
      { persist: true },
    );
  }

  function applyGalleryView(mode, { persist = false, render = true } = {}) {
    state.viewMode = mode === 'images' ? 'images' : 'records';
    const records = state.viewMode === 'records';
    ui.galleryGrid.classList.toggle('is-record-view', records);
    ui.galleryView.setAttribute('aria-pressed', String(records));
    ui.galleryView.textContent = records ? '图片视图' : '记录视图';
    ui.galleryView.title = records
      ? '当前：记录视图（点击切换全部图片）'
      : '当前：图片视图（点击切换记录分组）';
    ui.galleryView.setAttribute(
      'aria-label',
      records ? '当前记录视图，切换到图片视图' : '当前图片视图，切换到记录视图',
    );
    ui.galleryTitle.textContent = records ? '创作记录' : '历史作品';
    updateMobileViewButton();
    if (persist) writePreference(GALLERY_VIEW_KEY, state.viewMode);
    if (records) {
      state.selected.clear();
      ui.selectionBar.hidden = true;
    }
    if (render) renderGallery();
  }

  function initGalleryView() {
    const stored = readPreference(GALLERY_VIEW_KEY);
    applyGalleryView(stored === 'images' ? 'images' : 'records', { render: false });
  }

  function toggleGalleryView() {
    applyGalleryView(state.viewMode === 'records' ? 'images' : 'records', {
      persist: true,
    });
  }

  function updateSidebarToggleLabel() {
    const desktop = window.innerWidth > 900;
    if (desktop) {
      const label = state.sidebarCollapsed ? '展开配置面板' : '收起配置面板';
      ui.sidebarToggle.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
      ui.sidebarToggle.setAttribute('aria-label', label);
      ui.sidebarToggle.title = label;
      return;
    }
    const open = ui.sidebar.classList.contains('is-open');
    const label = open ? '关闭配置面板' : '打开配置面板';
    ui.sidebarToggle.setAttribute('aria-expanded', String(open));
    ui.sidebarToggle.setAttribute('aria-label', label);
    ui.sidebarToggle.title = label;
  }

  function applySidebarCollapsed(collapsed, { persist = false } = {}) {
    state.sidebarCollapsed = Boolean(collapsed);
    ui.appShell.classList.toggle('is-sidebar-collapsed', state.sidebarCollapsed);
    updateSidebarToggleLabel();
    updateComposerMetrics();
    if (persist) {
      writePreference(SIDEBAR_COLLAPSED_KEY, String(state.sidebarCollapsed));
    }
  }

  function initLayoutPreferences() {
    initGalleryDensity();
    initGalleryView();
    applySidebarCollapsed(readPreference(SIDEBAR_COLLAPSED_KEY) === 'true');
  }

  function setFocusMode(active) {
    state.focusMode = Boolean(active);
    ui.appShell.classList.toggle('focus-mode', state.focusMode);
    ui.focusToggle.setAttribute('aria-pressed', String(state.focusMode));
    ui.focusToggle.setAttribute(
      'aria-label',
      state.focusMode ? '退出专注画廊' : '专注画廊',
    );
    ui.focusToggle.title = state.focusMode
      ? '退出专注画廊（Esc）'
      : '专注画廊：隐藏侧栏与输入区（Esc 退出）';
    if (state.focusMode && ui.sidebar.classList.contains('is-open')) {
      setSidebar(false);
    }
    updateComposerMetrics();
  }

  function setComposerExpanded(expanded) {
    state.composerExpanded = Boolean(expanded);
    ui.composer.classList.toggle('is-expanded', state.composerExpanded);
    ui.composerExpand.textContent = state.composerExpanded ? '收起编辑' : '展开编辑';
    ui.composerExpand.setAttribute('aria-expanded', String(state.composerExpanded));
    ui.composerExpand.title = state.composerExpanded ? '收起编辑区' : '展开为更大的编辑区';
    updateComposerMetrics();
    if (state.composerExpanded) ui.promptInput.focus({ preventScroll: true });
  }

  function setQueueCollapsed(collapsed) {
    state.queueCollapsed = Boolean(collapsed);
    ui.queuePanel.classList.toggle('is-collapsed', state.queueCollapsed);
    ui.queueToggle.textContent = state.queueCollapsed ? '展开' : '收起';
    ui.queueToggle.setAttribute('aria-expanded', String(!state.queueCollapsed));
  }

  /* ---------------------------------------------------------------------- */
  /* Mobile shell (bottom tabs)                                             */
  /* ---------------------------------------------------------------------- */

  function isMobileLayout() {
    return window.innerWidth <= 900;
  }

  function mobileTabFromHash() {
    const value = window.location.hash.replace(/^#/, '');
    return MOBILE_TABS.includes(value) ? value : '';
  }

  function setMobileTab(tab, { persist = true, syncHash = true } = {}) {
    const next = MOBILE_TABS.includes(tab) ? tab : 'gallery';
    state.mobileTab = next;
    document.body.dataset.mobileTab = next;

    for (const button of ui.mTabButtons || []) {
      const active = button.dataset.tab === next;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }

    if (next !== 'settings' && ui.sidebar.classList.contains('is-open')) {
      setSidebar(false);
    }
    if (next !== 'gallery') {
      if (document.body.classList.contains('is-selecting')) setMobileSelecting(false);
      if (state.selected.size > 0) clearSelection();
    }
    closeMobileSheet(ui.mAlbumSheet);
    closeMobileSheet(ui.mActionsSheet);
    if (next === 'queue') renderQueue();
    if (next === 'generate') updateComposerMetrics();
    if (persist) writePreference(MOBILE_TAB_KEY, next);

    if (syncHash && isMobileLayout()) {
      const hash = `#${next}`;
      if (window.location.hash !== hash) {
        try {
          window.history.pushState(null, '', hash);
        } catch {
          window.location.hash = next;
        }
      }
    }
  }

  function initMobileTab() {
    const fromHash = mobileTabFromHash();
    const stored = readPreference(MOBILE_TAB_KEY);
    const initial = fromHash || (MOBILE_TABS.includes(stored) ? stored : 'gallery');
    setMobileTab(initial, { persist: false, syncHash: false });
    updateMobileAlbumLabel();
    updateMobileViewButton();
  }

  function openMobileSheet(dialog, trigger = null) {
    if (!dialog || dialog.open) return;
    try {
      dialog.showModal();
    } catch {
      return;
    }
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
  }

  function closeMobileSheet(dialog) {
    if (dialog && dialog.open) dialog.close();
    if (ui.mAlbumBtn) ui.mAlbumBtn.setAttribute('aria-expanded', 'false');
    if (ui.mMoreBtn) ui.mMoreBtn.setAttribute('aria-expanded', 'false');
  }

  function updateMobileViewButton() {
    if (!ui.mViewBtn) return;
    const records = state.viewMode === 'records';
    ui.mViewBtn.classList.toggle('is-active', records);
    const label = records
      ? '当前：记录视图（点击切换全部图片）'
      : '当前：图片视图（点击切换记录分组）';
    ui.mViewBtn.setAttribute('aria-label', label);
    ui.mViewBtn.title = label;
  }

  function mobileAlbumTitle() {
    if (state.activeAlbumId === 'uncategorized') return '未分类';
    if (state.activeAlbumId === 'all') return '全部作品';
    return albumName(state.activeAlbumId);
  }

  function updateMobileAlbumLabel() {
    if (!ui.mAlbumLabel) return;
    ui.mAlbumLabel.textContent = mobileAlbumTitle();
    if (ui.mAlbumBtn) {
      ui.mAlbumBtn.setAttribute('aria-label', `切换画册，当前：${mobileAlbumTitle()}`);
    }
  }

  function mobileAlbumCover(entry) {
    if (entry.album?.coverUrl) return entry.album.coverUrl;
    if (entry.id === 'all') return state.history[0]?.url || '';
    if (entry.id === 'uncategorized') {
      return state.history.find((item) => !item.albumId)?.url || '';
    }
    return state.history.find((item) => item.albumId === entry.id)?.url || '';
  }

  function renderMobileAlbumSheet() {
    if (!ui.mAlbumList) return;
    const entries = [
      { id: 'all', name: '全部作品', count: state.history.length },
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
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'm-album-row';
      const active = state.activeAlbumId === entry.id;
      row.classList.toggle('is-active', active);
      row.setAttribute('aria-pressed', String(active));

      const coverUrl = mobileAlbumCover(entry);
      if (coverUrl) {
        const cover = document.createElement('img');
        cover.className = 'm-album-cover';
        cover.src = coverUrl;
        cover.alt = '';
        cover.loading = 'lazy';
        cover.decoding = 'async';
        row.append(cover);
      } else {
        const cover = document.createElement('span');
        cover.className = 'm-album-cover m-album-cover--empty';
        cover.textContent = '—';
        cover.setAttribute('aria-hidden', 'true');
        row.append(cover);
      }

      const copy = document.createElement('span');
      copy.className = 'm-album-copy';
      const name = document.createElement('span');
      name.className = 'm-album-name';
      name.textContent = entry.name;
      const sub = document.createElement('span');
      sub.className = 'm-album-sub';
      sub.textContent = `${entry.count} 张`;
      copy.append(name, sub);

      const check = document.createElement('span');
      check.className = 'm-album-check';
      check.innerHTML =
        '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4.5 10.4l3.6 3.6 7.4-8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

      row.append(copy, check);
      row.addEventListener('click', () => {
        state.activeAlbumId = entry.id;
        renderAlbums();
        renderGallery();
        closeMobileSheet(ui.mAlbumSheet);
        ui.galleryScroll.scrollTo({ top: 0, behavior: 'smooth' });
      });
      fragment.append(row);
    }
    ui.mAlbumList.replaceChildren(fragment);
  }

  function openMobileAlbumSheet() {
    updateMobileAlbumLabel();
    renderMobileAlbumSheet();
    openMobileSheet(ui.mAlbumSheet, ui.mAlbumBtn);
  }

  function renderMobileRecent() {
    if (!ui.mRecent) return;
    const items = state.history.slice(0, 12);
    if (items.length === 0) {
      ui.mRecent.hidden = true;
      ui.mRecent.replaceChildren();
      return;
    }
    ui.mRecent.hidden = false;
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'm-recent-item';
      button.setAttribute('aria-label', '查看最近一张作品');
      const image = document.createElement('img');
      image.src = item.url;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.draggable = false;
      button.append(image);
      button.addEventListener('click', () => openLightbox(item));
      fragment.append(button);
    }
    ui.mRecent.replaceChildren(fragment);
  }

  function runMobileAction(action) {
    closeMobileSheet(ui.mActionsSheet);
    switch (action) {
      case 'view':
        toggleGalleryView();
        break;
      case 'density':
        toggleGalleryDensity();
        break;
      case 'select': {
        const enabling = !document.body.classList.contains('is-selecting');
        if (enabling && state.viewMode === 'records') {
          applyGalleryView('images', { persist: true });
        }
        setMobileSelecting(enabling);
        break;
      }
      case 'prompts':
        openPromptDialog();
        break;
      case 'trash':
        openTrashDialog();
        break;
      case 'sync':
        openSyncDialog();
        break;
      case 'metadata':
        handleExportMetadata();
        break;
      case 'clear':
        handleClearGallery();
        break;
      case 'refresh':
        handleRefreshHistory();
        break;
      default:
        break;
    }
  }

  function setMobileSelecting(active) {
    const next = Boolean(active);
    document.body.classList.toggle('is-selecting', next);
    if (ui.mMoreBtn) ui.mMoreBtn.classList.toggle('is-active', next);
    if (next && state.selected.size === 0) {
      showToast('点按作品可多选，再通过底栏移动或删除。', 'info', 3600);
    }
  }

  function renderMobileActions() {
    if (!ui.mActionsSheet) return;
    const viewButton = ui.mActionsSheet.querySelector('[data-m-action="view"]');
    const densityButton = ui.mActionsSheet.querySelector('[data-m-action="density"]');
    const selectButton = ui.mActionsSheet.querySelector('[data-m-action="select"]');
    if (viewButton) {
      viewButton.textContent =
        state.viewMode === 'records' ? '切换到图片视图' : '切换到记录视图';
    }
    if (densityButton) {
      densityButton.textContent =
        state.galleryDensity === 'compact' ? '切换到详细卡片' : '切换到紧凑图墙';
    }
    if (selectButton) {
      const selecting = document.body.classList.contains('is-selecting');
      selectButton.textContent = selecting ? '退出多选' : '选择作品（多选）';
      selectButton.classList.toggle('m-action--active', selecting);
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

  function downloadBlob(filename, content, type = 'application/json') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openTextEditor({ title, help, value, maxLength = 0, onSave }) {
    state.textEditorSave = typeof onSave === 'function' ? onSave : null;
    ui.textEditorTitle.textContent = title || '编辑提示词';
    ui.textEditorHelp.textContent = help || '在大编辑器中修改，保存后写回原字段。';
    ui.textEditorInput.value = asText(value);
    if (maxLength > 0) ui.textEditorInput.setAttribute('maxlength', String(maxLength));
    else ui.textEditorInput.removeAttribute('maxlength');
    if (!ui.textEditorDialog.open) {
      try {
        ui.textEditorDialog.showModal();
      } catch {
        showToast('当前浏览器不支持大编辑器。', 'error');
        return;
      }
    }
    window.setTimeout(() => {
      ui.textEditorInput.focus();
      const end = ui.textEditorInput.value.length;
      ui.textEditorInput.setSelectionRange(end, end);
    }, 30);
  }

  function closeTextEditor() {
    state.textEditorSave = null;
    if (ui.textEditorDialog.open) ui.textEditorDialog.close();
  }

  function submitTextEditor() {
    const callback = state.textEditorSave;
    const value = ui.textEditorInput.value;
    closeTextEditor();
    if (callback) callback(value);
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

      const expand = createTinyButton('✎', '放大编辑这段提示词');
      expand.addEventListener('click', () => {
        openTextEditor({
          title: '编辑提示词块',
          help: '这段内容会按角色与插入位置发送给 LLM；保存后写回提示词结构。',
          value: block.content,
          maxLength: 8000,
          onSave: (value) => {
            block.content = value;
            markDirty();
            renderPromptBlocks();
          },
        });
      });

      const up = createTinyButton('↑', '上移');
      up.disabled = index === 0;
      up.addEventListener('click', () => movePromptBlock(block.id, -1));

      const down = createTinyButton('↓', '下移');
      down.disabled = index === state.promptBlocks.length - 1;
      down.addEventListener('click', () => movePromptBlock(block.id, 1));

      const remove = createTinyButton('×', '删除这段提示词');
      remove.addEventListener('click', () => removePromptBlock(block.id));

      actions.append(expand, up, down, remove);
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

  function handleNaiPresetExport() {
    if (state.naiPresets.length === 0) {
      showToast('还没有 NovelAI 预设可以导出。', 'warning');
      return;
    }
    const presets = state.naiPresets.map((preset) => {
      const normalized = normalizeNaiPreset(preset);
      const { id, ...rest } = normalized;
      return rest;
    });
    const payload = {
      schema: 'nai-atelier.nai-presets/1',
      version: 1,
      exportedAt: new Date().toISOString(),
      presets,
    };
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    downloadBlob(
      `nai-atelier-nai-presets-${stamp}.json`,
      `${JSON.stringify(payload, null, 2)}\n`,
    );
    showToast(`已导出 ${presets.length} 个 NovelAI 预设（不含 API Key）。`, 'success', 3600);
  }

  function nextImportedPresetName(base, usedNames) {
    const root = asText(base).trim().slice(0, 60) || '导入预设';
    let candidate = root;
    let counter = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      const suffix = ` (${counter})`;
      candidate = `${root.slice(0, 60 - suffix.length).trim()}${suffix}`;
      counter += 1;
    }
    usedNames.add(candidate.toLowerCase());
    return candidate;
  }

  async function handleNaiPresetImportFile(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('文件不是有效的 JSON。');
      }
      const rows = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.presets)
          ? parsed.presets
          : Array.isArray(parsed?.novelai?.presets)
            ? parsed.novelai.presets
            : null;
      if (!rows) {
        throw new Error('JSON 里没有找到 presets 数组。');
      }

      const previousPresets = JSON.parse(JSON.stringify(state.naiPresets));
      const previousActive = state.activeNaiPresetId;
      const usedNames = new Set(state.naiPresets.map((preset) => preset.name.toLowerCase()));
      const imported = [];
      for (const row of rows) {
        if (state.naiPresets.length + imported.length >= MAX_NAI_PRESETS) break;
        if (!row || typeof row !== 'object' || typeof row.name !== 'string' || !row.name.trim()) {
          continue;
        }
        const preset = normalizeNaiPreset(row);
        preset.id = uid();
        preset.name = nextImportedPresetName(preset.name, usedNames);
        imported.push(preset);
      }

      if (imported.length === 0) {
        showToast('没有可导入的有效预设。', 'warning');
        return;
      }

      state.naiPresets.push(...imported);
      renderNaiPresetSelect();
      try {
        await persistConfig();
        showToast(
          `已导入 ${imported.length} 个 NovelAI 预设${rows.length > imported.length ? `（其余 ${rows.length - imported.length} 个已跳过）` : ''}。`,
          'success',
          4400,
        );
      } catch (error) {
        state.naiPresets = previousPresets;
        state.activeNaiPresetId = previousActive;
        renderNaiPresetSelect();
        showToast(error.message, 'error');
      }
    } catch (error) {
      showToast(error.message || '导入预设失败。', 'error');
    } finally {
      input.value = '';
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
      recordId: asText(item.recordId),
      variantId: asText(item.variantId),
      userText: asText(item.userText),
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

  function normalizeRecordRow(raw) {
    if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
    const variants = (Array.isArray(raw.variants) ? raw.variants : [])
      .filter((variant) => variant && typeof variant.id === 'string' && variant.id)
      .map((variant) => ({
        id: variant.id,
        title: asText(variant.title),
        llmTags: asText(variant.llmTags),
        source: ['llm', 'manual', 'legacy'].includes(variant.source)
          ? variant.source
          : 'llm',
        llmModel: asText(variant.llmModel),
        createdAt: asText(variant.createdAt),
        updatedAt: asText(variant.updatedAt),
        imageCount: Number(variant.imageCount) || 0,
      }));
    if (variants.length === 0) return null;
    return {
      id: raw.id,
      userText: asText(raw.userText),
      title: asText(raw.title),
      createdAt: asText(raw.createdAt),
      updatedAt: asText(raw.updatedAt),
      variants,
      variantCount: Number(raw.variantCount) || variants.length,
      imageCount: Number(raw.imageCount) || 0,
      coverId: asText(raw.coverId),
      coverUrl: asText(raw.coverUrl),
      latestImageAt: asText(raw.latestImageAt),
    };
  }

  function normalizeRecordRows(rows) {
    return (Array.isArray(rows) ? rows : [])
      .map(normalizeRecordRow)
      .filter(Boolean);
  }

  async function loadRecords() {
    const payload = await requestJson('/api/records');
    state.records = normalizeRecordRows(payload.records);
    if (state.activeRecordId && !state.records.some((record) => record.id === state.activeRecordId)) {
      closeRecordDialog();
    }
    if (state.viewMode === 'records') renderGallery();
    if (ui.recordDialog.open && state.activeRecordId) {
      renderRecordDialog(state.activeRecordId);
    }
    return state.records.length;
  }

  function recordImages(recordId) {
    return state.history.filter((item) => item.recordId === recordId);
  }

  function recordAlbumIds(recordId) {
    return [...new Set(recordImages(recordId).map((item) => item.albumId).filter(Boolean))];
  }

  function recordTitle(record) {
    return (
      asText(record?.variants?.[0]?.title) ||
      asText(record?.title) ||
      asText(record?.userText).slice(0, 40) ||
      '旧作品'
    );
  }

  function visibleRecords() {
    return state.records.filter((record) => {
      const images = recordImages(record.id);
      if (state.activeAlbumId === 'all') return true;
      if (state.activeAlbumId === 'uncategorized') {
        return images.length === 0 || images.some((item) => !item.albumId);
      }
      return images.some((item) => item.albumId === state.activeAlbumId);
    });
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
    updateMobileAlbumLabel();
    renderMobileAlbumSheet();
    if (ui.mAlbumNew) ui.mAlbumNew.disabled = state.albums.length >= 60;
    if (ui.mAlbumRename) ui.mAlbumRename.disabled = !album;
    if (ui.mAlbumDelete) ui.mAlbumDelete.disabled = !album;
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
    if (state.viewMode === 'records') {
      ui.emptyTitle.textContent = '还没有创作记录。';
      ui.emptyCopy.textContent =
        '在下方输入一句画面描述；同一条记录的多次生图和多个 Tag 版本会收纳在一起。';
      return;
    }
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
    renderMobileRecent();
    if (state.viewMode === 'records') {
      renderRecordGallery();
      return;
    }

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
    let index = 0;
    for (const item of items) {
      fragment.append(createArtCard(item, false, index < 12));
      index += 1;
    }
    ui.galleryGrid.append(fragment);
    updateGalleryCount();
    refreshSelectionUI();
  }

  function renderRecordGallery() {
    ui.galleryGrid.replaceChildren();
    updateEmptyCopy();

    const rows = visibleRecords();
    if (rows.length === 0) {
      ui.galleryEmpty.hidden = false;
      ui.galleryGrid.hidden = true;
      updateGalleryCount();
      refreshSelectionUI();
      return;
    }

    ui.galleryEmpty.hidden = true;
    ui.galleryGrid.hidden = false;
    const fragment = document.createDocumentFragment();
    let index = 0;
    for (const record of rows) {
      fragment.append(createRecordCard(record, index < 12));
      index += 1;
    }
    ui.galleryGrid.append(fragment);
    updateGalleryCount();
    refreshSelectionUI();
  }

  function createRecordCard(record, eager = false) {
    const images = recordImages(record.id)
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const cover = images[0] || null;
    const card = document.createElement('article');
    card.className = 'record-card';
    card.dataset.id = record.id;
    card.title = record.userText || recordTitle(record);
    card.classList.toggle('record-card--stacked', images.length > 1);

    const stack = document.createElement('div');
    stack.className = 'record-stack';

    const coverButton = document.createElement('button');
    coverButton.type = 'button';
    coverButton.className = 'record-cover';
    coverButton.setAttribute('aria-label', `打开记录：${recordTitle(record)}`);
    if (cover) {
      const image = document.createElement('img');
      image.src = cover.url;
      image.alt = `记录封面：${recordTitle(record)}`;
      image.loading = eager ? 'eager' : 'lazy';
      image.decoding = 'async';
      image.draggable = false;
      coverButton.append(image);
    } else {
      const empty = document.createElement('span');
      empty.className = 'record-cover-empty';
      empty.textContent = '尚未生图';
      coverButton.append(empty);
    }
    coverButton.addEventListener('click', () => openRecordDialog(record.id));

    const badges = document.createElement('div');
    badges.className = 'record-badges';
    const imageBadge = document.createElement('span');
    imageBadge.className = 'record-badge';
    imageBadge.textContent = `${images.length} 张`;
    const variantBadge = document.createElement('span');
    variantBadge.className = 'record-badge record-badge--accent';
    variantBadge.textContent = `${record.variants.length} 版 Tags`;
    badges.append(imageBadge, variantBadge);

    stack.append(coverButton, badges);

    const body = document.createElement('div');
    body.className = 'record-body';

    const title = document.createElement('h3');
    title.className = 'record-title';
    title.textContent = recordTitle(record);

    const userText = document.createElement('p');
    userText.className = 'record-usertext';
    userText.textContent = record.userText || '旧作品 · 无原始输入';

    const meta = document.createElement('div');
    meta.className = 'record-meta';
    const date = document.createElement('span');
    date.textContent = formatCardDate(record.updatedAt || record.createdAt);
    const tagCount = document.createElement('span');
    tagCount.textContent = `${record.variants.length} 个 Tag 版本`;
    const imageCount = document.createElement('span');
    imageCount.textContent = `${images.length} 张图`;
    meta.append(date, tagCount, imageCount);

    body.append(title, userText, meta);
    card.append(stack, body);
    card.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      openRecordDialog(record.id);
    });
    return card;
  }

  function appendGeneratedCard(item) {
    const normalized = normalizeHistoryItem(item);
    if (!normalized) {
      throw new Error('服务端返回的图片记录格式无效。');
    }

    state.lastCreatedId = normalized.id;
    state.history = state.history.filter((entry) => entry.id !== normalized.id);
    state.history.unshift(normalized);

    renderAlbums();
    renderMobileRecent();
    if (state.viewMode === 'records') return;

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
  }

  function updateGalleryCount() {
    if (state.viewMode === 'records') {
      const visible = visibleRecords();
      const imageTotal = visible.reduce((sum, record) => sum + recordImages(record.id).length, 0);
      ui.galleryCount.textContent =
        state.activeAlbumId === 'all'
          ? `${visible.length} 条记录 · ${imageTotal} 张图`
          : `${visible.length} / ${state.records.length} 条记录`;
      ui.galleryCount.title = '当前视图按原始输入分组';
      if (ui.mCount) ui.mCount.textContent = `${visible.length} 条`;
      return;
    }
    const visible = visibleHistory().length;
    ui.galleryCount.textContent =
      state.activeAlbumId === 'all'
        ? `${visible} 张`
        : `${visible} / ${state.history.length} 张`;
    if (ui.mCount) ui.mCount.textContent = `${visible} 张`;
    ui.galleryCount.title = activeAlbum()
      ? `当前画册：${activeAlbum().name}`
      : state.activeAlbumId === 'uncategorized'
        ? '当前：未分类'
        : '全部作品';
  }

  function activeJobFor(kind, recordId, variantId = '') {
    return state.jobs.find(
      (job) =>
        job.kind === kind &&
        job.recordId === recordId &&
        (!variantId || job.variantId === variantId) &&
        isActiveJob(job),
    );
  }

  function targetAlbumId() {
    return state.activeAlbumId !== 'all' && state.activeAlbumId !== 'uncategorized'
      ? state.activeAlbumId
      : null;
  }

  function recordVariantSourceLabel(source) {
    if (source === 'manual') return '手动';
    if (source === 'legacy') return '旧作品';
    return 'LLM';
  }

  function openRecordDialog(recordId) {
    const record = state.records.find((entry) => entry.id === recordId);
    if (!record) {
      showToast('没有找到这条记录，请刷新后再试。', 'error');
      return;
    }
    state.activeRecordId = recordId;
    renderRecordDialog(recordId);
    if (!ui.recordDialog.open) {
      try {
        ui.recordDialog.showModal();
      } catch {
        showToast('当前浏览器不支持记录详情。', 'error');
      }
    }
  }

  function closeRecordDialog() {
    if (ui.recordDialog.open) ui.recordDialog.close();
    state.activeRecordId = '';
  }

  function refreshActiveRecordDialog() {
    if (ui.recordDialog.open && state.activeRecordId) {
      renderRecordDialog(state.activeRecordId);
    }
  }

  function renderRecordDialog(recordId) {
    const record = state.records.find((entry) => entry.id === recordId);
    if (!record) {
      closeRecordDialog();
      return;
    }
    ui.recordDialogTitle.textContent = recordTitle(record);
    ui.recordDialog.style.setProperty('--variant-count', String(record.variants.length));
    ui.recordOriginalText.textContent = record.userText
      ? `原始输入：${record.userText}`
      : '旧作品 · 没有保存原始输入';
    ui.recordReuseText.disabled = !record.userText;
    const rerollJob = activeJobFor('reroll', record.id);
    ui.recordReroll.disabled =
      !record.userText || record.variants.length >= 30 || Boolean(rerollJob);
    ui.recordReroll.textContent = rerollJob ? '重 roll 中…' : '重 roll Tags';
    ui.recordReroll.title = !record.userText
      ? '旧记录没有原始输入，无法重 roll'
      : record.variants.length >= 30
        ? 'Tag 版本已达上限'
        : '用同一段原始输入重新生成一个 Tag 版本（不自动生图）';

    const fragment = document.createDocumentFragment();
    for (const variant of record.variants) {
      fragment.append(createVariantCard(record, variant));
    }
    ui.recordVariants.replaceChildren(fragment);
  }

  function createVariantCard(record, variant) {
    const card = document.createElement('section');
    card.className = 'variant-card';
    card.dataset.variantId = variant.id;

    const head = document.createElement('div');
    head.className = 'variant-card-head';
    const titleInput = document.createElement('input');
    titleInput.className = 'variant-title-input';
    titleInput.type = 'text';
    titleInput.maxLength = 80;
    titleInput.value = variant.title || recordTitle(record);
    titleInput.setAttribute('aria-label', 'Tag 版本标题');
    const source = document.createElement('span');
    source.className = 'variant-source';
    source.textContent = recordVariantSourceLabel(variant.source);
    head.append(titleInput, source);

    const body = document.createElement('div');
    body.className = 'variant-body';
    const tags = document.createElement('textarea');
    tags.className = 'variant-tags';
    tags.spellcheck = false;
    tags.value = variant.llmTags;
    tags.setAttribute('aria-label', 'Tag 版本提示词');
    tags.maxLength = 8000;

    const actions = document.createElement('div');
    actions.className = 'variant-actions';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'mini-btn variant-save';
    save.textContent = '保存修改';
    const render = document.createElement('button');
    render.type = 'button';
    render.className = 'mini-btn';
    render.textContent = '用此版本生图';
    const renderJob = activeJobFor('render', record.id, variant.id);
    if (renderJob) {
      render.disabled = true;
      render.textContent = '已加入队列';
    }
    const count = document.createElement('span');
    count.className = 'variant-count';
    const variantImages = state.history.filter(
      (item) => item.recordId === record.id && item.variantId === variant.id,
    );
    count.textContent = `${variantImages.length} 张图`;
    actions.append(save, render, count);
    body.append(tags, actions);

    save.addEventListener('click', () => {
      saveVariantChanges(record.id, variant.id, titleInput, tags, save);
    });
    render.addEventListener('click', () => {
      enqueueVariantRender(record, variant, render);
    });

    const images = document.createElement('div');
    images.className = 'variant-images';
    if (variantImages.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'variant-empty';
      empty.textContent = '这个 Tag 版本还没有生图。';
      images.append(empty);
    } else {
      for (const item of variantImages) {
        const imageButton = document.createElement('button');
        imageButton.type = 'button';
        imageButton.className = 'variant-image';
        imageButton.setAttribute('aria-label', '查看这张图片');
        const image = document.createElement('img');
        image.src = item.url;
        image.alt = item.prompt ? item.prompt.slice(0, 80) : '生成图片';
        image.loading = 'lazy';
        image.decoding = 'async';
        imageButton.append(image);
        imageButton.addEventListener('click', () => openLightbox(item));
        images.append(imageButton);
      }
    }

    card.append(head, body, images);
    return card;
  }

  async function saveVariantChanges(recordId, variantId, titleInput, tagsArea, button) {
    const title = titleInput.value.trim();
    const llmTags = tagsArea.value.trim();
    if (!llmTags) {
      showToast('Tag 提示词不能为空。', 'warning');
      tagsArea.focus();
      return;
    }
    button.disabled = true;
    try {
      const payload = await requestJson(
        `/api/records/${encodeURIComponent(recordId)}/variants/${encodeURIComponent(variantId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ title, llmTags }),
        },
      );
      const updated = normalizeRecordRow(payload.record);
      if (updated) {
        const index = state.records.findIndex((entry) => entry.id === updated.id);
        if (index >= 0) state.records[index] = updated;
      }
      if (state.viewMode === 'records') renderGallery();
      renderRecordDialog(recordId);
      showToast('Tag 版本已保存；只影响之后用该版本生成的新图。', 'success', 3200);
    } catch (error) {
      showToast(error.message || '保存 Tag 版本失败。', 'error');
      button.disabled = false;
    }
  }

  async function enqueueVariantRender(record, variant, button) {
    if (activeJobFor('render', record.id, variant.id)) return;
    button.disabled = true;
    button.textContent = '已加入队列';
    try {
      const job = await enqueueGenerationJob({
        kind: 'render',
        recordId: record.id,
        variantId: variant.id,
        albumId: targetAlbumId(),
      });
      if (job) {
        showToast('已加入生图队列；完成后会出现在这个 Tag 版本下。', 'success', 3200);
      }
    } catch (error) {
      button.disabled = false;
      button.textContent = '用此版本生图';
      showToast(error.message || '加入生图队列失败。', 'error');
    }
  }

  async function handleRecordReroll() {
    const record = state.records.find((entry) => entry.id === state.activeRecordId);
    if (!record || !record.userText) return;
    if (activeJobFor('reroll', record.id)) return;
    ui.recordReroll.disabled = true;
    ui.recordReroll.textContent = '重 roll 中…';
    try {
      const job = await enqueueGenerationJob({ kind: 'reroll', recordId: record.id });
      if (job) showToast('已加入 Tag 重 roll 队列；只生成新版本，不自动生图。', 'info', 3400);
    } catch (error) {
      showToast(error.message || '重 roll Tags 失败。', 'error');
      renderRecordDialog(record.id);
    }
  }

  function reuseUserText(text) {
    const value = asText(text).trim();
    if (!value) return;
    if (ui.lightbox.open) closeLightbox();
    if (ui.recordDialog.open) closeRecordDialog();
    ui.promptInput.value = value;
    updateComposerMetrics();
    ui.promptInput.focus();
    showToast('原始输入已填回底部输入框，可继续修改。', 'success', 2800);
  }

  function createArtCard(item, fresh, eager = false) {
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
    image.loading = fresh || eager ? 'eager' : 'lazy';
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

    const userText = document.createElement('p');
    userText.className = 'art-usertext';
    userText.textContent = item.userText ? `“${item.userText}”` : '旧记录 · 未保存原始输入';
    userText.title = item.userText || '';

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

    body.append(head, userText, prompt, meta, albumRow);
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
    if (state.viewMode === 'records') {
      ui.selectionBar.hidden = true;
      return;
    }
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
      refreshActiveRecordDialog();
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
      refreshActiveRecordDialog();
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
        loadRecords(),
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
      refreshActiveRecordDialog();
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
      refreshActiveRecordDialog();
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
  /* Device sync                                                            */
  /* ---------------------------------------------------------------------- */

  const syncPanel = {
    status: null,
    busy: false,
    timer: 0,
    tokenDirty: false,
  };

  function syncAddressHint(status) {
    if (!status) return '';
    if (!status.enabled) return '同步开关是关的：打开并保存后，另一台设备才能连进来。';
    if (status.serverError) return status.serverError;
    const addresses = Array.isArray(status.addresses) ? status.addresses : [];
    if (addresses.length === 0) {
      return `正在监听端口 ${status.port}，但没有检测到局域网地址（确认两台设备连的是同一个 Wi-Fi）。`;
    }
    return `在另一台设备填：${addresses.map((address) => `${address}:${status.port}`).join(' 或 ')}`;
  }

  function setSyncMessage(text, tone = '') {
    if (!ui.syncStatus) return;
    ui.syncStatus.textContent = text || '';
    ui.syncStatus.hidden = !text;
    ui.syncStatus.classList.toggle('is-error', tone === 'error');
    ui.syncStatus.classList.toggle('is-done', tone === 'done');
  }

  function setSyncBusy(busy, message = '') {
    syncPanel.busy = busy;
    if (ui.syncRun) {
      ui.syncRun.disabled = busy;
      ui.syncRun.textContent = busy ? '同步中…' : '开始同步';
    }
    if (ui.syncSave) ui.syncSave.disabled = busy;
    if (busy) setSyncMessage(message || '正在同步…');
  }

  function formatSyncTime(value) {
    const text = asText(value);
    if (!text) return '';
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', { hour12: false });
  }

  function fillSyncForm(status) {
    if (!status || !ui.syncDialog) return;
    if (document.activeElement !== ui.syncDeviceName) {
      ui.syncDeviceName.value = status.deviceName || '';
    }
    if (document.activeElement !== ui.syncPort) {
      ui.syncPort.value = String(status.port || 3801);
    }
    ui.syncToken.value = status.token || '';
    ui.syncEnabled.checked = Boolean(status.enabled);
    if (document.activeElement !== ui.syncPeerUrl && status.lastPeerUrl) {
      ui.syncPeerUrl.value = status.lastPeerUrl;
    }
    ui.syncAddressHint.textContent = syncAddressHint(status);
    const last = formatSyncTime(status.lastSyncAt);
    ui.syncLast.textContent = last ? `上次同步：${last}` : '还没有同步过。';
    if (status.serverError) setSyncMessage(status.serverError, 'error');
  }

  async function refreshSyncStatus() {
    const payload = await requestJson('/api/sync/status');
    syncPanel.status = payload.status || null;
    if (ui.syncDialog?.open && syncPanel.status) fillSyncForm(syncPanel.status);
    return syncPanel.status;
  }

  async function openSyncDialog() {
    if (!ui.syncDialog) return;
    setSyncMessage('');
    ui.syncDialog.showModal();
    try {
      await refreshSyncStatus();
    } catch (error) {
      setSyncMessage(error.message || '读取同步设置失败。', 'error');
    }
  }

  async function saveSyncSettings({ regenerateToken = false } = {}) {
    try {
      setSyncMessage('');
      const payload = await requestJson('/api/sync/settings', {
        method: 'POST',
        body: JSON.stringify({
          deviceName: ui.syncDeviceName.value.trim(),
          port: Number(ui.syncPort.value) || undefined,
          enabled: ui.syncEnabled.checked,
          regenerateToken,
        }),
      });
      syncPanel.status = payload.status || null;
      fillSyncForm(syncPanel.status);
      setSyncMessage(
        regenerateToken
          ? '已生成新口令：另一台设备也要填同一串口令才能同步。'
          : '设置已保存。',
        'done',
      );
      showToast('同步设置已保存。', 'success', 2600);
    } catch (error) {
      setSyncMessage(error.message || '保存同步设置失败。', 'error');
    }
  }

  async function copySyncToken() {
    const token = ui.syncToken?.value || '';
    if (!token) {
      showToast('还没有同步口令，请先保存设置。', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(token);
      showToast('口令已复制。', 'success', 2200);
    } catch {
      ui.syncToken.select();
      showToast('无法自动复制，口令已选中，请按 Ctrl+C。', 'warning', 3600);
    }
  }

  async function checkSyncPeer() {
    const peerUrl = ui.syncPeerUrl.value.trim();
    if (!peerUrl) {
      ui.syncPeerHint.textContent = '先填对方地址，例如 192.168.1.8:3801。';
      return;
    }
    ui.syncPeerCheck.disabled = true;
    ui.syncPeerHint.textContent = '正在连接…';
    try {
      const payload = await requestJson('/api/sync/peer-check', {
        method: 'POST',
        body: JSON.stringify({ peerUrl }),
      });
      const name = asText(payload.deviceName) || '另一台设备';
      const version = asText(payload.version);
      ui.syncPeerHint.textContent = `已连接：${name}${version ? `（v${version}）` : ''}。`;
      setSyncMessage('对方在线，可以开始同步。', 'done');
    } catch (error) {
      ui.syncPeerHint.textContent = '连接失败。';
      setSyncMessage(error.message || '连不上对方。', 'error');
    } finally {
      ui.syncPeerCheck.disabled = false;
    }
  }

  function startSyncPolling() {
    stopSyncPolling();
    syncPanel.timer = window.setInterval(async () => {
      try {
        const status = await refreshSyncStatus();
        if (status?.running && status.progress?.message) {
          setSyncMessage(status.progress.message);
        }
      } catch {
        // Polling is best-effort; the main request reports real errors.
      }
    }, 900);
  }

  function stopSyncPolling() {
    if (syncPanel.timer) {
      window.clearInterval(syncPanel.timer);
      syncPanel.timer = 0;
    }
  }

  async function runDeviceSync() {
    if (syncPanel.busy) return;
    const peerUrl = ui.syncPeerUrl.value.trim();
    if (!peerUrl) {
      setSyncMessage('请先填写另一台设备的地址，例如 192.168.1.8:3801。', 'error');
      return;
    }

    setSyncBusy(true, '正在连接另一台设备…');
    startSyncPolling();
    try {
      const payload = await requestJson('/api/sync/run', {
        method: 'POST',
        body: JSON.stringify({ peerUrl }),
      });
      const result = payload.result || {};
      const lines = [
        result.peerDeviceName ? `已和「${result.peerDeviceName}」对齐。` : '同步完成。',
        `新增/更新 ${Number(result.created) || 0} 项，删除 ${Number(result.deleted) || 0} 项；接收 ${Number(result.downloaded) || 0} 个文件，发送 ${Number(result.uploaded) || 0} 个。`,
      ];
      const warnings = Array.isArray(result.warnings) ? result.warnings : [];
      if (warnings.length > 0) lines.push(...warnings.slice(0, 4));
      setSyncMessage(lines.join('\n'), 'done');

      syncPanel.status = payload.status || syncPanel.status;
      if (syncPanel.status) {
        ui.syncLast.textContent = `上次同步：${formatSyncTime(syncPanel.status.lastSyncAt) || '刚刚'}`;
        ui.syncAddressHint.textContent = syncAddressHint(syncPanel.status);
      }

      await Promise.all([
        loadHistory().catch(() => {}),
        loadAlbums().catch(() => {}),
        loadTrash().catch(() => {}),
        loadPrompts().catch(() => {}),
      ]);
      showToast('同步完成。', 'success', 3200);
    } catch (error) {
      setSyncMessage(error.message || '同步失败。', 'error');
      showToast(error.message || '同步失败。', 'error', 5200);
    } finally {
      stopSyncPolling();
      setSyncBusy(false);
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
      refreshActiveRecordDialog();
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
    const userText = asText(item.userText).trim();
    ui.lightboxOriginal.classList.toggle('is-empty', !userText);
    ui.lightboxOriginalText.textContent = userText || '旧记录未保存原始输入。';
    ui.lightboxReuseText.disabled = !userText;
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

  function setLightboxZoom(zoomed) {
    const active = Boolean(zoomed);
    ui.lightbox.classList.toggle('is-zoom', active);
    ui.lightboxImage.title = active ? '点击退出全屏' : '点击全屏查看原图';
    ui.lightboxImage.setAttribute('aria-pressed', String(active));
  }

  function toggleLightboxZoom() {
    setLightboxZoom(!ui.lightbox.classList.contains('is-zoom'));
  }

  function openLightbox(item) {
    state.lightboxItems = lightboxListFor(item);
    let index = state.lightboxItems.findIndex((entry) => entry.id === item.id);
    if (index < 0) {
      state.lightboxItems = [item];
      index = 0;
    }
    state.lightboxIndex = index;
    setLightboxZoom(false);
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
    updateSidebarToggleLabel();

    if (open && focusClose) {
      window.setTimeout(() => ui.sidebarClose.focus(), 80);
    } else if (!open && ui.sidebar.contains(document.activeElement)) {
      ui.sidebarToggle.focus();
    }
  }

  function focusField(field) {
    if (window.innerWidth <= 900) setMobileTab('settings');
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
      kind: ['rerender', 'reroll', 'render'].includes(raw.kind) ? raw.kind : 'generate',
      label: asText(raw.label, '任务'),
      status,
      stage: asText(raw.stage),
      message: asText(raw.message),
      progress: Number.isFinite(Number(raw.progress)) ? Number(raw.progress) : 0,
      albumId: asText(raw.albumId) || null,
      text: asText(raw.text),
      historyId: asText(raw.historyId),
      recordId: asText(raw.recordId),
      variantId: asText(raw.variantId),
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
      state.lastFinishedJobId = job.id;

      if (job.kind === 'reroll') {
        const record = job.result.record;
        showToast(
          `新的 Tag 版本已生成${record ? ` · 共 ${record.variantCount} 版` : ''}，可并排对比。`,
          'success',
          4200,
        );
        loadRecords().catch(() => {});
        setStage('success', 'Tag 重 roll 完成 · 可以并排对比', formatDuration(job.elapsedMs));
        setProgress(100, true);
        scheduleProgressHide();
        return;
      }

      try {
        appendGeneratedCard(job.result);
      } catch (error) {
        showToast(error.message || '生成完成，但图片记录无法显示。', 'error');
      }

      const albumId = job.result.albumId;
      const targetName = albumId ? albumName(albumId) : '未分类';

      if (job.kind === 'rerender') {
        showToast(
          `重画完成 · ${modelLabel(job.result.model)}${albumId ? ` · 画册「${targetName}」` : ''}`,
          'success',
          4200,
        );
        const created = state.history.find((entry) => entry.id === state.lastCreatedId);
        if (created) window.setTimeout(() => openLightbox(created), 240);
      } else if (job.kind === 'render') {
        showToast(
          `记录生图完成 · 新图已追加到对应 Tag 版本${albumId ? ` · 画册「${targetName}」` : ''}。`,
          'success',
          3600,
        );
      } else {
        showToast(
          albumId
            ? `新作品已保存到画册「${targetName}」。`
            : '新作品已生成，并追加到画廊顶部。',
          'success',
          3200,
        );
      }

      loadRecords().catch(() => {});
      setStage(
        'success',
        job.kind === 'rerender'
          ? '重画完成 · 新图已自动打开'
          : job.kind === 'render'
            ? '记录生图完成 · 新图已追加'
            : '生成完成 · 图片已保存',
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
      if (job.recordId && ui.recordDialog.open && state.activeRecordId) {
        renderRecordDialog(state.activeRecordId);
      }
      return;
    }

    if (job.status === 'error') {
      const message = job.error?.message || '生成失败，请稍后重试。';
      showToast(message, 'error', 6500);
      setStage('error', message, 'FAILED');
      setProgress(0, false);
      stopElapsedTimer();
      if (job.recordId && ui.recordDialog.open && state.activeRecordId) {
        renderRecordDialog(state.activeRecordId);
      }
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

  function createQueueRow(job) {
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
    label.textContent =
      job.kind === 'rerender'
        ? '重画'
        : job.kind === 'reroll'
          ? '重 Roll'
          : job.kind === 'render'
            ? '记录生图'
            : '文生图';

    const text = document.createElement('span');
    text.className = 'queue-item-text';
    text.textContent =
      job.kind === 'rerender'
        ? '历史作品重画'
        : job.kind === 'reroll'
          ? '重新生成 Tag 版本'
          : job.kind === 'render'
            ? '按已有 Tag 版本生图'
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
    return row;
  }

  function renderQueue() {
    const active = state.jobs.filter(isActiveJob);
    // Only list finished jobs that belong to this page session: older queue
    // history would otherwise push the gallery out of view on every reload.
    const finished = state.jobs.filter(
      (job) => !isActiveJob(job) && state.sessionJobIds.has(job.id),
    );
    const rows =
      active.length > 0
        ? [
            ...active,
            ...finished.slice(0, Math.max(0, MAX_QUEUE_ROWS - active.length)),
          ]
        : [];

    const wasHidden = ui.queuePanel.hidden;
    ui.queuePanel.hidden = rows.length === 0;
    if (wasHidden && rows.length > 0 && active.length > 0) {
      setQueueCollapsed(false);
    }
    ui.queueCount.textContent = String(active.length);
    const queuedCount = state.jobs.filter((job) => job.status === 'queued').length;
    ui.queueCancelAll.hidden = queuedCount === 0;
    ui.queueCancelAll.disabled = queuedCount === 0;

    const fragment = document.createDocumentFragment();
    for (const job of rows) fragment.append(createQueueRow(job));
    ui.queueList.replaceChildren(fragment);
    renderMobileQueue(rows, active.length, queuedCount);
  }

  function renderMobileQueue(rows, activeCount, queuedCount) {
    if (!ui.mTabBadge || !ui.mQueueList) return;
    ui.mTabBadge.hidden = activeCount === 0;
    ui.mTabBadge.textContent = String(activeCount);
    ui.mQueueCount.textContent = activeCount > 0 ? `${activeCount} 个进行中` : '空闲';
    ui.mQueueCancelAll.hidden = queuedCount === 0;
    ui.mQueueCancelAll.disabled = queuedCount === 0;
    ui.mQueueEmpty.hidden = rows.length > 0;

    const fragment = document.createDocumentFragment();
    for (const job of rows) fragment.append(createQueueRow(job));
    ui.mQueueList.replaceChildren(fragment);
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
    const input = ui.promptInput;
    if (!input.value) {
      input.style.height = '';
      return;
    }
    const mobile = isMobileLayout();
    const compactCap = mobile
      ? Math.round(window.innerHeight * 0.34)
      : window.innerHeight <= 720
        ? 96
        : 128;
    const cap = state.composerExpanded
      ? Math.min(window.innerHeight * (mobile ? 0.56 : 0.46), mobile ? 560 : 520)
      : compactCap;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, cap)}px`;
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
    ui.naiPresetExport.addEventListener('click', handleNaiPresetExport);
    ui.naiPresetImport.addEventListener('click', () => ui.naiPresetFile.click());
    ui.naiPresetFile.addEventListener('change', handleNaiPresetImportFile);

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
    ui.composerExpand.addEventListener('click', () => {
      setComposerExpanded(!state.composerExpanded);
    });
    updateComposerMetrics();

    ui.generateBtn.addEventListener('click', handleGenerate);
    ui.cancelJob.addEventListener('click', cancelRunningJob);
    ui.queueCancelAll.addEventListener('click', cancelAllQueuedJobs);
    ui.queueToggle.addEventListener('click', () => {
      setQueueCollapsed(!state.queueCollapsed);
    });

    // Gallery actions.
    ui.refreshHistory.addEventListener('click', handleRefreshHistory);
    ui.galleryDensity.addEventListener('click', toggleGalleryDensity);
    ui.galleryView.addEventListener('click', toggleGalleryView);
    ui.albumNew.addEventListener('click', handleCreateAlbum);
    ui.albumRename.addEventListener('click', handleRenameAlbum);
    ui.albumDelete.addEventListener('click', handleDeleteAlbum);
    ui.galleryClear.addEventListener('click', handleClearGallery);
    ui.exportMetadata.addEventListener('click', handleExportMetadata);

    // Prompt pencils: open one shared large editor and write back on save.
    document.querySelectorAll('.prompt-pencil[data-editor-target]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = document.getElementById(button.dataset.editorTarget || '');
        if (!target) return;
        const maxLength = Number(target.getAttribute('maxlength')) || 0;
        openTextEditor({
          title: button.getAttribute('aria-label') || '编辑提示词',
          help: '在大编辑器中修改；保存后写回原来的提示词字段。',
          value: target.value,
          maxLength,
          onSave: (value) => {
            target.value = value;
            target.dispatchEvent(new Event('input', { bubbles: true }));
          },
        });
      });
    });

    // Shared text editor.
    ui.textEditorForm.addEventListener('submit', (event) => {
      event.preventDefault();
      submitTextEditor();
    });
    ui.textEditorCancel.addEventListener('click', closeTextEditor);
    ui.textEditorClose.addEventListener('click', closeTextEditor);
    ui.textEditorDialog.addEventListener('click', (event) => {
      if (event.target === ui.textEditorDialog) closeTextEditor();
    });
    ui.textEditorDialog.addEventListener('close', () => {
      state.textEditorSave = null;
    });
    ui.textEditorInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        submitTextEditor();
      }
    });

    // Record detail dialog.
    ui.recordClose.addEventListener('click', closeRecordDialog);
    ui.recordDialog.addEventListener('click', (event) => {
      if (event.target === ui.recordDialog) closeRecordDialog();
    });
    ui.recordDialog.addEventListener('close', () => {
      state.activeRecordId = '';
    });
    ui.recordReuseText.addEventListener('click', () => {
      const record = state.records.find((entry) => entry.id === state.activeRecordId);
      if (record) reuseUserText(record.userText);
    });
    ui.recordReroll.addEventListener('click', handleRecordReroll);
    ui.lightboxReuseText.addEventListener('click', () => {
      if (state.activeItem) reuseUserText(state.activeItem.userText);
    });

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

    // Device sync.
    ui.openSync.addEventListener('click', () => openSyncDialog());
    ui.syncClose.addEventListener('click', () => ui.syncDialog.close());
    ui.syncDialog.addEventListener('click', (event) => {
      if (event.target === ui.syncDialog && !syncPanel.busy) ui.syncDialog.close();
    });
    ui.syncDialog.addEventListener('close', stopSyncPolling);
    ui.syncSave.addEventListener('click', () => saveSyncSettings());
    ui.syncTokenRegenerate.addEventListener('click', () => saveSyncSettings({ regenerateToken: true }));
    ui.syncTokenCopy.addEventListener('click', copySyncToken);
    ui.syncPeerCheck.addEventListener('click', checkSyncPeer);
    ui.syncRun.addEventListener('click', runDeviceSync);

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
    ui.lightboxImage.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleLightboxZoom();
    });
    ui.lightboxImage.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      toggleLightboxZoom();
    });
    ui.lightboxVisual.addEventListener('click', (event) => {
      if (event.target === ui.lightboxVisual && ui.lightbox.classList.contains('is-zoom')) {
        closeLightbox();
      }
    });
    ui.lightbox.addEventListener('click', (event) => {
      if (event.target === ui.lightbox) closeLightbox();
    });
    ui.lightbox.addEventListener('cancel', (event) => {
      if (!ui.lightbox.classList.contains('is-zoom')) return;
      event.preventDefault();
      setLightboxZoom(false);
    });
    ui.lightbox.addEventListener('close', () => {
      setLightboxZoom(false);
      state.activeItem = null;
    });

    // Mobile shell: bottom tabs, sheets and hash routing.
    for (const button of ui.mTabButtons) {
      button.addEventListener('click', () => setMobileTab(button.dataset.tab || 'gallery'));
    }
    ui.mAlbumBtn.addEventListener('click', openMobileAlbumSheet);
    ui.mViewBtn.addEventListener('click', toggleGalleryView);
    ui.mMoreBtn.addEventListener('click', () => {
      renderMobileActions();
      openMobileSheet(ui.mActionsSheet, ui.mMoreBtn);
    });
    ui.mOpenSettings.addEventListener('click', () => setMobileTab('settings'));
    ui.mQueueGo.addEventListener('click', () => setMobileTab('generate'));
    ui.mQueueCancelAll.addEventListener('click', cancelAllQueuedJobs);
    ui.mAlbumSheetClose.addEventListener('click', () => closeMobileSheet(ui.mAlbumSheet));
    ui.mActionsClose.addEventListener('click', () => closeMobileSheet(ui.mActionsSheet));
    ui.mAlbumSheet.addEventListener('click', (event) => {
      if (event.target === ui.mAlbumSheet) closeMobileSheet(ui.mAlbumSheet);
    });
    ui.mActionsSheet.addEventListener('click', (event) => {
      if (event.target === ui.mActionsSheet) closeMobileSheet(ui.mActionsSheet);
    });
    ui.mAlbumSheet.addEventListener('close', () => {
      ui.mAlbumBtn.setAttribute('aria-expanded', 'false');
    });
    ui.mActionsSheet.addEventListener('close', () => {
      ui.mMoreBtn.setAttribute('aria-expanded', 'false');
    });
    ui.mActionsSheet.querySelectorAll('[data-m-action]').forEach((button) => {
      button.addEventListener('click', () => runMobileAction(button.dataset.mAction || ''));
    });
    ui.mAlbumNew.addEventListener('click', () => {
      closeMobileSheet(ui.mAlbumSheet);
      handleCreateAlbum();
    });
    ui.mAlbumRename.addEventListener('click', () => {
      closeMobileSheet(ui.mAlbumSheet);
      handleRenameAlbum();
    });
    ui.mAlbumDelete.addEventListener('click', () => {
      closeMobileSheet(ui.mAlbumSheet);
      handleDeleteAlbum();
    });
    window.addEventListener('hashchange', () => {
      if (!isMobileLayout()) return;
      const tab = mobileTabFromHash() || 'gallery';
      if (tab !== state.mobileTab) {
        setMobileTab(tab, { persist: false, syncHash: false });
      }
    });

    // Drawer / desktop rail.
    ui.sidebarToggle.addEventListener('click', () => {
      if (window.innerWidth > 900) {
        applySidebarCollapsed(!state.sidebarCollapsed, { persist: true });
      } else {
        setSidebar(true);
      }
    });
    ui.focusToggle.addEventListener('click', () => setFocusMode(!state.focusMode));
    ui.sidebarClose.addEventListener('click', () => {
      if (isMobileLayout()) setMobileTab('gallery');
      else setSidebar(false);
    });
    ui.sidebarBackdrop.addEventListener('click', () => {
      if (isMobileLayout()) setMobileTab('gallery');
      else setSidebar(false);
    });
    updateSidebarToggleLabel();

    window.addEventListener('resize', () => {
      if (window.innerWidth > 900 && ui.sidebar.classList.contains('is-open')) {
        setSidebar(false);
      }
      if (!isMobileLayout()) {
        closeMobileSheet(ui.mAlbumSheet);
        closeMobileSheet(ui.mActionsSheet);
      } else {
        updateMobileAlbumLabel();
      }
      updateSidebarToggleLabel();
      if (!state.galleryDensityManual) {
        applyGalleryDensity(defaultGalleryDensity());
      }
      updateComposerMetrics();
    });

    // Shortcuts.
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSave();
        return;
      }
      if (
        event.key === 'Escape' &&
        ui.lightbox.open &&
        ui.lightbox.classList.contains('is-zoom')
      ) {
        event.preventDefault();
        event.stopPropagation();
        setLightboxZoom(false);
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
        return;
      }
      if (event.key === 'Escape' && !ui.lightbox.open && state.focusMode) {
        setFocusMode(false);
        return;
      }
      if (event.key === 'Escape' && !ui.lightbox.open && state.composerExpanded) {
        setComposerExpanded(false);
        return;
      }
      if (event.key === 'Escape' && isMobileLayout() && state.mobileTab === 'settings') {
        setMobileTab('gallery');
      }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Boot                                                                   */
  /* ---------------------------------------------------------------------- */

  async function init() {
    cacheElements();
    initMobileTab();
    initLayoutPreferences();
    setModelSuggestions(MODEL_SUGGESTIONS);
    renderPromptBlocks();
    renderPresetSelect();
    renderNaiPresetSelect();
    bindEvents();
    syncRangeDisplays();
    updateResolutionPreset();

    const [
      configResult,
      historyResult,
      recordsResult,
      albumsResult,
      trashResult,
      promptsResult,
      jobsResult,
    ] = await Promise.allSettled([
      loadConfig(),
      loadHistory(),
      loadRecords(),
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
