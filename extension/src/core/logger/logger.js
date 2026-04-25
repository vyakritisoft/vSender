/**
 * Logger - In-memory + chrome.storage logging
 * 
 * Levels: info, warn, error
 * Stores logs in chrome.storage.local with rotation
 */

const LOGS_STORAGE_KEY = 'wa_bulk_logs';
const MAX_LOG_ENTRIES = 500;

export const LogLevel = {
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error'
};

class Logger {
  constructor() {
    this.logs = [];
    this.listeners = [];
  }

  /**
   * Log an info message
   * @param {string} context - Module/context name
   * @param {string} message - Log message
   * @param {Object} [data] - Additional data
   */
  info(context, message, data = null) {
    this._log(LogLevel.INFO, context, message, data);
  }

  /**
   * Log a warning
   * @param {string} context - Module/context name
   * @param {string} message - Log message
   * @param {Object} [data] - Additional data
   */
  warn(context, message, data = null) {
    this._log(LogLevel.WARN, context, message, data);
  }

  /**
   * Log an error
   * @param {string} context - Module/context name
   * @param {string} message - Log message
   * @param {Object} [data] - Additional data
   */
  error(context, message, data = null) {
    this._log(LogLevel.ERROR, context, message, data);
  }

  /**
   * Internal log method
   */
  _log(level, context, message, data) {
    const entry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now(),
      level,
      context,
      message,
      data: data ? JSON.parse(JSON.stringify(data)) : null
    };

    this.logs.push(entry);

    // Rotate if exceeding max
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs = this.logs.slice(-MAX_LOG_ENTRIES);
    }

    // Console output
    const prefix = `[WA-Bulk][${context}]`;
    switch (level) {
      case LogLevel.INFO:
        console.log(prefix, message, data || '');
        break;
      case LogLevel.WARN:
        console.warn(prefix, message, data || '');
        break;
      case LogLevel.ERROR:
        console.error(prefix, message, data || '');
        break;
    }

    // Notify listeners
    this.listeners.forEach(fn => fn(entry));
  }

  /**
   * Subscribe to new log entries
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(fn => fn !== callback);
    };
  }

  /**
   * Get all logs
   * @param {string} [level] - Filter by level
   * @returns {Array}
   */
  getLogs(level = null) {
    if (level) {
      return this.logs.filter(l => l.level === level);
    }
    return [...this.logs];
  }

  /**
   * Persist logs to chrome.storage
   */
  async persist() {
    try {
      await chrome.storage.local.set({ [LOGS_STORAGE_KEY]: this.logs });
    } catch (err) {
      console.error('[Logger] persist error:', err);
    }
  }

  /**
   * Restore logs from chrome.storage
   */
  async restore() {
    try {
      const data = await chrome.storage.local.get(LOGS_STORAGE_KEY);
      if (data[LOGS_STORAGE_KEY]) {
        this.logs = data[LOGS_STORAGE_KEY];
      }
    } catch (err) {
      console.error('[Logger] restore error:', err);
    }
  }

  /**
   * Clear all logs
   */
  async clear() {
    this.logs = [];
    try {
      await chrome.storage.local.remove(LOGS_STORAGE_KEY);
    } catch (err) {
      console.error('[Logger] clear error:', err);
    }
  }

  /**
   * Export logs as CSV string
   * @returns {string}
   */
  exportCSV() {
    const headers = ['Timestamp', 'Level', 'Context', 'Message', 'Data'];
    const rows = this.logs.map(log => [
      new Date(log.timestamp).toISOString(),
      log.level,
      log.context,
      `"${(log.message || '').replace(/"/g, '""')}"`,
      log.data ? `"${JSON.stringify(log.data).replace(/"/g, '""')}"` : ''
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  /**
   * Export logs as JSON string
   * @returns {string}
   */
  exportJSON() {
    return JSON.stringify(this.logs, null, 2);
  }
}

// Singleton instance
export const logger = new Logger();
