/**
 * Content Script - WhatsApp Web Injected Script
 *
 * Handles chat opening/search and message sending inside WhatsApp Web.
 * Chat opening and sending are deliberately separated so background
 * orchestration can survive page reloads.
 *
 * v1.1.0 — production build
 */

// Set to true only during local development
const DEBUG = false;

if (window.waBulkSenderInjected) {
  // Prevent multiple injections accumulating listeners
  console.log('[WAAutomation] Already injected, skipping.');
} else {
  window.waBulkSenderInjected = true;

  function dbg(...args) { if (DEBUG) console.log('[WAAutomation]', ...args); }


  const WASelectors = {
    // Compose
    messageInput: '[data-testid="conversation-compose-box-input"], div[role="textbox"][contenteditable="true"][aria-label*="Type a message"], div[role="textbox"][contenteditable="true"][data-tab="10"], footer [contenteditable="true"]',
    sendButton: '[data-testid="compose-btn-send"], footer button[aria-label="Send"], footer span[data-icon="send"]',

    // Attachments — selector order: testid first, then aria-label, avoid over-broad icons
    chatPanel: '#main',
    chatHeader: '[data-testid="conversation-header"], header.pane-chat-header',
    chatContactName: '[data-testid="conversation-info-header-chat-title"], #main header span[dir="auto"][title]',

    // State detection – fallbacks are critical for WA Business
    startupScreen: '[data-testid="startup"]',
    qrCode: '[data-testid="qrcode"], canvas[aria-label="Scan me!"], [data-ref]',
    invalidNumberPopup: '[data-testid="popup-contents"], [role="dialog"]',
    okButton: '[data-testid="popup-controls-ok"], [role="dialog"] button',

    // Side panel – CRITICAL: WA Web uses #side, WA Business uses #pane-side
    sidePanel: '#side, #pane-side',

    // Header actions (for injected button)
    headerActions: 'header [data-testid="chatlist-header-options-container"], header [aria-label="Chat list"] ~ div'
  };

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function waitForElement(selector, timeout = 10000, context = document) {
    return new Promise((resolve) => {
      const existing = context.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver(() => {
        const el = context.querySelector(selector);
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  async function waitForCondition(checkFn, timeout = 10000, interval = 200) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      // Guard: page may have navigated away mid-poll
      if (!document.body) return null;
      try {
        const result = checkFn();
        if (result) return result;
      } catch (e) {
        // DOM may be torn down during navigation — bail safely
        dbg('waitForCondition DOM error, stopping poll', e.message);
        return null;
      }
      await sleep(interval);
    }
    return null;
  }

  async function isWhatsAppReady() {
    // Check for QR code / login screen
    const qr = document.querySelector(WASelectors.qrCode);
    if (qr) {
      dbg('QR code detected – not ready');
      return false;
    }

    // Check for startup/loading screen
    const startup = document.querySelector(WASelectors.startupScreen);
    if (startup) {
      dbg('Startup screen detected – not ready');
      return false;
    }

    // Primary: check for the side panel (#side for WA Web, #pane-side for WA Business)
    const side = document.querySelector(WASelectors.sidePanel);
    if (side) return true;

    // Fallback: check for the #app container with chat panel rendered
    const app = document.getElementById('app');
    if (app) {
      const hasChatPanel = document.querySelector(WASelectors.chatPanel);
      if (hasChatPanel) return true;
    }

    dbg('No ready indicators found');
    return false;
  }

  function dismissInvalidNumberPopup() {
    // Try the specific data-testid popup first
    let popup = document.querySelector('[data-testid="popup-contents"]');
    let okBtn = null;

    if (popup) {
      okBtn = document.querySelector('[data-testid="popup-controls-ok"]');
    } else {
      // Fallback: check role="dialog" but ONLY if it contains error-related text
      const dialogs = document.querySelectorAll('[role="dialog"]');
      for (const dialog of dialogs) {
        const text = (dialog.textContent || '').toLowerCase();
        if (text.includes('invalid') || text.includes('phone number') || text.includes('not found') || text.includes("doesn't have")) {
          popup = dialog;
          okBtn = dialog.querySelector('button');
          break;
        }
      }
    }

    if (!popup) return null;

    const errorText = popup.textContent || 'Invalid number';
    if (okBtn) okBtn.click();

    return {
      success: false,
      invalidNumber: true,
      error: errorText.slice(0, 200)
    };
  }

  /**
   * Check if an element actually contains the expected text.
   * @param {Element} element
   * @param {string} expectedText
   * @returns {boolean}
   */
  /**
   * Set text in a contenteditable element reliably for WhatsApp Web.
   * @param {Element} element - The contenteditable element
   * @param {string} text - Text to set
   * @returns {Promise<boolean>} Whether text was successfully set
   */
  async function setInputText(element, text) {
    element.focus();

    // Clear any existing content first
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);

    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > 0) {
        document.execCommand('insertText', false, lines[i]);
      }
      if (i < lines.length - 1) {
        element.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true
        }));
      }
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    return !!(await waitForCondition(() => verifyInputHasText(element, text), 1500, 100));
  }

  async function simulateTyping(element, text, charDelay = 50) {
    element.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);

    for (const char of text) {
      if (char === '\n') {
        element.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true
        }));
      } else {
        document.execCommand('insertText', false, char);
      }
      element.dispatchEvent(new InputEvent('input', { bubbles: true }));
      const jitter = charDelay * 0.3;
      const delay = charDelay + (Math.random() * 2 - 1) * jitter;
      await sleep(Math.max(10, delay));
    }
  }

  async function handleOpenChat(_phone, _afterNavigation = false) {
    const result = await waitForCondition(() => {
      const invalid = dismissInvalidNumberPopup();
      if (invalid) return invalid;
      const input = document.querySelector(WASelectors.messageInput);
      if (!input) return null;
      const header = document.querySelector(WASelectors.chatContactName)?.textContent?.trim() || '';
      return { success: true, method: 'navigation', chatName: header || null };
    }, 15000, 300);

    if (!result) {
      return { success: false, error: 'Chat panel did not appear after navigation' };
    }
    return result;
  }

  async function sendTextMessage(message, humanTyping = false) {
    const input = await waitForElement(WASelectors.messageInput, 10000);
    if (!input) return { success: false, error: 'Message input not found' };

    input.click();
    input.focus();
    await sleep(300);

    if (humanTyping) {
      await simulateTyping(input, message, 40);
    } else {
      const insertSuccess = await setInputText(input, message);
      if (!insertSuccess) return { success: false, error: 'Message text could not be verified' };
    }

    const sendBtn = await waitForElement(WASelectors.sendButton, 8000);
    if (!sendBtn) return { success: false, error: 'Send button not found' };

    const clickTarget = sendBtn.closest('button') || sendBtn.closest('[role="button"]') || sendBtn;
    clickTarget.click();
    await sleep(1200);
    return { success: true };
  }

  function verifyInputHasText(element, expectedText) {
    const currentText = (element.textContent || element.innerText || '').trim();
    const currentHtml = (element.innerHTML || '').replace(/<[^>]+>/g, ' ').trim();
    const strippedExpected = expectedText.replace(/\s+/g, '').substring(0, 30);
    const strippedCurrent = currentText.replace(/\s+/g, '');
    const strippedHtml = currentHtml.replace(/\s+/g, '');
    const found = strippedCurrent.includes(strippedExpected) || strippedHtml.includes(strippedExpected);
    if (!found) {
      dbg('verifyInputHasText check:', {
        expected: strippedExpected,
        current: strippedCurrent.substring(0, 50),
        html: strippedHtml.substring(0, 50)
      });
    }
    return found;
  }

  async function handleMessage(message) {
    const { type, payload = {} } = message;
    switch (type) {
      case 'CHECK_READY': return { ready: await isWhatsAppReady() };
      case 'OPEN_CHAT': return handleOpenChat(payload.phone, payload.afterNavigation === true);
      case 'SEND_IN_CURRENT_CHAT': return sendTextMessage(payload.text || '', payload.humanTyping === true);
      case 'PING': return { pong: true, timestamp: Date.now() };
      default: return { success: false, error: `Unknown message type: ${type}` };
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message).then(sendResponse).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  });

  function injectBulkSenderButton() {
    if (document.getElementById('wa-bulk-sender-btn')) return;

    // Try multiple injection points for WA Web vs WA Business
    let container = document.querySelector(WASelectors.headerActions);
    if (!container) {
      // WA Business: try the header area near the top of the side panel
      container = document.querySelector('#pane-side header, #side header');
    }
    if (!container) return;

    const button = document.createElement('div');
    button.id = 'wa-bulk-sender-btn';
    button.title = 'WA Bulk Sender';
    button.innerHTML = `
    <button style="
      background: linear-gradient(135deg, #25D366, #128C7E);
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: 8px;
      transition: all 0.2s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 2px 8px rgba(37, 211, 102, 0.3);
    " onmouseover="this.style.transform='scale(1.05)'; this.style.boxShadow='0 4px 12px rgba(37, 211, 102, 0.4)';"
       onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 2px 8px rgba(37, 211, 102, 0.3)';">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/>
        <path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/>
      </svg>
      Bulk Send
    </button>
  `;

    button.querySelector('button').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
    });

    container.prepend(button);
  }

  async function init() {
    dbg('Content script loaded');

    if (await isWhatsAppReady()) {
      injectBulkSenderButton();
    }

    const observer = new MutationObserver(() => {
      if (!document.getElementById('wa-bulk-sender-btn')) {
        const hasTarget = document.querySelector(WASelectors.headerActions)
          || document.querySelector('#pane-side header, #side header');
        if (hasTarget) injectBulkSenderButton();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' });
  }

  init();
}
