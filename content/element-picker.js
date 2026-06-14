// ===== AI Chat Sidebar - Element Picker =====
// Visual element selection overlay for browser control
// Injected on demand by the service worker

(function () {
  'use strict';

  let overlay = null;
  let tooltip = null;
  let isActive = false;

  // Listen for messages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action } = message;

    switch (action) {
      case 'activate_picker':
        activate();
        sendResponse({ success: true, data: { active: true } });
        break;
      case 'deactivate_picker':
        deactivate();
        sendResponse({ success: true, data: { active: false } });
        break;
      // Ignore other messages (e.g. content script run commands)
      default:
        return false;
    }
  });

  function activate() {
    if (isActive) return;

    // Create overlay (transparent full-page layer to capture mouse events)
    overlay = document.createElement('div');
    overlay.id = '__ai_sidebar_picker_overlay__';
    overlay.style.cssText = `
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483646 !important;
      cursor: crosshair !important;
      background: transparent !important;
      pointer-events: all !important;
    `;

    // Create floating tooltip
    tooltip = document.createElement('div');
    tooltip.id = '__ai_sidebar_picker_tooltip__';
    tooltip.style.cssText = `
      position: fixed !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
      background: #1a1a2e !important;
      color: #e4e4e7 !important;
      padding: 6px 12px !important;
      border-radius: 6px !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 12px !important;
      line-height: 1.4 !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4) !important;
      border: 1px solid #6366f1 !important;
      display: none !important;
      max-width: 320px !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(tooltip);

    // Highlight element
    let highlightedElement = null;
    let originalOutline = '';

    overlay.addEventListener('mousemove', (e) => {
      // Hide overlay temporarily to get element underneath
      overlay.style.pointerEvents = 'none';
      const element = document.elementFromPoint(e.clientX, e.clientY);
      overlay.style.pointerEvents = 'all';

      if (!element || element === overlay || element === tooltip) return;

      // Unhighlight previous
      if (highlightedElement && highlightedElement !== element) {
        highlightedElement.style.outline = originalOutline;
      }

      // Highlight current
      if (highlightedElement !== element) {
        originalOutline = element.style.outline;
        element.style.outline = '2px solid #6366f1';
        element.style.outlineOffset = '1px';
        highlightedElement = element;
      }

      // Update tooltip
      const tagName = element.tagName.toLowerCase();
      const id = element.id ? `#${element.id}` : '';
      const className = element.className && typeof element.className === 'string'
        ? '.' + element.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
      const text = (element.textContent || '').trim().slice(0, 80);

      tooltip.innerHTML = `
        <strong style="color:#818cf8;">&lt;${tagName}${id}${className}&gt;</strong>
        ${text ? '<br><span style="color:#a1a1aa;">' + escapeHtml(text) + '</span>' : ''}
      `;
      tooltip.style.display = 'block';
      positionTooltip(tooltip, e.clientX, e.clientY);
    });

    overlay.addEventListener('click', (e) => {
      if (!highlightedElement) return;

      e.preventDefault();
      e.stopPropagation();

      const element = highlightedElement;

      // Build element info
      const info = {
        tagName: element.tagName.toLowerCase(),
        id: element.id || '',
        className: (typeof element.className === 'string') ? element.className.trim() : '',
        textContent: (element.textContent || '').trim().slice(0, 500),
        innerHTML: element.innerHTML.slice(0, 2000),
        selector: generateSelector(element),
        attributes: {},
        rect: element.getBoundingClientRect().toJSON()
      };

      // Collect attributes
      if (element.attributes) {
        for (const attr of element.attributes) {
          if (attr.name !== 'style' && attr.name !== 'class' && attr.name !== 'id') {
            info.attributes[attr.name] = attr.value?.slice(0, 200);
          }
        }
      }

      // Flash confirmation
      element.style.outline = '3px solid #22c55e';
      element.style.outlineOffset = '2px';
      setTimeout(() => {
        element.style.outline = originalOutline;
      }, 500);

      // Send data back
      chrome.runtime.sendMessage({
        action: 'element_selected',
        payload: {
          elementInfo: info,
          url: window.location.href,
          pageTitle: document.title
        }
      });

      // Deactivate
      deactivate();
    });

    // Escape to cancel
    document.addEventListener('keydown', handleKeyDown, true);

    isActive = true;
    console.log('[Element Picker] Activated');
  }

  function deactivate() {
    if (!isActive) return;

    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    if (tooltip) {
      tooltip.remove();
      tooltip = null;
    }

    document.removeEventListener('keydown', handleKeyDown, true);
    isActive = false;

    // Notify side panel
    chrome.runtime.sendMessage({
      action: 'picker_deactivated',
      payload: {}
    }).catch(() => {});

    console.log('[Element Picker] Deactivated');
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      deactivate();
    }
  }

  function positionTooltip(tooltip, mouseX, mouseY) {
    const padding = 15;
    let left = mouseX + padding;
    let top = mouseY + padding;

    const rect = tooltip.getBoundingClientRect();
    if (left + rect.width > window.innerWidth) {
      left = mouseX - rect.width - padding;
    }
    if (top + rect.height > window.innerHeight) {
      top = mouseY - rect.height - padding;
    }

    tooltip.style.left = Math.max(0, left) + 'px';
    tooltip.style.top = Math.max(0, top) + 'px';
  }

  function generateSelector(element) {
    if (!element || element === document.body || element === document.documentElement) {
      return element ? element.tagName.toLowerCase() : '';
    }
    if (element.id) return `#${CSS.escape(element.id)}`;

    const parts = [];
    let current = element;
    while (current && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();
      if (current.id) { parts.unshift(`#${CSS.escape(current.id)}`); break; }
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2);
        if (classes.length && classes[0]) selector += '.' + classes.map(c => CSS.escape(c)).join('.');
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
        if (siblings.length > 1) selector += `:nth-child(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(selector);
      current = current.parentElement;
      if (parts.length >= 5) break;
    }
    return parts.join(' > ');
  }

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

})();
