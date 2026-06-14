// ===== AI 网页分析助手 - Content Script =====
// Page source analysis, data extraction, and automation

(function () {
  'use strict';

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message?.action) return false;

    switch (message.action) {
      case 'ping':
        sendResponse({ ok: true });
        return false;

      case 'run':
        handleRun(message.payload).then(sendResponse).catch(e => sendResponse({ error: e.message }));
        return true;

      // Ignore other messages (e.g. element picker commands)
      default:
        return false;
    }
  });

  async function handleRun({ fn, args }) {
    switch (fn) {

      // ===== PAGE SOURCE ANALYSIS =====

      case 'getSource': {
        // Return a structured view of the page source for AI analysis
        const result = {
          url: location.href,
          title: document.title,
          docType: document.doctype ? `<!DOCTYPE ${document.doctype.name}>` : '',
          meta: {},
          scripts: [],
          styles: [],
          headings: [],
          links: [],
          forms: [],
          tables: [],
          lists: [],
          bodyText: '',
          bodyHTML: ''
        };

        // Meta tags
        document.querySelectorAll('meta[name], meta[property]').forEach(m => {
          const key = m.getAttribute('name') || m.getAttribute('property');
          const val = m.getAttribute('content');
          if (key && val) result.meta[key] = val.slice(0, 300);
        });

        // Script sources
        document.querySelectorAll('script[src]').forEach(s => {
          result.scripts.push(s.getAttribute('src'));
        });

        // Stylesheet links
        document.querySelectorAll('link[rel="stylesheet"]').forEach(l => {
          result.styles.push(l.getAttribute('href'));
        });

        // Heading structure
        document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
          result.headings.push({
            tag: h.tagName.toLowerCase(),
            text: h.textContent.trim().slice(0, 200)
          });
        });

        // Links (important ones)
        document.querySelectorAll('a[href]').forEach(a => {
          const href = a.getAttribute('href');
          const text = a.textContent.trim().slice(0, 100);
          if (href && !href.startsWith('#') && text) {
            result.links.push({ href: href.slice(0, 300), text });
            if (result.links.length >= 50) return; // Limit
          }
        });

        // Forms
        document.querySelectorAll('form').forEach(form => {
          const inputs = [];
          form.querySelectorAll('input, select, textarea, button').forEach(el => {
            inputs.push({
              tag: el.tagName.toLowerCase(),
              type: el.getAttribute('type') || '',
              name: el.getAttribute('name') || '',
              id: el.id || '',
              placeholder: el.getAttribute('placeholder') || '',
              text: el.textContent?.trim().slice(0, 100) || ''
            });
          });
          if (inputs.length) {
            result.forms.push({
              action: form.getAttribute('action') || '',
              method: form.getAttribute('method') || 'get',
              inputs
            });
          }
        });

        // Tables (summary)
        document.querySelectorAll('table').forEach(table => {
          const headers = [];
          table.querySelectorAll('th').forEach(th => headers.push(th.textContent.trim().slice(0, 100)));
          const rowCount = table.querySelectorAll('tr').length;
          result.tables.push({
            caption: table.querySelector('caption')?.textContent?.trim() || '',
            headers: headers.slice(0, 10),
            rowCount,
            preview: table.textContent.trim().slice(0, 500)
          });
          if (result.tables.length >= 5) return;
        });

        // Lists
        document.querySelectorAll('ul, ol').forEach(list => {
          const items = [];
          list.querySelectorAll(':scope > li').forEach(li => {
            items.push(li.textContent.trim().slice(0, 200));
            if (items.length >= 20) return;
          });
          if (items.length) {
            result.lists.push({
              type: list.tagName.toLowerCase(),
              count: items.length,
              items: items.slice(0, 20)
            });
          }
          if (result.lists.length >= 5) return;
        });

        // Full body HTML (trimmed)
        const html = document.documentElement.outerHTML;
        result.bodyHTML = html.slice(0, args?.maxHTML || 15000);
        result.htmlSize = html.length;

        // Visible text
        result.bodyText = (document.body?.innerText || '').slice(0, args?.maxText || 8000);
        result.textSize = (document.body?.innerText || '').length;

        return result;
      }

      // ===== EXTRACT BY SELECTOR =====

      case 'extract': {
        const selector = args?.selector;
        if (!selector) throw new Error('请提供 CSS 选择器');

        const elements = document.querySelectorAll(selector);
        const results = [];

        elements.forEach(el => {
          const item = {
            tag: el.tagName.toLowerCase(),
            text: el.textContent.trim().slice(0, 1000),
            html: el.outerHTML.slice(0, 2000)
          };

          // Attributes
          item.id = el.id || '';
          item.className = (typeof el.className === 'string') ? el.className : '';
          item.href = el.getAttribute('href') || '';
          item.src = el.getAttribute('src') || '';

          // Link-specific
          if (el.tagName === 'A') {
            item.linkText = el.textContent.trim().slice(0, 200);
            item.linkHref = el.getAttribute('href') || '';
          }

          // Image-specific
          if (el.tagName === 'IMG') {
            item.imgSrc = el.getAttribute('src') || '';
            item.imgAlt = el.getAttribute('alt') || '';
          }

          results.push(item);
          if (results.length >= (args?.limit || 50)) return;
        });

        return {
          selector,
          count: elements.length,
          returned: results.length,
          items: results
        };
      }

      // ===== GET ELEMENT INFO (by selector) =====

      case 'getElement': {
        const selector = args?.selector;
        if (!selector) throw new Error('请提供 CSS 选择器');

        const el = document.querySelector(selector);
        if (!el) return { found: false, selector };

        const rect = el.getBoundingClientRect();
        const styles = window.getComputedStyle(el);

        return {
          found: true,
          selector,
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          className: (typeof el.className === 'string') ? el.className : '',
          textContent: el.textContent.trim().slice(0, 1000),
          innerHTML: el.innerHTML.slice(0, 3000),
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          visible: styles.display !== 'none' && styles.visibility !== 'hidden',
          attributes: Array.from(el.attributes || []).reduce((acc, attr) => {
            if (!['style', 'class', 'id'].includes(attr.name)) {
              acc[attr.name] = attr.value?.slice(0, 200);
            }
            return acc;
          }, {})
        };
      }

      // ===== AUTOMATION =====

      case 'click': {
        const selector = args?.selector;
        if (!selector) throw new Error('请提供元素选择器');

        const el = document.querySelector(selector);
        if (!el) throw new Error(`未找到元素: ${selector}`);

        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);
        el.click();

        return { clicked: true, selector, tag: el.tagName.toLowerCase(), text: el.textContent.trim().slice(0, 100) };
      }

      case 'fill': {
        const { selector, value } = args || {};
        if (!selector || value === undefined) throw new Error('请提供选择器和填写内容');

        const el = document.querySelector(selector);
        if (!el) throw new Error(`未找到元素: ${selector}`);

        const tag = el.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea') {
          el.focus();
          el.value = '';
          // Simulate typing for reactive frameworks
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          )?.set || Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
          )?.set;

          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(el, value);
          } else {
            el.value = value;
          }

          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (tag === 'select') {
          el.value = value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          el.textContent = value;
        }

        return { filled: true, selector, value };
      }

      case 'scroll': {
        const selector = args?.selector;
        if (selector) {
          const el = document.querySelector(selector);
          if (!el) throw new Error(`未找到元素: ${selector}`);
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return { scrolled: true, selector };
        } else {
          const pos = args?.position || 'top';
          window.scrollTo({ top: pos === 'bottom' ? document.body.scrollHeight : 0, behavior: 'smooth' });
          return { scrolled: true, position: pos };
        }
      }

      case 'highlight': {
        const selector = args?.selector;
        if (!selector) throw new Error('请提供选择器');

        const elements = document.querySelectorAll(selector);
        if (!elements.length) throw new Error(`未找到元素: ${selector}`);

        // Flash highlight
        elements.forEach(el => {
          const orig = el.style.outline;
          el.style.outline = '3px solid #6366f1';
          el.style.outlineOffset = '2px';
          el.style.backgroundColor = 'rgba(99, 102, 241, 0.1)';
          setTimeout(() => {
            el.style.outline = orig;
            el.style.backgroundColor = '';
          }, 2000);
        });

        return { highlighted: true, selector, count: elements.length };
      }

      default:
        throw new Error(`Unknown function: ${fn}`);
    }
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
})();
