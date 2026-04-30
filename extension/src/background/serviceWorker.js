/**
 * Background Service Worker - Orchestrator
 *
 * Coordinates popup state, queue persistence, and the WhatsApp tab.
 * Chat opening and message sending are split so navigation/reload does
 * not destroy the active send attempt.
 *
 * v1.1.0 — production build
 */

// Set to true only during local development
const DEBUG = false;

let queue = [];
let queueMeta = {
  isPaused: false,
  isStopped: true,
  sessionSentCount: 0,
  scheduledAt: null
};

const DEFAULT_SETTINGS = {
  baseDelay: 5000,
  jitterPercent: 30,
  sessionCap: 50,
  cooldownDelay: 300000,
  humanTyping: false,
  defaultCountryCode: ''
};

let settings = { ...DEFAULT_SETTINGS };
let isProcessing = false;
let contentScriptTabId = null;

const QueueStatus = {
  PENDING: 'PENDING',
  SENDING: 'SENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  RETRY: 'RETRY'
};

const QUEUE_KEY = 'wa_bulk_queue';
const QUEUE_META_KEY = 'wa_bulk_queue_meta';
const SETTINGS_KEY = 'wa_bulk_settings';
const LOGS_KEY = 'wa_bulk_logs';
const SETTINGS_VERSION = 2; // bump when DEFAULT_SETTINGS schema changes

let logs = [];
const MAX_LOGS = 500;

function log(level, context, message, data = null) {
  const entry = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    level,
    context,
    message,
    data
  };

  logs.push(entry);
  if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);

  if (DEBUG) {
    const prefix = `[WA-Bulk][${context}]`;
    if (level === 'error') console.error(prefix, message, data || '');
    else if (level === 'warn') console.warn(prefix, message, data || '');
    else console.log(prefix, message, data || '');
  }

  void saveLogs();
}

async function saveQueue() {
  try {
    await chrome.storage.local.set({
      [QUEUE_KEY]: queue,
      [QUEUE_META_KEY]: queueMeta
    });
  } catch (err) {
    log('error', 'Storage', 'Failed to save queue', { error: err.message });
  }
}

async function loadQueue() {
  try {
    const data = await chrome.storage.local.get([QUEUE_KEY, QUEUE_META_KEY]);
    if (data[QUEUE_KEY]) queue = data[QUEUE_KEY];
    if (data[QUEUE_META_KEY]) queueMeta = { ...queueMeta, ...data[QUEUE_META_KEY] };

    for (const item of queue) {
      if (item.status === QueueStatus.SENDING) {
        item.status = QueueStatus.RETRY;
        item.updatedAt = Date.now();
      }
    }

    await saveQueue();
  } catch (err) {
    log('error', 'Storage', 'Failed to load queue', { error: err.message });
  }
}

async function saveSettings() {
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  } catch (err) {
    log('error', 'Storage', 'Failed to save settings', { error: err.message });
  }
}

async function loadSettings() {
  try {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    const stored = data[SETTINGS_KEY];
    if (stored) {
      // Schema version guard: if stored version is old, merge with defaults
      // so new fields always exist and stale fields are dropped.
      if (!stored._version || stored._version < SETTINGS_VERSION) {
        log('info', 'Storage', `Settings schema migrated from v${stored._version || 0} to v${SETTINGS_VERSION}`);
      }
      settings = {
        ...DEFAULT_SETTINGS,
        ...stored,
        _version: SETTINGS_VERSION,
        defaultCountryCode: sanitizeCountryCode(stored.defaultCountryCode)
      };
    } else {
      settings = { ...DEFAULT_SETTINGS, _version: SETTINGS_VERSION };
    }
  } catch (err) {
    log('error', 'Storage', 'Failed to load settings', { error: err.message });
  }
}

async function saveLogs() {
  try {
    await chrome.storage.local.set({ [LOGS_KEY]: logs });
  } catch (err) {
    if (DEBUG) console.error('[WA-Bulk] Failed to save logs', err);
  }
}

async function loadLogs() {
  try {
    const data = await chrome.storage.local.get(LOGS_KEY);
    if (data[LOGS_KEY]) logs = data[LOGS_KEY];
  } catch (err) {
    if (DEBUG) console.error('[WA-Bulk] Failed to load logs', err);
  }
}

