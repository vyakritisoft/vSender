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
    attachButton: '[data-testid="clip-btn"], [data-testid="attach-media"], button[aria-label="Attach"], span[data-icon="clip"]',
    fileInput: 'input[type="file"]',
    mediaPreview: '[data-testid="media-caption-input-container"], [data-testid="media-editor"]',
    mediaCaptionInput: '[data-testid="media-caption-input"], div[role="textbox"][aria-label*="caption"], div[role="textbox"][aria-label*="Add a caption"]',
    mediaSendButton: '[data-testid="send-media"], [data-testid="media-send-btn"]',

    // Chat panel
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
  function verifyInputHasText(element, expectedText) {
    const currentText = (element.textContent || element.innerText || '').trim();
    // Also check innerHTML in case Lexical wraps in <p>/<span> and textContent is delayed
    const currentHtml = (element.innerHTML || '').replace(/<[^>]+>/g, ' ').trim();
    // Lexical strips newlines or converts them to <br>. Strip spaces for robust comparison
    const strippedExpected = expectedText.replace(/\s+/g, '').substring(0, 30);
    const strippedCurrent = currentText.replace(/\s+/g, '');
    const strippedHtml = currentHtml.replace(/\s+/g, '');
    return strippedCurrent.includes(strippedExpected) || strippedHtml.includes(strippedExpected);
  }

  /**
   * Set text in a contenteditable element reliably for WhatsApp Web.
   * @param {Element} element - The contenteditable element
   * @param {string} text - Text to set
   * @returns {boolean} Whether text was successfully set
   */
  function setInputText(element, text) {
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

    // Fire a generic input event to trigger React/Lexical's change detection 
    // without appending extra text payload (insertText already triggers its own input event)
    element.dispatchEvent(new Event('input', { bubbles: true }));

    return verifyInputHasText(element, text);
  }

  /**
   * Simulate human-like typing character by character.
   * @param {Element} element - The contenteditable input
   * @param {string} text - Text to type
   * @param {number} charDelay - Delay between characters in ms
   */
  async function simulateTyping(element, text, charDelay = 50) {
    element.focus();

    // Clear existing
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);

    for (const char of text) {
      if (char === '\n') {
        // WhatsApp Lexical editor resets nodes if insertLineBreak is forced; 
        // simulate Shift+Enter instead
        element.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true
        }));
      } else {
        document.execCommand('insertText', false, char);
      }
      element.dispatchEvent(new InputEvent('input', { bubbles: true }));

      // Random delay variation (±30%)
      const jitter = charDelay * 0.3;
      const delay = charDelay + (Math.random() * 2 - 1) * jitter;
      await sleep(Math.max(10, delay));
    }
  }


  async function handleOpenChat(phone, afterNavigation = false) {
    // Always called with afterNavigation=true since we navigate directly via URL.
    // Just wait for the message input to appear (and check for invalid-number popup).
    // We don't need header matching – the URL /send?phone=XXXX is authoritative.

    const result = await waitForCondition(() => {
      // Check for invalid number popup first
      const invalid = dismissInvalidNumberPopup();
      if (invalid) return invalid;

      // Accept as soon as the compose input is visible — means WA opened the right chat
      const input = document.querySelector(WASelectors.messageInput);
      if (!input) return null;

      // Extra guard: if a dialog error is visible (not an invalid-number popup),
      // something went wrong. We still let the caller handle it gracefully.
      const header = document.querySelector(WASelectors.chatContactName)?.textContent?.trim() || '';
      return { success: true, method: 'navigation', chatName: header || null };
    }, 15000, 300);

    if (!result) {
      return { success: false, error: 'Chat panel did not appear after navigation' };
    }
    return result;
  }

  function dataURLtoFile(dataUrl, fileName, mimeType) {
    const byteString = atob(dataUrl.split(',')[1]);
    const arrayBuffer = new ArrayBuffer(byteString.length);
    const uint8Array = new Uint8Array(arrayBuffer);
    for (let i = 0; i < byteString.length; i++) {
      uint8Array[i] = byteString.charCodeAt(i);
    }
    return new File([arrayBuffer], fileName, { type: mimeType });
  }

  /**
   * Find a hidden file input that matches the given MIME type.
   * Tries the most specific match first, then falls back to any file input.
   */
  function findFileInputForMime(mimeType) {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    if (!inputs.length) return null;

    const isImage = mimeType.startsWith('image/') || mimeType.startsWith('video/');

    // Prefer an input whose accept attribute matches our type
    const best = inputs.find(inp => {
      const accept = (inp.getAttribute('accept') || '').toLowerCase();
      if (!accept) return false;
      if (isImage) return accept.includes('image') || accept.includes('video');
      // For documents: pdf, audio, etc. – accept="*" or specific types
      return accept.includes(mimeType.toLowerCase()) ||
        accept.includes('application') ||
        accept === '*' ||
        accept.includes('/*');
    });
    return best || inputs[inputs.length - 1];
  }

  async function sendMediaMessage(mediaDataUrl, fileName, mimeType, caption = '') {
    dbg('sendMediaMessage – mimeType:', mimeType, 'fileName:', fileName);

    // ── STEP 1: Ensure the file input is exposed ─────────────────────────────
    // WhatsApp Web keeps hidden file inputs in the DOM. We try to find one first;
    // if not present we click the attach button to reveal the menu / inputs.

    let fileInput = findFileInputForMime(mimeType);

    if (!fileInput) {
      // Click the attach (clip) button to open the attach menu
      const attachBtn = document.querySelector(WASelectors.attachButton);
      if (!attachBtn) {
        // Last resort: try a more aggressive search for any attach-like button
        const fallbackBtn = document.querySelector('button[aria-label*="ttach"], span[data-icon="clip"]')?.closest('button');
        if (!fallbackBtn) return { success: false, error: 'Attach button not found in DOM' };
        fallbackBtn.click();
      } else {
        // Click the button itself or its nearest button ancestor
        const clickTarget = attachBtn.closest('button') || attachBtn.closest('[role="button"]') || attachBtn;
        clickTarget.click();
      }

      await sleep(800);

      // After clicking, search for file input again
      fileInput = await waitForCondition(() => findFileInputForMime(mimeType), 5000, 200);

      if (!fileInput) {
        // Close any open menu and report failure
        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', keyCode: 27 }));
        return { success: false, error: 'File input not found after clicking attach button' };
      }
    }

    // ── STEP 2: Set the file on the input ────────────────────────────────────
    const file = dataURLtoFile(mediaDataUrl, fileName, mimeType);
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    try {
      fileInput.files = dataTransfer.files;
    } catch (e) {
      dbg('Could not assign files directly:', e);
    }

    // Dispatch both change and input events so React/Lexical picks up the file
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(500);

    // ── STEP 3: Wait for the media preview panel ─────────────────────────────
    const preview = await waitForElement(WASelectors.mediaPreview, 20000);
    if (!preview) {
      return { success: false, error: 'Media preview did not appear – file may have been rejected' };
    }

    dbg('Media preview appeared');
    await sleep(500);

    // ── STEP 4: Insert caption if provided ───────────────────────────────────
    if (caption) {
      const captionInput = await waitForElement(WASelectors.mediaCaptionInput, 5000);
      if (captionInput) {
        setInputText(captionInput, caption);
        await sleep(400);
      } else {
        dbg('Caption input not found; sending without caption');
      }
    }

    // ── STEP 5: Wait for and click the media send button ─────────────────────
    // In current WA Web the media-editor send button is:
    //   <div aria-label="Send" role="button" tabindex="0"><span data-icon="send"/></div>
    // It renders ASYNC after the preview — so we must poll with waitForCondition.
    // The regular chat send button has data-testid="compose-btn-send" — we must
    // explicitly exclude it.

    const mediaSend = await waitForCondition(() => {
      // Ranked selector list — stop at the first match that is NOT the compose button
      const candidates = [
        // data-testid variants
        document.querySelector('[data-testid="send-media"]'),
        document.querySelector('[data-testid="media-send-btn"]'),
        // aria-label approach — most reliable in current WA Web
        ...Array.from(document.querySelectorAll('[aria-label="Send"][role="button"]')),
        // icon approach — exclude the compose-btn-send wrapper
        ...Array.from(document.querySelectorAll('[data-icon="send"]')),
      ];

      for (const el of candidates) {
        if (!el) continue;
        // Never click the regular compose send button
        if (el.closest('[data-testid="compose-btn-send"]')) continue;
        if (el.getAttribute('data-testid') === 'compose-btn-send') continue;
        // Must be inside the media editor overlay (not just any part of the page)
        // The overlay is typically outside #main or inside a fixed-position layer
        return el;
      }
      return null;
    }, 10000, 300);

    if (!mediaSend) {
      // Nuclear fallback: press Enter inside the caption/preview area
      dbg('Send button not found — trying Enter key');
      const captionOrPreview = document.querySelector(WASelectors.mediaCaptionInput) || preview;
      captionOrPreview.focus();
      captionOrPreview.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
      }));
      await sleep(2000);

      // Check if preview dismissed (= sent successfully)
      const stillOpen = document.querySelector(WASelectors.mediaPreview);
      if (stillOpen) {
        return { success: false, error: 'Media preview still open after Enter key — send may have failed' };
      }
      dbg('Media sent via Enter key');
      return { success: true };
    }

    // Walk up to the actual clickable element
    const sendTarget = mediaSend.closest('[role="button"]')
      || mediaSend.closest('button')
      || mediaSend.closest('div[tabindex]')
      || mediaSend;

    dbg('Clicking media send button:', sendTarget.tagName,
      sendTarget.getAttribute('aria-label'), sendTarget.getAttribute('data-testid'));

    sendTarget.focus();
    await sleep(150);
    sendTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    sendTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    sendTarget.click();

    // ── VERIFY: wait for preview to disappear (= sent) ────────────────────────
    const confirmed = await waitForCondition(() => {
      return !document.querySelector(WASelectors.mediaPreview) ? true : null;
    }, 6000, 300);

    if (!confirmed) {
      // Preview still visible — try Enter key as last resort
      dbg('Preview still open after click — trying Enter key');
      const captionOrPreview = document.querySelector(WASelectors.mediaCaptionInput) || preview;
      captionOrPreview.focus();
      captionOrPreview.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
      }));
      await sleep(2000);

      const stillOpen = document.querySelector(WASelectors.mediaPreview);
      if (stillOpen) {
        return { success: false, error: 'Media preview still visible after all send attempts' };
      }
    }

    dbg('Media sent successfully');
    return { success: true };
  }

  async function sendTextMessage(message, humanTyping = false) {
    const input = await waitForElement(WASelectors.messageInput, 10000);
    if (!input) {
      return { success: false, error: 'Message input not found' };
    }

    // Ensure the input is focused and ready
    input.click();
    input.focus();
    await sleep(300);

    if (humanTyping) {
      await simulateTyping(input, message, 40);
    } else {
      const insertSuccess = setInputText(input, message);
      if (!insertSuccess) {
        dbg('setInputText returned false; proceeding anyway to see if React catches up.');
      }
    }

    // Verify text was actually inserted
    const textEntered = await waitForCondition(() => {
      return verifyInputHasText(input, message);
    }, 5000, 100);

    if (!textEntered) {
      dbg('Text verification failed - input is empty after insertion');
      return { success: false, error: 'Message text could not be inserted into the compose box' };
    }

    // Wait for send button to appear (it only shows when text is present)
    const sendBtn = await waitForElement(WASelectors.sendButton, 8000);
    if (!sendBtn) {
      return { success: false, error: 'Send button not found (text may not have been properly registered by WhatsApp)' };
    }

    // Walk up to the actual <button> element – clicking a <span> icon alone
    // does not reliably trigger WhatsApp's React onClick handler.
    const clickTarget = sendBtn.closest('button') || sendBtn.closest('[role="button"]') || sendBtn;
    clickTarget.click();
    await sleep(1200);

    // Verify message was sent (input should be cleared after send)
    const postSendText = (input.textContent || '').trim();
    if (postSendText && verifyInputHasText(input, message)) {
      dbg('Message may not have been sent - input still contains text');
    }

    return { success: true };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message).then(sendResponse).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  });

  async function handleMessage(message) {
    const { type, payload = {} } = message;

    switch (type) {
      case 'CHECK_READY':
        return { ready: await isWhatsAppReady() };

      case 'OPEN_CHAT':
        return handleOpenChat(payload.phone, payload.afterNavigation === true);

      case 'SEND_IN_CURRENT_CHAT':
        if (payload.media?.dataUrl) {
          return sendMediaMessage(
            payload.media.dataUrl,
            payload.media.fileName,
            payload.media.mimeType,
            payload.text || ''
          );
        }
        return sendTextMessage(payload.text || '', payload.humanTyping === true);

      case 'PING':
        return { pong: true, timestamp: Date.now() };

      default:
        return { success: false, error: `Unknown message type: ${type}` };
    }
  }

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
