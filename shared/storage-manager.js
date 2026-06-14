// ===== Storage Manager - Multi-Provider =====
// Manages API configs for multiple providers + conversation history

const PROVIDER_DEFS = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    type: 'openai',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    icon: '🧠'
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini', 'o1-mini'],
    type: 'openai',
    keyUrl: 'https://platform.openai.com/api-keys',
    icon: '🤖'
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    baseURL: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5', 'claude-sonnet-4-5'],
    type: 'anthropic',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    icon: '🧪'
  },
  google: {
    id: 'google',
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro'],
    type: 'google',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    icon: '💎'
  },
  custom: {
    id: 'custom',
    name: '自定义 (OpenAI 兼容)',
    baseURL: '',
    models: [],
    type: 'openai',
    keyUrl: '',
    icon: '🔧'
  }
};

const StorageManager = {
  PROVIDERS: PROVIDER_DEFS,

  DEFAULTS: {
    activeProvider: 'deepseek',
    maxHistory: 50,
    theme: 'auto'
  },

  _defaultProviderConfig(pid) {
    const def = PROVIDER_DEFS[pid] || PROVIDER_DEFS['custom'];
    return {
      apiKey: '',
      baseURL: def.baseURL,
      model: def.models[0] || '',
      temperature: 0.7,
      maxTokens: 8192
    };
  },

  // ---- Full settings ----

  async getSettings() {
    const data = await chrome.storage.local.get('settings');
    const raw = data.settings || {};
    const result = { ...this.DEFAULTS, ...raw };

    // Ensure every known provider has a config object
    if (!result.providers || typeof result.providers !== 'object') {
      result.providers = {};
    }
    for (const pid of Object.keys(PROVIDER_DEFS)) {
      if (!result.providers[pid]) {
        result.providers[pid] = this._defaultProviderConfig(pid);
      } else {
        const def = PROVIDER_DEFS[pid];
        const cur = result.providers[pid];
        if (!cur.baseURL && def.baseURL) cur.baseURL = def.baseURL;
        if (!cur.model && def.models[0]) cur.model = def.models[0];
        if (cur.temperature === undefined) cur.temperature = 0.7;
        if (!cur.maxTokens) cur.maxTokens = 8192;
        if (cur.apiKey === undefined) cur.apiKey = '';
      }
    }

    // Ensure activeProvider is valid
    if (!PROVIDER_DEFS[result.activeProvider]) {
      result.activeProvider = 'deepseek';
    }

    return result;
  },

  async saveSettings(partial) {
    const current = await this.getSettings();
    // Deep-merge providers
    if (partial.providers) {
      for (const pid of Object.keys(partial.providers)) {
        current.providers[pid] = {
          ...current.providers[pid],
          ...partial.providers[pid]
        };
      }
      delete partial.providers;
    }
    const merged = { ...current, ...partial };
    await chrome.storage.local.set({ settings: merged });
  },

  // ---- Convenience: active provider config ----

  async getActiveConfig() {
    const s = await this.getSettings();
    const pid = s.activeProvider;
    const def = PROVIDER_DEFS[pid] || PROVIDER_DEFS['custom'];
    const cfg = s.providers[pid] || this._defaultProviderConfig(pid);
    return {
      provider: pid,
      providerName: def.name,
      providerType: def.type,
      providerIcon: def.icon,
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL || def.baseURL,
      model: cfg.model || def.models[0] || '',
      temperature: cfg.temperature ?? 0.7,
      maxTokens: cfg.maxTokens || 8192
    };
  },

  async getApiKey() {
    const cfg = await this.getActiveConfig();
    return cfg.apiKey;
  },

  // ---- Conversation ----

  async getConversation() {
    const data = await chrome.storage.local.get('conversation');
    return data.conversation || [];
  },

  async saveConversation(messages) {
    const s = await this.getSettings();
    if (messages.length > s.maxHistory) {
      messages = messages.slice(-s.maxHistory);
    }
    await chrome.storage.local.set({ conversation: messages });
  },

  async clearConversation() {
    await chrome.storage.local.set({ conversation: [] });
  }
};