function sanitizeCountryCode(value) {
  return String(value || '').replace(/\D/g, '');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Interruptible sleep — breaks early if STOP is pressed.
 * Checks isStopped every 500 ms so STOP is honoured within half a second.
 */
async function sleepInterruptible(ms) {
  const chunk = 500;
  const end = Date.now() + ms;
  let ticks = 0;
  while (Date.now() < end) {
    if (queueMeta.isStopped || queueMeta.isPaused) return;
    await sleep(Math.min(chunk, end - Date.now()));
    ticks++;
    // Keep MV3 Service Worker alive during long sleeps
    if (ticks % 10 === 0) {
      log('info', 'System', 'Heartbeat keep-alive');
      await chrome.storage.local.get('keepalive');
    }
  }
}

async function ensureKeepAlive() {
  if (isProcessing && !queueMeta.isPaused && !queueMeta.isStopped) {
    // Only create alarm if we are actually processing
    const alarm = await chrome.alarms.get('WA_KEEP_ALIVE');
    if (!alarm) {
      chrome.alarms.create('WA_KEEP_ALIVE', { periodInMinutes: 0.5 });
      log('info', 'System', 'Keep-alive alarm established');
    }
  } else {
    chrome.alarms.clear('WA_KEEP_ALIVE');
  }
}

function getDelay() {
  const jitterRange = settings.baseDelay * (settings.jitterPercent / 100);
  const jitter = (Math.random() * 2 - 1) * jitterRange;
  return Math.max(1000, Math.round(settings.baseDelay + jitter));
}

function getRetryDelay(attempt) {
  const delay = settings.baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 1000;
  return Math.min(delay + jitter, 60000);
}

function getStats() {
  const stats = {
    total: queue.length,
    pending: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    retry: 0,
    sessionSentCount: queueMeta.sessionSentCount,
    isPaused: queueMeta.isPaused,
    isStopped: queueMeta.isStopped,
    isProcessing,
    scheduledAt: queueMeta.scheduledAt || null
  };

  for (const item of queue) {
    const key = item.status.toLowerCase();
    if (stats[key] !== undefined) stats[key]++;
  }

  return stats;
}

function getNextItem() {
  return queue.find(item => item.status === QueueStatus.PENDING || item.status === QueueStatus.RETRY) || null;
}

function getQueueSnapshot() {
  return queue.map(item => ({
    id: item.id,
    phone: item.phone,
    status: item.status,
    attempts: item.attempts,
    error: item.error,
    sentAt: item.sentAt
  }));
}

async function sendMessageToContentScript(tabId, payload) {
  try {
    return await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, payload, (response) => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message;
          if (errMsg.includes('Could not establish connection') || errMsg.includes('context invalidated')) {
            resolve({ success: false, error: 'CONNECTION_LOST', detail: errMsg });
          } else {
            resolve({ success: false, error: errMsg });
          }
        } else {
          resolve(response || { success: false, error: 'No response' });
        }
      });
    });
  } catch (err) {
    return { success: false, error: 'SEND_MESSAGE_EXCEPTION', detail: err.message };
  }
}

async function findWhatsAppTab() {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  return tabs.length > 0 ? tabs[0] : null;
}

/**
 * Programmatically inject the content script if it isn't already running.
 * This handles the case where the service worker wakes up but the
 * content script hasn't been injected yet (e.g. after browser restart).
 */
async function ensureContentScriptInjected(tabId) {
  try {
    // Quick check: if the content script is already running, it will respond
    const pingResult = await sendMessageToContentScript(tabId, { type: 'PING' });
    if (pingResult.pong) return true;
  } catch (e) {
    // Expected if content script isn't loaded
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/contentScript.js']
    });
    log('info', 'System', 'Content script injected programmatically');
    // Give the script a moment to initialize
    await sleep(1000);
    return true;
  } catch (err) {
    log('warn', 'System', 'Failed to inject content script', { error: err.message });
    return false;
  }
}

async function waitForWhatsAppReady(tabId, timeout = 30000) {
  const start = Date.now();
  let contentScriptInjected = false;

  while (Date.now() - start < timeout) {
    // ── Respect STOP signal ───────────────────────────────────────────────
    if (queueMeta.isStopped) {
      return { ready: false, error: 'Queue stopped by user' };
    }

    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      return { ready: false, error: 'WhatsApp tab was closed' };
    }

    if (tab.status === 'complete') {
      const ready = await sendMessageToContentScript(tabId, { type: 'CHECK_READY' });
      if (ready.ready) {
        return { ready: true };
      }

      // If the content script isn't responding, try injecting it once
      if (!contentScriptInjected && (ready.error || !ready.ready)) {
        contentScriptInjected = true;
        await ensureContentScriptInjected(tabId);
        // Continue the loop to re-check readiness
      }
    }

    await sleep(500);
  }

  return { ready: false, error: 'WhatsApp Web did not become ready in time' };
}

