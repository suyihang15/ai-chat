// ===== AI 智能对话助手 - Side Panel Controller =====
// Multi-provider chat + page analysis + automation

const App = {
  client: null,
  abort: null,
  streaming: false,
  messages: [],
  pendingPickerResolve: null,

  // ==================== INIT ====================

  async init() {
    this.els = {
      messages: document.getElementById('chat-messages'),
      input: document.getElementById('chat-input'),
      send: document.getElementById('btn-send'),
      stop: document.getElementById('btn-stop'),
      typing: document.getElementById('typing-indicator'),
      badge: document.getElementById('model-badge'),
      dot: document.getElementById('status-dot')
    };

    await this.loadConfig();
    this.restoreHistory();
    this.bindEvents();
    this.bindMessageListener();
  },

  // ==================== CONFIG ====================

  async loadConfig() {
    try {
      const cfg = await StorageManager.getActiveConfig();
      if (cfg.apiKey) {
        this.client = createAPIClient(cfg);
        this.els.badge.textContent = `${cfg.providerIcon} ${cfg.providerName} · ${cfg.model}`;
        this.els.dot.className = 'dot connected';
      } else {
        this.client = null;
        this.els.badge.textContent = `未配置 API Key`;
        this.els.dot.className = 'dot disconnected';
      }
    } catch (e) {
      this.client = null;
      this.els.badge.textContent = 'Key 无效';
      this.els.dot.className = 'dot disconnected';
    }
  },

  // ==================== HISTORY ====================

  async restoreHistory() {
    this.messages = await StorageManager.getConversation();
    if (this.messages.length) {
      this.els.messages.innerHTML = '';
      this.messages.forEach(m => this.renderMessage(m));
      this.scrollBottom();
    }
  },

  async saveHistory() {
    await StorageManager.saveConversation(this.messages);
  },

  // ==================== EVENTS ====================

  bindEvents() {
    this.els.send.addEventListener('click', () => this.send());
    this.els.stop.addEventListener('click', () => this.cancel());
    this.els.input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); this.send(); }
      if (e.key === 'Escape' && this.streaming) this.cancel();
    });
    this.els.input.addEventListener('input', () => {
      this.els.input.style.height = 'auto';
      this.els.input.style.height = Math.min(this.els.input.scrollHeight, 120) + 'px';
    });

    document.getElementById('btn-new-chat').addEventListener('click', () => this.newChat());
    document.getElementById('btn-settings').addEventListener('click', () => this.toggleFlyout(true));
    document.getElementById('btn-flyout-close').addEventListener('click', () => this.toggleFlyout(false));
    document.getElementById('flyout-overlay').addEventListener('click', () => this.toggleFlyout(false));

    document.getElementById('btn-flyout-save').addEventListener('click', () => this.saveSettings());
    document.getElementById('btn-flyout-test').addEventListener('click', () => this.testConnection());
    document.getElementById('btn-toggle-key').addEventListener('click', () => this.toggleKeyVisibility());
    document.getElementById('flyout-temp').addEventListener('input', function () {
      document.getElementById('flyout-temp-val').textContent = parseFloat(this.value).toFixed(1);
    });

    // Provider chips
    document.querySelectorAll('.provider-chip').forEach(chip => {
      chip.addEventListener('click', () => this.selectProvider(chip.dataset.provider));
    });

    // Quick action buttons
    document.querySelectorAll('.action-btn[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'analyze') this.analyzePage();
        else if (action === 'extract') this.promptExtract();
        else if (action === 'picker') this.togglePicker(btn);
      });
    });
  },

  bindMessageListener() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'element_selected' && msg.payload) {
        this.onElementSelected(msg.payload);
      }
    });
  },

  // ==================== SEND / CHAT ====================

  async send() {
    if (this.streaming) return;
    const text = this.els.input.value.trim();
    if (!text) return;

    this.els.input.value = '';
    this.els.input.style.height = 'auto';

    // Ensure client
    if (!this.client) {
      await this.loadConfig();
      if (!this.client) {
        this.addMessage('system', '⚠️ 请先配置 API Key（点击右上角 ⚙️）');
        return;
      }
    }

    // Add user message
    this.addMessage('user', text);

    // Check for automation commands
    const cmd = this.parseCommand(text);
    if (cmd) {
      await this.executeCommand(cmd);
      return;
    }

    // Normal chat - include page context if available
    let systemMsg = null;
    try {
      const src = await this.callContent('getSource', { maxHTML: 8000, maxText: 4000 });
      if (src) {
        systemMsg = `[当前页面: ${src.title}](${src.url})\n页面包含 ${src.headings.length} 个标题, ${src.links.length} 个链接, ${src.tables.length} 个表格, ${src.forms.length} 个表单, ${src.lists.length} 个列表。\nAI 可执行的操作：click(selector), fill(selector,value), scroll(selector|position), extract(selector), highlight(selector)。`;
      }
    } catch (e) { /* no page access */ }

    // Build API messages
    const apiMsgs = [];
    if (systemMsg) apiMsgs.push({ role: 'system', content: `你是网页分析助手。${systemMsg}` });
    // Add recent conversation
    const recent = this.messages.slice(-20).map(m => ({ role: m.role, content: m.content }));
    apiMsgs.push(...recent);

    await this.streamResponse(apiMsgs);
  },

  parseCommand(text) {
    const t = text.trim();
    const clickMatch = t.match(/^click\s*[\(\（]\s*["'](.+?)["']\s*[\)\）]/i);
    if (clickMatch) return { type: 'click', selector: clickMatch[1] };

    const fillMatch = t.match(/^fill\s*[\(\（]\s*["'](.+?)["']\s*,\s*["'](.*?)["']\s*[\)\）]/i);
    if (fillMatch) return { type: 'fill', selector: fillMatch[1], value: fillMatch[2] };

    const scrollMatch = t.match(/^scroll\s*[\(\（]\s*["']?(.+?)["']?\s*[\)\）]/i);
    if (scrollMatch) return { type: 'scroll', target: scrollMatch[1] };

    const extractMatch = t.match(/^extract\s*[\(\（]\s*["'](.+?)["']\s*[\)\）]/i);
    if (extractMatch) return { type: 'extract', selector: extractMatch[1] };

    const highlightMatch = t.match(/^highlight\s*[\(\（]\s*["'](.+?)["']\s*[\)\）]/i);
    if (highlightMatch) return { type: 'highlight', selector: highlightMatch[1] };

    const getMatch = t.match(/^get\s*[\(\（]\s*["'](.+?)["']\s*[\)\）]/i);
    if (getMatch) return { type: 'getElement', selector: getMatch[1] };

    return null;
  },

  async executeCommand(cmd) {
    let result;
    try {
      switch (cmd.type) {
        case 'click':
          result = await this.callContent('click', { selector: cmd.selector });
          this.addMessage('system', `✅ 已点击: \`${cmd.selector}\` → ${result.text || result.tag}`);
          break;
        case 'fill':
          result = await this.callContent('fill', { selector: cmd.selector, value: cmd.value });
          this.addMessage('system', `✅ 已填写: \`${cmd.selector}\` = "${cmd.value}"`);
          break;
        case 'scroll':
          if (cmd.target === 'top' || cmd.target === 'bottom') {
            result = await this.callContent('scroll', { position: cmd.target });
          } else {
            result = await this.callContent('scroll', { selector: cmd.target });
          }
          this.addMessage('system', `✅ 已滚动到: ${cmd.target}`);
          break;
        case 'extract':
          result = await this.callContent('extract', { selector: cmd.selector, limit: 20 });
          this.addMessage('assistant', this.formatExtractResult(result));
          this.messages[this.messages.length - 1].isRendered = true;
          break;
        case 'highlight':
          result = await this.callContent('highlight', { selector: cmd.selector });
          this.addMessage('system', `✅ 已高亮 ${result.count} 个元素: \`${cmd.selector}\``);
          break;
        case 'getElement':
          result = await this.callContent('getElement', { selector: cmd.selector });
          if (result.found) {
            this.addMessage('assistant', this.formatElementInfo(result));
            this.messages[this.messages.length - 1].isRendered = true;
          } else {
            this.addMessage('system', `❌ 未找到: \`${cmd.selector}\``);
          }
          break;
      }
    } catch (e) {
      this.addMessage('system', `❌ ${e.message}`);
    }
    await this.saveHistory();
  },

  async streamResponse(apiMsgs) {
    this.setStreaming(true);
    this.abort = new AbortController();

    const { el, msgObj } = this.addStreamingMessage();

    let full = '', thinking = '';

    try {
      await this.client.chat(apiMsgs, {
        signal: this.abort.signal,
        onChunk: (delta, fullContent, thinkingContent) => {
          full = fullContent;
          thinking = thinkingContent;
          this.updateStreaming(el, full, thinking);
        },
        onComplete: (result) => {
          this.finalizeStream(el, result.content, result.thinking);
          this.setStreaming(false);
          this.saveHistory();
        }
      });
    } catch (e) {
      if (e.name === 'AbortError') {
        if (full) { this.finalizeStream(el, full, thinking); this.addMessage('system', '⏹ 已停止'); }
        else { el.parentElement?.remove(); this.messages.pop(); }
      } else {
        el.parentElement?.remove();
        this.messages.pop();
        this.addMessage('system', `❌ ${e.status === 401 ? 'API Key 无效' : e.status === 403 ? '权限不足' : e.status === 429 ? '请求太频繁，稍后再试' : e.message}`);
      }
      this.setStreaming(false);
      await this.saveHistory();
    }
  },

  // ==================== QUICK ACTIONS ====================

  async analyzePage() {
    if (this.streaming) return;
    if (!this.client) { this.addMessage('system', '⚠️ 请先配置 API Key'); return; }

    this.addMessage('user', '📊 分析当前页面源码');
    this.addMessage('system', '⏳ 正在获取页面源码...');

    try {
      const src = await this.callContent('getSource', { maxHTML: 15000, maxText: 6000 });
      this.els.messages.lastElementChild.remove();
      this.messages.pop();

      const prompt = `请分析以下网页源码结构，告诉我：

1. **页面概述**：这是什么类型的页面？主要内容是什么？
2. **可抓取数据**：有哪些有价值的数据可以提取？（表格、列表、链接等）
3. **关键元素**：列出重要的 CSS 选择器和 XPath，方便后续提取
4. **推荐抓取方案**：用哪些选择器可以批量获取数据？

${src.htmlSize > 15000 ? '⚠️ HTML 已截断到 15000 字符' : ''}

页面 URL: ${src.url}
页面标题: ${src.title}
Meta: ${JSON.stringify(src.meta)}
标题结构: ${JSON.stringify(src.headings.slice(0, 30))}
表格: ${src.tables.length} 个 (${src.tables.map(t => `${t.rowCount}行`).join(', ')})
表单: ${src.forms.length} 个
列表: ${src.lists.length} 个 (${src.lists.map(l => l.count).join(', ')} 项)
链接: ${src.links.length} 个

HTML源码:
\`\`\`html
${src.bodyHTML}
\`\`\`

可见文本 (前6000字):
${src.bodyText}`;

      const apiMsgs = [
        { role: 'system', content: '你是网页结构分析专家。用中文回复，给出具体的 CSS 选择器和抓取方案。回复要结构化、可操作。' },
        { role: 'user', content: prompt }
      ];

      await this.streamResponse(apiMsgs);
    } catch (e) {
      this.addMessage('system', `❌ 获取页面源码失败: ${e.message}`);
    }
  },

  async promptExtract() {
    if (this.streaming) return;
    this.addMessage('system', '💡 请在聊天框输入提取指令，例如：\n• `extract("a")` — 提取所有链接\n• `extract("img")` — 提取所有图片\n• `extract(".product-card")` — 提取指定元素\n\n也可以用自然语言描述你想提取什么，AI 会帮你构造选择器。');
  },

  async togglePicker(btn) {
    if (btn.classList.contains('active')) {
      await chrome.runtime.sendMessage({ action: 'deactivate_picker' });
      btn.classList.remove('active');
      btn.textContent = '🖱 选择元素';
      this.addMessage('system', '已退出元素选择模式');
    } else {
      try {
        await chrome.runtime.sendMessage({ action: 'activate_picker' });
        btn.classList.add('active');
        btn.textContent = '🔴 取消选择';
        this.addMessage('system', '🖱 在页面上移动鼠标高亮元素，点击选择，按 Esc 退出');
      } catch (e) {
        this.addMessage('system', `❌ 无法激活选择器: ${e.message}`);
      }
    }
  },

  async onElementSelected(payload) {
    const { elementInfo, url, pageTitle } = payload;
    this.addMessage('system', `🎯 已选择: \`<${elementInfo.tagName}>\` ${elementInfo.id ? '#' + elementInfo.id : ''} ${elementInfo.className ? '.' + elementInfo.className.split(/\s+/).slice(0, 2).join('.') : ''}`);
    this.addMessage('assistant', this.formatElementInfo(elementInfo));
    this.messages[this.messages.length - 1].isRendered = true;
    await this.saveHistory();

    const btn = document.querySelector('[data-action="picker"]');
    if (btn) { btn.classList.remove('active'); btn.textContent = '🖱 选择元素'; }
  },

  // ==================== CONTENT SCRIPT HELPERS ====================

  async callContent(fn, args = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'inject_and_run',
        payload: { fn, args }
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) reject(new Error(response.error));
        else resolve(response || {});
      });
    });
  },

  // ==================== MESSAGE RENDERING ====================

  addMessage(role, content) {
    const msg = { role, content, ts: Date.now() };
    this.messages.push(msg);
    this.renderMessage(msg);
    this.scrollBottom();
  },

  renderMessage(msg) {
    if (msg.isRendered) return;

    const div = document.createElement('div');
    div.className = `message ${msg.role === 'system' ? 'system-message' : msg.role}`;

    const content = document.createElement('div');
    content.className = 'message-content';

    if (msg.role === 'assistant' || msg.role === 'system') {
      content.innerHTML = this.renderMarkdown(msg.content);
      this.addCopyButtons(content);
    } else {
      content.textContent = msg.content;
    }

    div.appendChild(content);
    this.els.messages.appendChild(div);
    msg._el = div;
    msg._content = content;
  },

  addStreamingMessage() {
    const msg = { role: 'assistant', content: '', ts: Date.now(), isStreaming: true };
    this.messages.push(msg);

    const div = document.createElement('div');
    div.className = 'message assistant';
    const content = document.createElement('div');
    content.className = 'message-content';
    div.appendChild(content);
    this.els.messages.appendChild(div);
    this.scrollBottom();

    msg._el = div;
    msg._content = content;
    return { el: content, msgObj: msg };
  },

  updateStreaming(el, fullText, thinkingText) {
    let display = fullText;
    if (thinkingText) display = `<details><summary>💭 思考中...</summary><div class="thinking">${this.escapeHtml(thinkingText)}</div></details>\n\n${fullText}`;
    el.innerHTML = this.renderMarkdown(display);
    this.scrollBottom();
  },

  finalizeStream(el, fullText, thinkingText) {
    let display = fullText;
    if (thinkingText) display = `<details><summary>💭 思考过程</summary><div class="thinking">${this.escapeHtml(thinkingText)}</div></details>\n\n${fullText}`;
    el.innerHTML = this.renderMarkdown(display);
    this.addCopyButtons(el);

    const msg = this.messages[this.messages.length - 1];
    if (msg) { msg.content = fullText; msg.thinking = thinkingText; msg.isStreaming = false; }
  },

  // ==================== MARKDOWN ====================

  renderMarkdown(text) {
    if (!text) return '';
    try {
      let html;
      if (typeof marked !== 'undefined') {
        html = marked.parse(text, { breaks: true, gfm: true });
      } else {
        html = this.escapeHtml(text).replace(/\n/g, '<br>');
      }
      if (typeof DOMPurify !== 'undefined') {
        html = DOMPurify.sanitize(html, {
          ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','hr','ul','ol','li','strong','em','del','a','img','pre','code','blockquote','table','thead','tbody','tr','th','td','details','summary','span','div','input'],
          ALLOWED_ATTR: ['href','src','alt','title','class','target','rel','type','checked','style']
        });
      }
      return html;
    } catch (e) {
      return this.escapeHtml(text).replace(/\n/g, '<br>');
    }
  },

  addCopyButtons(parent) {
    parent.querySelectorAll('pre').forEach(pre => {
      if (pre.querySelector('.copy-btn')) return;
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = '📋 复制';
      btn.addEventListener('click', () => {
        const code = pre.querySelector('code')?.textContent || pre.textContent;
        navigator.clipboard.writeText(code).then(() => {
          btn.textContent = '✅ 已复制';
          setTimeout(() => { btn.textContent = '📋 复制'; }, 2000);
        });
      });
      pre.appendChild(btn);
    });
  },

  // ==================== FORMATTERS ====================

  formatExtractResult(result) {
    let md = `### 🎯 提取结果: \`${result.selector}\`\n`;
    md += `共找到 **${result.count}** 个元素，返回 ${result.returned} 个：\n\n`;

    result.items?.forEach((item, i) => {
      md += `**${i + 1}.** \`<${item.tag}>\``;
      if (item.id) md += ` #${item.id}`;
      if (item.className) md += ` .${item.className.split(/\s+/).slice(0, 2).join('.')}`;
      if (item.href) md += ` → ${item.href.slice(0, 80)}`;
      if (item.src) md += ` → ${item.src.slice(0, 80)}`;
      md += '\n';
      if (item.text && item.text.length < 200) md += `   ${item.text}\n`;
      else if (item.text) md += `   ${item.text.slice(0, 200)}...\n`;
    });

    return md;
  },

  formatElementInfo(info) {
    let md = `### 🎯 元素分析\n\n`;
    md += `| 属性 | 值 |\n|---|---|\n`;
    md += `| 标签 | \`<${info.tag || info.tagName}>\` |\n`;
    if (info.id) md += `| ID | \`#${info.id}\` |\n`;
    if (info.className) md += `| Class | \`${info.className}\` |\n`;
    if (info.selector) md += `| Selector | \`${info.selector}\` |\n`;
    if (info.rect) md += `| 位置 | top:${Math.round(info.rect.top)} left:${Math.round(info.rect.left)} ${Math.round(info.rect.width)}×${Math.round(info.rect.height)} |\n`;
    if (info.visible !== undefined) md += `| 可见 | ${info.visible ? '✅ 是' : '❌ 否'} |\n`;
    if (info.attributes && Object.keys(info.attributes).length) {
      Object.entries(info.attributes).slice(0, 10).forEach(([k, v]) => {
        md += `| ${k} | \`${v}\` |\n`;
      });
    }
    if (info.textContent) {
      md += `\n**文本内容:**\n\`\`\`\n${info.textContent.slice(0, 1000)}\n\`\`\`\n`;
    }
    if (info.innerHTML && info.innerHTML.length < 2000) {
      md += `\n<details><summary>📄 HTML (${info.innerHTML.length} 字符)</summary>\n\n\`\`\`html\n${info.innerHTML}\n\`\`\`\n</details>\n`;
    }
    return md;
  },

  // ==================== SETTINGS FLYOUT ====================

  _flyoutProvider: null,  // currently selected provider in flyout
  _flyoutConfigs: {},     // in-progress configs for all providers

  async toggleFlyout(show) {
    const flyout = document.getElementById('settings-flyout');
    const overlay = document.getElementById('flyout-overlay');
    if (show) {
      const s = await StorageManager.getSettings();
      // Deep-clone provider configs for editing
      this._flyoutConfigs = JSON.parse(JSON.stringify(s.providers));
      this._flyoutProvider = s.activeProvider;

      // Highlight active provider chip
      document.querySelectorAll('.provider-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.provider === s.activeProvider);
      });

      // Load active provider's config into form
      this._renderProviderForm(s.activeProvider);
      document.getElementById('flyout-status').textContent = '';
      flyout.classList.remove('hidden');
      overlay.classList.remove('hidden');
    } else {
      flyout.classList.add('hidden');
      overlay.classList.add('hidden');
    }
  },

  selectProvider(pid) {
    if (!pid || !StorageManager.PROVIDERS[pid]) return;

    // Save current form to _flyoutConfigs
    this._saveFormToConfig(this._flyoutProvider);

    this._flyoutProvider = pid;

    // Update chip highlights
    document.querySelectorAll('.provider-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.provider === pid);
    });

    // Render the selected provider's form
    this._renderProviderForm(pid);
  },

  _renderProviderForm(pid) {
    const def = StorageManager.PROVIDERS[pid] || StorageManager.PROVIDERS['custom'];
    const cfg = this._flyoutConfigs[pid] || {};

    // Update key label
    document.getElementById('flyout-key-label').textContent = `API Key (${def.name})`;
    document.getElementById('flyout-apikey').value = cfg.apiKey || '';
    document.getElementById('flyout-apikey').type = 'password';
    document.getElementById('btn-toggle-key').textContent = '👁';

    // Update key URL hint
    const keyUrl = document.getElementById('flyout-key-url');
    if (def.keyUrl) {
      keyUrl.href = def.keyUrl;
      keyUrl.textContent = `获取 ${def.name} API Key →`;
      keyUrl.style.display = '';
    } else {
      keyUrl.style.display = 'none';
    }

    // Base URL
    document.getElementById('flyout-baseurl').value = cfg.baseURL || def.baseURL || '';

    // Model datalist
    const modelInput = document.getElementById('flyout-model');
    const datalist = document.getElementById('flyout-model-list');
    datalist.innerHTML = '';
    if (def.models && def.models.length) {
      def.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        datalist.appendChild(opt);
      });
    }
    modelInput.value = cfg.model || def.models?.[0] || '';

    // Temperature
    document.getElementById('flyout-temp').value = cfg.temperature ?? 0.7;
    document.getElementById('flyout-temp-val').textContent = (cfg.temperature ?? 0.7).toFixed(1);

    document.getElementById('flyout-status').textContent = '';
  },

  _saveFormToConfig(pid) {
    if (!pid || !this._flyoutConfigs[pid]) return;
    this._flyoutConfigs[pid] = {
      apiKey: document.getElementById('flyout-apikey').value.trim(),
      baseURL: document.getElementById('flyout-baseurl').value.trim(),
      model: document.getElementById('flyout-model').value.trim(),
      temperature: parseFloat(document.getElementById('flyout-temp').value)
    };
  },

  toggleKeyVisibility() {
    const input = document.getElementById('flyout-apikey');
    const btn = document.getElementById('btn-toggle-key');
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '🙈';
    } else {
      input.type = 'password';
      btn.textContent = '👁';
    }
  },

  async saveSettings() {
    // Save current form to config
    this._saveFormToConfig(this._flyoutProvider);

    await StorageManager.saveSettings({
      activeProvider: this._flyoutProvider,
      providers: this._flyoutConfigs
    });

    document.getElementById('flyout-status').innerHTML = '<span style="color:var(--success)">✅ 已保存</span>';
    await this.loadConfig();

    // Auto close after short delay
    setTimeout(() => this.toggleFlyout(false), 800);
  },

  async testConnection() {
    // Save current form first
    this._saveFormToConfig(this._flyoutProvider);

    const status = document.getElementById('flyout-status');
    status.textContent = '⏳ 测试连接中...';

    const pid = this._flyoutProvider;
    const def = StorageManager.PROVIDERS[pid] || StorageManager.PROVIDERS['custom'];
    const cfg = this._flyoutConfigs[pid] || {};

    const apiKey = cfg.apiKey;
    if (!apiKey) {
      status.innerHTML = '<span style="color:var(--error)">❌ 请输入 API Key</span>';
      return;
    }

    try {
      const testClient = createAPIClient({
        providerType: def.type,
        apiKey,
        baseURL: cfg.baseURL || def.baseURL,
        model: cfg.model || def.models[0] || 'gpt-4o',
        temperature: 0.7,
        maxTokens: 8192
      });
      await testClient.testConnection();
      status.innerHTML = '<span style="color:var(--success)">✅ 连接成功！</span>';
    } catch (e) {
      status.innerHTML = `<span style="color:var(--error)">❌ ${e.status === 401 ? 'API Key 无效' : e.status === 403 ? '权限不足' : e.message}</span>`;
    }
  },

  // ==================== UTILS ====================

  newChat() {
    if (this.streaming) this.cancel();
    this.messages = [];
    this.els.messages.innerHTML = '';
    StorageManager.clearConversation();
    const w = document.createElement('div');
    w.className = 'message system-message welcome';
    w.innerHTML = `<div class="message-content"><h2>👋 AI 智能对话助手</h2><p style="font-size:11px;color:var(--text3);margin-top:2px;">支持 DeepSeek · OpenAI · Claude · Gemini</p><p>新对话已开始，输入消息或选择操作。</p></div>`;
    this.els.messages.appendChild(w);
  },

  cancel() {
    if (this.abort) { this.abort.abort(); this.abort = null; }
  },

  setStreaming(on) {
    this.streaming = on;
    this.els.send.classList.toggle('hidden', on);
    this.els.stop.classList.toggle('hidden', !on);
    this.els.typing.classList.toggle('hidden', !on);
    this.els.dot.className = 'dot ' + (on ? 'streaming' : this.client ? 'connected' : 'disconnected');
  },

  scrollBottom() {
    requestAnimationFrame(() => {
      const c = document.getElementById('chat-container');
      if (c) c.scrollTop = c.scrollHeight;
    });
  },

  escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
