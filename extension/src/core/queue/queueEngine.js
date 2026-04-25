/**
 * Queue Engine - FIFO queue with state machine
 * 
 * States: PENDING → SENDING → SENT | FAILED | RETRY
 * Persists queue to chrome.storage.local
 */

// Queue item statuses
export const QueueStatus = {
  PENDING: 'PENDING',
  SENDING: 'SENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  RETRY: 'RETRY'
};

// Storage key
const QUEUE_STORAGE_KEY = 'wa_bulk_queue';
const QUEUE_META_KEY = 'wa_bulk_queue_meta';

export class QueueEngine {
  constructor() {
    this.items = [];
    this.isPaused = false;
    this.isStopped = false;
    this.currentIndex = 0;
    this.sessionSentCount = 0;
    this.duplicateSet = new Set();
  }

  /**
   * Initialize the queue with parsed contact data
   * @param {Array} contacts - Array of { phone, variables, media }
   * @param {string} messageTemplate - Template string with {{variables}}
   * @returns {Object} Stats about added/skipped items
   */
  async initialize(contacts, messageTemplate) {
    this.items = [];
    this.duplicateSet.clear();
    this.currentIndex = 0;
    this.sessionSentCount = 0;
    this.isPaused = false;
    this.isStopped = false;

    let added = 0;
    let skipped = 0;

    for (const contact of contacts) {
      const normalizedPhone = contact.phone.replace(/\D/g, '');
      
      // Duplicate detection
      if (this.duplicateSet.has(normalizedPhone)) {
        skipped++;
        continue;
      }
      
      this.duplicateSet.add(normalizedPhone);
      
      this.items.push({
        id: this._generateId(),
        phone: normalizedPhone,
        variables: contact.variables || {},
        messageTemplate: messageTemplate,
        media: contact.media || null,
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

    await this.persist();
    
    return { added, skipped, total: this.items.length };
  }

  /**
   * Get the next pending or retry item
   * @returns {Object|null} Next queue item or null
   */
  getNext() {
    if (this.isPaused || this.isStopped) return null;
    
    return this.items.find(
      item => item.status === QueueStatus.PENDING || item.status === QueueStatus.RETRY
    ) || null;
  }

  /**
   * Update item status with state machine enforcement
   * @param {string} id - Queue item id
   * @param {string} newStatus - New status
   * @param {string} [error] - Error message if failed
   */
  async updateStatus(id, newStatus, error = null) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;

    // Enforce valid transitions
    const validTransitions = {
      [QueueStatus.PENDING]: [QueueStatus.SENDING],
      [QueueStatus.SENDING]: [QueueStatus.SENT, QueueStatus.FAILED, QueueStatus.RETRY],
      [QueueStatus.RETRY]: [QueueStatus.SENDING],
      [QueueStatus.FAILED]: [], // Terminal state
      [QueueStatus.SENT]: []    // Terminal state
    };

    if (!validTransitions[item.status]?.includes(newStatus)) {
      console.warn(`Invalid transition: ${item.status} → ${newStatus}`);
      return;
    }

    item.status = newStatus;
    item.updatedAt = Date.now();
    
    if (error) item.error = error;
    
    if (newStatus === QueueStatus.SENT) {
      item.sentAt = Date.now();
      this.sessionSentCount++;
    }
    
    if (newStatus === QueueStatus.SENDING) {
      item.attempts++;
    }

    if (newStatus === QueueStatus.FAILED || newStatus === QueueStatus.RETRY) {
      item.error = error || 'Unknown error';
    }

    await this.persist();
  }

  /**
   * Mark item for retry if attempts remain, otherwise fail
   * @param {string} id - Queue item id
   * @param {string} error - Error message
   */
  async markForRetry(id, error) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;

    if (item.attempts < item.maxAttempts) {
      await this.updateStatus(id, QueueStatus.RETRY, error);
    } else {
      await this.updateStatus(id, QueueStatus.FAILED, `Max attempts reached: ${error}`);
    }
  }

  /**
   * Pause the queue
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * Resume the queue
   */
  resume() {
    this.isPaused = false;
  }

  /**
   * Stop the queue permanently
   */
  stop() {
    this.isStopped = true;
  }

  /**
   * Get queue statistics
   * @returns {Object} Stats breakdown
   */
  getStats() {
    const stats = {
      total: this.items.length,
      pending: 0,
      sending: 0,
      sent: 0,
      failed: 0,
      retry: 0,
      sessionSentCount: this.sessionSentCount,
      isPaused: this.isPaused,
      isStopped: this.isStopped
    };

    for (const item of this.items) {
      switch (item.status) {
        case QueueStatus.PENDING: stats.pending++; break;
        case QueueStatus.SENDING: stats.sending++; break;
        case QueueStatus.SENT: stats.sent++; break;
        case QueueStatus.FAILED: stats.failed++; break;
        case QueueStatus.RETRY: stats.retry++; break;
      }
    }

    return stats;
  }

  /**
   * Get all items for display
   * @returns {Array} Queue items
   */
  getItems() {
    return [...this.items];
  }

  /**
   * Persist queue to chrome.storage
   */
  async persist() {
    try {
      await chrome.storage.local.set({
        [QUEUE_STORAGE_KEY]: this.items,
        [QUEUE_META_KEY]: {
          isPaused: this.isPaused,
          isStopped: this.isStopped,
          sessionSentCount: this.sessionSentCount,
          lastUpdated: Date.now()
        }
      });
    } catch (err) {
      console.error('[QueueEngine] persist error:', err);
    }
  }

  /**
   * Restore queue from chrome.storage
   */
  async restore() {
    try {
      const data = await chrome.storage.local.get([QUEUE_STORAGE_KEY, QUEUE_META_KEY]);
      
      if (data[QUEUE_STORAGE_KEY]) {
        this.items = data[QUEUE_STORAGE_KEY];
        this.duplicateSet = new Set(this.items.map(i => i.phone));
      }
      
      if (data[QUEUE_META_KEY]) {
        const meta = data[QUEUE_META_KEY];
        this.isPaused = meta.isPaused || false;
        this.isStopped = meta.isStopped || false;
        this.sessionSentCount = meta.sessionSentCount || 0;
      }

      // Reset any items stuck in SENDING back to RETRY
      for (const item of this.items) {
        if (item.status === QueueStatus.SENDING) {
          item.status = QueueStatus.RETRY;
          item.updatedAt = Date.now();
        }
      }

      await this.persist();
    } catch (err) {
      console.error('[QueueEngine] restore error:', err);
    }
  }

  /**
   * Clear the queue
   */
  async clear() {
    this.items = [];
    this.duplicateSet.clear();
    this.currentIndex = 0;
    this.sessionSentCount = 0;
    this.isPaused = false;
    this.isStopped = false;
    
    await chrome.storage.local.remove([QUEUE_STORAGE_KEY, QUEUE_META_KEY]);
  }

  /**
   * Generate a unique ID
   * @returns {string}
   */
  _generateId() {
    return `qi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