async function openChatForItem(tabId, phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const targetUrl = `https://web.whatsapp.com/send?phone=${encodeURIComponent(digits)}`;
  log('info', 'ChatNavigation', `Opening chat for ${digits} via direct navigation`, { targetUrl });

  // Always use direct URL navigation — works for saved contacts AND manual/unsaved numbers
  await chrome.tabs.update(tabId, { url: targetUrl });

  // Give Chrome a moment to register the navigation
  await sleep(1500);

  // Wait for the tab to finish loading — abort immediately if STOP is pressed
  const loadStart = Date.now();
  while (Date.now() - loadStart < 20000) {
    if (queueMeta.isStopped) {
      return { success: false, stage: 'open', error: 'Queue stopped by user', stopped: true };
    }
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      return { success: false, stage: 'open', error: 'WhatsApp tab was closed during navigation' };
    }
    if (tab.status === 'complete') break;
    await sleep(500);
  }

  // Wait for WhatsApp's app to be interactive
  const readyResult = await waitForWhatsAppReady(tabId, 30000);
  if (!readyResult.ready) {
    log('warn', 'ChatReady', `WhatsApp not ready after navigation for ${digits}`, { error: readyResult.error });
    return {
      success: false,
      stage: 'open',
      error: readyResult.error || 'WhatsApp did not become ready after navigation'
    };
  }

  // Extra stabilization: React needs time to fully mount the chat panel
  await sleep(3500);

  // Confirm the chat panel is ready (and check for invalid-number popup)
  const openResult = await sendMessageToContentScript(tabId, {
    type: 'OPEN_CHAT',
    payload: { phone: digits, afterNavigation: true }
  });

  if (openResult.success) {
    return { success: true };
  }

  if (openResult.invalidNumber) {
    return { success: false, stage: 'open', error: openResult.error, permanent: true };
  }

  return {
    success: false,
    stage: 'open',
    error: openResult.error || 'Target chat did not become ready after navigation'
  };
}

async function sendCurrentChatMessage(tabId, item) {
  // Abort immediately if STOP was pressed while we were opening the chat
  if (queueMeta.isStopped) {
    return { success: false, stage: 'send', error: 'Queue stopped by user', stopped: true };
  }

  log('info', 'ChatSend', `Sending message to ${item.phone}`, { id: item.id });

  const result = await sendMessageToContentScript(tabId, {
    type: 'SEND_IN_CURRENT_CHAT',
    payload: {
      text: item.message,
      humanTyping: settings.humanTyping
    }
  });

  if (result.success) {
    return { success: true };
  }

  return {
    success: false,
    stage: 'send',
    error: result.error || 'Failed to send message'
  };
}

