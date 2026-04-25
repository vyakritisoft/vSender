/**
 * Rate Limiter - Configurable delays with jitter and session caps
 * 
 * Implements anti-ban strategy:
 * - Base delay with ±30% random jitter
 * - Session message cap
 * - Cooldown after batch
 */

const SETTINGS_KEY = 'wa_bulk_settings';

export class RateLimiter {
  /**
   * @param {Object} config
   * @param {number} config.baseDelay - Base delay in ms (default: 5000)
   * @param {number} config.jitterPercent - Jitter percentage (default: 30)
   * @param {number} config.sessionCap - Max messages per session (default: 50)
   * @param {number} config.cooldownDelay - Delay after hitting cap in ms (default: 300000 = 5min)
   */
  constructor(config = {}) {
    this.baseDelay = config.baseDelay || 5000;
    this.jitterPercent = config.jitterPercent || 30;
    this.sessionCap = config.sessionCap || 50;
    this.cooldownDelay = config.cooldownDelay || 300000;
    this.messagesSent = 0;
    this.sessionStartTime = Date.now();
  }

  /**
   * Calculate next delay with jitter
   * @returns {number} Delay in milliseconds
   */
  getDelay() {
    const jitterRange = this.baseDelay * (this.jitterPercent / 100);
    const jitter = (Math.random() * 2 - 1) * jitterRange;
    return Math.max(1000, Math.round(this.baseDelay + jitter));
  }

  /**
   * Wait for the calculated delay
   * @returns {Promise<number>} Actual delay waited
   */
  async wait() {
    const delay = this.getDelay();
    await new Promise(resolve => setTimeout(resolve, delay));
    return delay;
  }

  /**
   * Check if session cap is reached
   * @returns {boolean}
   */
  isSessionCapReached() {
    return this.messagesSent >= this.sessionCap;
  }

  /**
   * Record a sent message
   */
  recordSent() {
    this.messagesSent++;
  }

  /**
   * Wait for cooldown period (called when session cap hit)
   * @returns {Promise<void>}
   */
  async cooldown() {
    console.log(`[RateLimiter] Session cap reached (${this.messagesSent}/${this.sessionCap}). Cooling down for ${this.cooldownDelay / 1000}s...`);
    await new Promise(resolve => setTimeout(resolve, this.cooldownDelay));
    this.resetSession();
  }

  /**
   * Reset session counter
   */
  resetSession() {
    this.messagesSent = 0;
    this.sessionStartTime = Date.now();
  }

  /**
   * Get exponential backoff delay for retries
   * @param {number} attempt - Current attempt number (0-indexed)
   * @returns {number} Delay in ms
   */
  getRetryDelay(attempt) {
    const base = this.baseDelay;
    const delay = base * Math.pow(2, attempt);
    const jitter = Math.random() * 1000;
    return Math.min(delay + jitter, 60000); // Cap at 60s
  }

  /**
   * Wait for retry delay with exponential backoff
   * @param {number} attempt
   * @returns {Promise<number>}
   */
  async waitForRetry(attempt) {
    const delay = this.getRetryDelay(attempt);
    await new Promise(resolve => setTimeout(resolve, delay));
    return delay;
  }

  /**
   * Update configuration
   * @param {Object} config
   */
  updateConfig(config) {
    if (config.baseDelay !== undefined) this.baseDelay = config.baseDelay;
    if (config.jitterPercent !== undefined) this.jitterPercent = config.jitterPercent;
    if (config.sessionCap !== undefined) this.sessionCap = config.sessionCap;
    if (config.cooldownDelay !== undefined) this.cooldownDelay = config.cooldownDelay;
  }

  /**
   * Save settings to chrome.storage
   */
  async saveSettings() {
    try {
      await chrome.storage.local.set({
        [SETTINGS_KEY]: {
          baseDelay: this.baseDelay,
          jitterPercent: this.jitterPercent,
          sessionCap: this.sessionCap,
          cooldownDelay: this.cooldownDelay
        }
      });
    } catch (err) {
      console.error('[RateLimiter] saveSettings error:', err);
    }
  }

  /**
   * Load settings from chrome.storage
   */
  async loadSettings() {
    try {
      const data = await chrome.storage.local.get(SETTINGS_KEY);
      if (data[SETTINGS_KEY]) {
        this.updateConfig(data[SETTINGS_KEY]);
      }
    } catch (err) {
      console.error('[RateLimiter] loadSettings error:', err);
    }
  }

  /**
   * Get current stats
   * @returns {Object}
   */
  getStats() {
    return {
      messagesSent: this.messagesSent,
      sessionCap: this.sessionCap,
      baseDelay: this.baseDelay,
      jitterPercent: this.jitterPercent,
      sessionDuration: Date.now() - this.sessionStartTime,
      isCapReached: this.isSessionCapReached()
    };
  }
}
