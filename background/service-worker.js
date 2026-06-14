// ===== AI 智能对话助手 - Service Worker =====
// Side panel lifecycle + message routing to content scripts

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

// Message routing: side panel <-> content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.action) return false;

  const { action, payload } = message;

  switch (action) {
    case 'inject_and_run':
      injectAndRun(payload).then(sendResponse).catch(e => sendResponse({ error: e.message }));
      return true;

    case 'activate_picker':
      injectPicker().then(sendResponse).catch(e => sendResponse({ error: e.message }));
      return true;

    case 'deactivate_picker':
      deactivatePicker().then(sendResponse).catch(e => sendResponse({ error: e.message }));
      return true;

    case 'element_selected':
      // Forward to side panel
      chrome.runtime.sendMessage({ action: 'element_selected', payload }).catch(() => {});
      sendResponse({ ok: true });
      return false;

    default:
      sendResponse({ error: `Unknown: ${action}` });
      return false;
  }
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab');
  return tab;
}

async function injectAndRun(payload) {
  const tab = await getActiveTab();
  const { fn, args } = payload;

  // Inject content script first if needed
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
  } catch (e) {
    // Content script not loaded yet, inject it
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/content.js']
    });
  }

  // Execute the requested function
  const result = await chrome.tabs.sendMessage(tab.id, { action: 'run', payload: { fn, args } });
  return result;
}

async function injectPicker() {
  const tab = await getActiveTab();
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content/element-picker.js']
  });
  const result = await chrome.tabs.sendMessage(tab.id, { action: 'activate_picker' });
  return result;
}

async function deactivatePicker() {
  const tab = await getActiveTab();
  try {
    return await chrome.tabs.sendMessage(tab.id, { action: 'deactivate_picker' });
  } catch (e) {
    return { ok: true };
  }
}