async function processQueue() {
  if (isProcessing || queueMeta.isPaused || queueMeta.isStopped) return;

  if (queueMeta.scheduledAt && queueMeta.scheduledAt > Date.now()) {
    log('info', 'Queue', 'Queue is scheduled for the future. processQueue() aborted.');
    return;
  }

  isProcessing = true;
  log('info', 'Queue', 'Starting queue processing');
  await ensureKeepAlive();
  broadcastStatus();

  while (!queueMeta.isPaused && !queueMeta.isStopped) {
    if (queueMeta.sessionSentCount >= settings.sessionCap) {
      // Pause and notify the user — they must explicitly resume
      queueMeta.isPaused = true;
      await saveQueue();
      log('warn', 'RateLimiter',
        `Session cap of ${settings.sessionCap} reached. Sending paused. ` +
        `Press Resume after a break to continue.`);
      broadcastStatus();
      break;
    }

    const item = getNextItem();
    if (!item) {
      log('info', 'Queue', 'No more items to process');
      break;
    }

    let waTab = await findWhatsAppTab();
    if (!waTab) {
      log('info', 'System', 'WhatsApp tab not found. Opening a new tab automatically...');
      waTab = await chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
      // Give basic loading time; waitForWhatsAppReady will handle the rest
      await sleep(5000);
    }

    contentScriptTabId = waTab.id;

    const readyCheck = await waitForWhatsAppReady(waTab.id, 45000);
    if (!readyCheck.ready) {
      if (queueMeta.isStopped) {
        // User pressed STOP — break cleanly without pausing or logging an error
        break;
      }
      log('error', 'Queue', 'WhatsApp Web is not ready. Please ensure you are logged in.', { error: readyCheck.error });
      queueMeta.isPaused = true;
      await saveQueue();
      broadcastStatus();
      break;
    }

    item.status = QueueStatus.SENDING;
    item.attempts++;
    item.updatedAt = Date.now();
    await saveQueue();
    broadcastStatus();

    const openResult = await openChatForItem(waTab.id, item.phone);
    let finalResult = openResult;

    if (openResult.success) {
      finalResult = await sendCurrentChatMessage(waTab.id, item);
    }

    if (finalResult.success) {
      item.status = QueueStatus.SENT;
      item.error = null;
      item.sentAt = Date.now();
      queueMeta.sessionSentCount++;
      log('info', 'Queue', `✓ Sent to ${item.phone}`, { id: item.id });
    } else if (finalResult.stopped) {
      // User pressed STOP mid-send — revert to PENDING so the item isn’t wasted
      item.status = QueueStatus.PENDING;
      item.attempts = Math.max(0, item.attempts - 1); // undo the attempt count
      item.error = null;
      log('info', 'Queue', `■ Stopped mid-send for ${item.phone} — reset to PENDING`, { id: item.id });
    } else {
      const stageLabel = finalResult.stage === 'open' ? 'Failed to open chat' : 'Failed to send message';
      const formattedError = `${stageLabel}: ${finalResult.error}`;

      if (finalResult.permanent || item.attempts >= (item.maxAttempts || 3)) {
        item.status = QueueStatus.FAILED;
        item.error = item.attempts >= (item.maxAttempts || 3) && !finalResult.permanent
          ? `Max attempts reached: ${formattedError}`
          : formattedError;
        log('error', finalResult.stage === 'open' ? 'ChatOpen' : 'ChatSend', `✗ Failed ${item.phone}: ${item.error}`, { id: item.id });
      } else {
        item.status = QueueStatus.RETRY;
        item.error = formattedError;
        log('warn', finalResult.stage === 'open' ? 'ChatOpen' : 'ChatSend', `↻ Retry scheduled for ${item.phone}: ${formattedError}`, { id: item.id });
      }
    }

    item.updatedAt = Date.now();
    await saveQueue();
    await saveLogs();
    broadcastStatus();

    if (queueMeta.isPaused || queueMeta.isStopped) break;

    const delay = item.status === QueueStatus.RETRY ? getRetryDelay(item.attempts - 1) : getDelay();
    log('info', 'RateLimiter', `Waiting ${Math.round(delay / 1000)}s before next message`);
    await sleepInterruptible(delay); // honours STOP/PAUSE within 500 ms
  }

  isProcessing = false;
  await ensureKeepAlive();
  log('info', 'Queue', 'Queue processing stopped');
  broadcastStatus();
}

function broadcastStatus() {
  chrome.runtime.sendMessage({
    type: 'STATUS_UPDATE',
    stats: getStats(),
    queue: getQueueSnapshot(),
    logs: logs.slice(-50)
  }).catch(() => { });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (contentScriptTabId === tabId) {
    log('warn', 'System', 'WhatsApp tab was closed manually. Pausing queue.');
    contentScriptTabId = null;
    queueMeta.isPaused = true;
    void saveQueue();
    broadcastStatus();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'WA_BULK_SCHEDULE') {
    log('info', 'Schedule', 'Scheduled time reached, starting bulk send.');
    queueMeta.isPaused = false;
    queueMeta.isStopped = false;
    queueMeta.scheduledAt = null;
    await saveQueue();
    void processQueue();
    broadcastStatus();
  } else if (alarm.name === 'WA_KEEP_ALIVE') {
    if (!isProcessing && !queueMeta.isPaused && !queueMeta.isStopped) {
      log('info', 'System', 'Re-kicking processor from keep-alive');
      void processQueue();
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ success: false, error: err.message });
  });
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'CONTENT_SCRIPT_READY':
      if (sender.tab) {
        contentScriptTabId = sender.tab.id;
      }
      return { acknowledged: true };

    case 'INITIALIZE_QUEUE': {
      const { contacts, messageTemplate } = message.payload;
      queue = [];
      const seenPhones = new Set();
      let added = 0;
      let skipped = 0;

      for (const contact of contacts) {
        const phone = String(contact.phone || '').replace(/\D/g, '');
        if (!phone) continue;

        if (seenPhones.has(phone)) {
          skipped++;
          continue;
        }

        seenPhones.add(phone);

        let renderedMessage = '';
        if (contact.messageOverride) {
          renderedMessage = String(contact.messageOverride);
        } else {
          renderedMessage = String(messageTemplate || '').replace(
            /\{\{(\w+)(?:\|([^}]*))?\}\}/g,
            (match, varName, fallback) => {
              const value = contact.variables?.[varName];
              if (value !== undefined && value !== null && value !== '') return String(value);
              if (fallback !== undefined) return fallback;
              return '';
            }
          );
        }

        queue.push({
          id: `qi_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          phone,
          variables: contact.variables || {},
          messageTemplate: messageTemplate || '',
          message: renderedMessage,
          status: QueueStatus.PENDING,
          attempts: 0,
          maxAttempts: 3,
          error: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          sentAt: null
        });
        added++;
      }

      queueMeta = {
        isPaused: false,
        isStopped: true,
        sessionSentCount: 0,
        scheduledAt: null
      };

      await saveQueue();
      log('info', 'Queue', `Queue initialized: ${added} contacts, ${skipped} duplicates skipped`);
      return { success: true, stats: { added, skipped, total: queue.length } };
    }

    case 'START':
      if (queue.length === 0) {
        return { success: false, error: 'Queue is empty' };
      }
      queueMeta.isPaused = false;
      queueMeta.isStopped = false;
      await saveQueue();
      log('info', 'Queue', 'Queue started');
      void processQueue();
      return { success: true };

    // Atomic alternative: initialise the queue AND start in one round-trip
    case 'START_FRESH': {
      const { contacts, messageTemplate, scheduledAt } = message.payload;
      queue = [];
      const seenPhones = new Set();
      let added = 0, skipped = 0;

      for (const contact of contacts) {
        const phone = String(contact.phone || '').replace(/\D/g, '');
        if (!phone || seenPhones.has(phone)) { skipped++; continue; }
        seenPhones.add(phone);

        let renderedMessage = '';
        if (contact.messageOverride) {
          renderedMessage = String(contact.messageOverride);
        } else {
          renderedMessage = String(messageTemplate || '').replace(
            /\{\{(\w+)(?:\|([^}]*))?\}\}/g,
            (match, varName, fallback) => {
              const value = contact.variables?.[varName];
              if (value !== undefined && value !== null && value !== '') return String(value);
              if (fallback !== undefined) return fallback;
              return '';
            }
          );
        }

        queue.push({
          id: `qi_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          phone,
          variables: contact.variables || {},
          messageTemplate: messageTemplate || '',
          message: renderedMessage,
          status: QueueStatus.PENDING,
          attempts: 0,
          maxAttempts: 3,
          error: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          sentAt: null
        });
        added++;
      }

      if (added === 0) {
        return { success: false, error: 'No valid contacts to send to' };
      }

      const actualScheduledAt = (scheduledAt && scheduledAt > Date.now()) ? scheduledAt : null;
      queueMeta = { isPaused: false, isStopped: false, sessionSentCount: 0, scheduledAt: actualScheduledAt };
      await saveQueue();

      if (actualScheduledAt) {
        chrome.alarms.create('WA_BULK_SCHEDULE', { when: actualScheduledAt });
        log('info', 'Queue', `Queue initialized and scheduled for ${new Date(actualScheduledAt).toLocaleString()}: ${added} contacts`);
      } else {
        log('info', 'Queue', `Queue initialized and started: ${added} contacts, ${skipped} duplicates skipped`);
        void processQueue();
      }
      return { success: true, stats: { added, skipped, total: queue.length } };
    }

    case 'PAUSE':
      queueMeta.isPaused = true;
      await saveQueue();
      log('info', 'Queue', 'Queue paused');
      broadcastStatus();
      return { success: true };

    case 'RESUME':
      if (queueMeta.isStopped) {
        return { success: false, error: 'Queue is stopped. Use START to begin.' };
      }
      queueMeta.isPaused = false;
      await saveQueue();
      log('info', 'Queue', 'Queue resumed');
      if (!isProcessing) void processQueue();
      return { success: true };

    case 'STOP':
      queueMeta.isStopped = true;
      queueMeta.isPaused = false;
      queueMeta.scheduledAt = null;
      chrome.alarms.clear('WA_BULK_SCHEDULE');
      await saveQueue();
      log('info', 'Queue', 'Queue stopped');
      broadcastStatus();
      return { success: true };

    case 'GET_STATUS':
      return {
        stats: getStats(),
        settings,
        queue: getQueueSnapshot(),
        logs: logs.slice(-100)
      };

    case 'UPDATE_SETTINGS':
      settings = {
        ...settings,
        ...message.payload,
        defaultCountryCode: sanitizeCountryCode(message.payload.defaultCountryCode ?? settings.defaultCountryCode)
      };
      await saveSettings();
      log('info', 'Settings', 'Settings updated', settings);
      return { success: true };

    case 'GET_SETTINGS':
      return { settings };

    case 'CLEAR_QUEUE':
      queue = [];
      queueMeta = { isPaused: false, isStopped: true, sessionSentCount: 0, scheduledAt: null };
      isProcessing = false;
      chrome.alarms.clear('WA_BULK_SCHEDULE');
      await saveQueue();
      log('info', 'Queue', 'Queue cleared');
      broadcastStatus();
      return { success: true };

    case 'CLEAR_ALL_DATA':
      await clearAllData();
      broadcastStatus();
      return { success: true };

    case 'GET_LOGS':
      return { logs };

    case 'CLEAR_LOGS':
      logs = [];
      await saveLogs();
      return { success: true };

    case 'EXPORT_LOGS':
      return {
        csv: exportLogsCSV(),
        json: JSON.stringify(logs, null, 2)
      };

    case 'EXPORT_RESULTS':
      return { csv: exportResultsCSV() };

    case 'OPEN_POPUP':
      try {
        if (chrome.action?.openPopup) {
          await chrome.action.openPopup();
          return { success: true, opened: 'popup' };
        }
      } catch (err) {
        log('warn', 'System', 'Failed to open toolbar popup, falling back to extension tab', { error: err.message });
      }

      await chrome.tabs.create({ url: chrome.runtime.getURL('src/popup/popup.html') });
      return { success: true, opened: 'tab' };

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

function exportLogsCSV() {
  const headers = ['Timestamp', 'Level', 'Context', 'Message'];
  const rows = logs.map(entry => [
    new Date(entry.timestamp).toISOString(),
    entry.level,
    entry.context,
    `"${(entry.message || '').replace(/"/g, '""')}"`
  ]);
  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

function exportResultsCSV() {
  const headers = ['Phone', 'Status', 'Attempts', 'Error', 'SentAt'];
  const rows = queue.map(item => [
    item.phone,
    item.status,
    item.attempts,
    `"${(item.error || '').replace(/"/g, '""')}"`,
    item.sentAt ? new Date(item.sentAt).toISOString() : ''
  ]);
  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

async function clearAllData() {
  queue = [];
  queueMeta = { isPaused: false, isStopped: true, sessionSentCount: 0, scheduledAt: null };
  settings = { ...DEFAULT_SETTINGS };
  logs = [];
  contentScriptTabId = null;
  isProcessing = false;
  await chrome.storage.local.remove([QUEUE_KEY, QUEUE_META_KEY, SETTINGS_KEY, LOGS_KEY]);
}

async function init() {
  console.log('[WA Bulk Sender] Service worker started');
  await loadSettings();
  await loadQueue();
  await loadLogs();

  if (!queueMeta.isStopped && !queueMeta.isPaused) {
    if (queueMeta.scheduledAt && queueMeta.scheduledAt > Date.now()) {
      chrome.alarms.create('WA_BULK_SCHEDULE', { when: queueMeta.scheduledAt });
      log('info', 'ServiceWorker', `Background started. Queue is scheduled for ${new Date(queueMeta.scheduledAt).toLocaleString()}`);
    } else if (queue.some(item => item.status === QueueStatus.PENDING || item.status === QueueStatus.RETRY)) {
      if (queueMeta.scheduledAt) {
        queueMeta.scheduledAt = null; // Clear stale schedule
        await saveQueue();
      }
      log('info', 'ServiceWorker', 'Background restarted while queue was active. Resuming.');
      void processQueue();
    }
  }
}

init();
