/**
 * Unit tests: QueueEngine
 *
 * Tests the FIFO queue state machine, duplicate detection,
 * pause/resume/stop controls, and stats reporting.
 *
 * NOTE: With Jest ESM (--experimental-vm-modules) the `jest` global is NOT
 * automatically injected.  We import explicitly from @jest/globals and we
 * mock chrome.storage with plain async functions (no jest.fn needed).
 */

import { describe, test, expect, beforeEach, beforeAll } from '@jest/globals';
import { QueueEngine, QueueStatus } from '../extension/src/core/queue/queueEngine.js';

// ─── Minimal chrome.storage.local shim ────────────────────────────────────
beforeAll(() => {
  const store = {};
  global.chrome = {
    storage: {
      local: {
        set: async (obj) => { Object.assign(store, obj); },
        get: async (keys) => {
          if (Array.isArray(keys)) {
            const result = {};
            keys.forEach((k) => { if (store[k] !== undefined) result[k] = store[k]; });
            return result;
          }
          return store[keys] !== undefined ? { [keys]: store[keys] } : {};
        },
        remove: async (keys) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          arr.forEach((k) => delete store[k]);
        },
      },
    },
  };
});

const makeContacts = (n = 3) =>
  Array.from({ length: n }, (_, i) => ({
    phone: `+1555000${String(i).padStart(4, '0')}`,
    variables: { name: `Contact ${i}` },
  }));

// ─── QueueStatus ──────────────────────────────────────────────────────────

describe('QueueStatus', () => {
  test('exports all expected statuses', () => {
    expect(QueueStatus.PENDING).toBe('PENDING');
    expect(QueueStatus.SENDING).toBe('SENDING');
    expect(QueueStatus.SENT).toBe('SENT');
    expect(QueueStatus.FAILED).toBe('FAILED');
    expect(QueueStatus.RETRY).toBe('RETRY');
  });
});

// ─── QueueEngine ──────────────────────────────────────────────────────────

describe('QueueEngine', () => {
  let queue;

  beforeEach(() => {
    queue = new QueueEngine();
  });

  // ── initialize() ──────────────────────────────────────────────────────

  describe('initialize()', () => {
    test('adds all unique contacts', async () => {
      const result = await queue.initialize(makeContacts(3), 'Hello {{name}}');
      expect(result.added).toBe(3);
      expect(result.skipped).toBe(0);
      expect(result.total).toBe(3);
    });

    test('deduplicates contacts by phone', async () => {
      const contacts = [
        { phone: '+15550001111', variables: {} },
        { phone: '+1-555-000-1111', variables: {} }, // same digits
      ];
      const result = await queue.initialize(contacts, 'Hi');
      expect(result.added).toBe(1);
      expect(result.skipped).toBe(1);
    });

    test('sets all items to PENDING status', async () => {
      await queue.initialize(makeContacts(2), 'Hi');
      queue.getItems().forEach((item) => {
        expect(item.status).toBe(QueueStatus.PENDING);
      });
    });
  });

  // ── getNext() ─────────────────────────────────────────────────────────

  describe('getNext()', () => {
    test('returns next PENDING item', async () => {
      await queue.initialize(makeContacts(2), 'Hi');
      const item = queue.getNext();
      expect(item).not.toBeNull();
      expect(item.status).toBe(QueueStatus.PENDING);
    });

    test('returns null when paused', async () => {
      await queue.initialize(makeContacts(2), 'Hi');
      queue.pause();
      expect(queue.getNext()).toBeNull();
    });

    test('returns null when stopped', async () => {
      await queue.initialize(makeContacts(2), 'Hi');
      queue.stop();
      expect(queue.getNext()).toBeNull();
    });

    test('returns RETRY items', async () => {
      await queue.initialize(makeContacts(1), 'Hi');
      const item = queue.getItems()[0];
      await queue.updateStatus(item.id, QueueStatus.SENDING);
      await queue.updateStatus(item.id, QueueStatus.RETRY, 'timeout');
      expect(queue.getNext()).not.toBeNull();
    });
  });

  // ── updateStatus() ────────────────────────────────────────────────────

  describe('updateStatus()', () => {
    test('valid transition PENDING → SENDING', async () => {
      await queue.initialize(makeContacts(1), 'Hi');
      const [item] = queue.getItems();
      await queue.updateStatus(item.id, QueueStatus.SENDING);
      expect(queue.getItems()[0].status).toBe(QueueStatus.SENDING);
    });

    test('SENDING → SENT increments sessionSentCount', async () => {
      await queue.initialize(makeContacts(1), 'Hi');
      const [item] = queue.getItems();
      await queue.updateStatus(item.id, QueueStatus.SENDING);
      await queue.updateStatus(item.id, QueueStatus.SENT);
      expect(queue.getStats().sent).toBe(1);
      expect(queue.getStats().sessionSentCount).toBe(1);
    });

    test('invalid transition PENDING → SENT is ignored', async () => {
      await queue.initialize(makeContacts(1), 'Hi');
      const [item] = queue.getItems();
      await queue.updateStatus(item.id, QueueStatus.SENT);
      expect(queue.getItems()[0].status).toBe(QueueStatus.PENDING);
    });

    test('SENDING → FAILED stores error', async () => {
      await queue.initialize(makeContacts(1), 'Hi');
      const [item] = queue.getItems();
      await queue.updateStatus(item.id, QueueStatus.SENDING);
      await queue.updateStatus(item.id, QueueStatus.FAILED, 'Network error');
      const updated = queue.getItems()[0];
      expect(updated.status).toBe(QueueStatus.FAILED);
      expect(updated.error).toBe('Network error');
    });

    test('increments attempts on SENDING', async () => {
      await queue.initialize(makeContacts(1), 'Hi');
      const [item] = queue.getItems();
      await queue.updateStatus(item.id, QueueStatus.SENDING);
      expect(queue.getItems()[0].attempts).toBe(1);
    });
  });

  // ── markForRetry() ────────────────────────────────────────────────────

  describe('markForRetry()', () => {
    test('sets RETRY if attempts < maxAttempts', async () => {
      await queue.initialize(makeContacts(1), 'Hi');
      const [item] = queue.getItems();
      await queue.updateStatus(item.id, QueueStatus.SENDING); // attempts = 1 / max = 3
      await queue.markForRetry(item.id, 'Timeout');
      expect(queue.getItems()[0].status).toBe(QueueStatus.RETRY);
    });

    test('sets FAILED when max attempts exhausted', async () => {
      await queue.initialize(makeContacts(1), 'Hi');
      const id = queue.getItems()[0].id;

      // Simulate 3 SENDING attempts
      for (let i = 0; i < 3; i++) {
        const cur = queue.getItems()[0];
        if ([QueueStatus.PENDING, QueueStatus.RETRY].includes(cur.status)) {
          await queue.updateStatus(id, QueueStatus.SENDING);
        }
        if (i < 2) await queue.updateStatus(id, QueueStatus.RETRY, 'err');
      }
      await queue.markForRetry(id, 'Final');
      expect(queue.getItems()[0].status).toBe(QueueStatus.FAILED);
    });
  });

  // ── pause / resume / stop ─────────────────────────────────────────────

  describe('pause / resume / stop', () => {
    test('pause sets isPaused', () => {
      queue.pause();
      expect(queue.getStats().isPaused).toBe(true);
    });

    test('resume clears isPaused', () => {
      queue.pause();
      queue.resume();
      expect(queue.getStats().isPaused).toBe(false);
    });

    test('stop sets isStopped', () => {
      queue.stop();
      expect(queue.getStats().isStopped).toBe(true);
    });
  });

  // ── getStats() ────────────────────────────────────────────────────────

  describe('getStats()', () => {
    test('returns correct breakdown', async () => {
      await queue.initialize(makeContacts(3), 'Hi');
      const items = queue.getItems();

      await queue.updateStatus(items[0].id, QueueStatus.SENDING);
      await queue.updateStatus(items[0].id, QueueStatus.SENT);

      await queue.updateStatus(items[1].id, QueueStatus.SENDING);
      await queue.updateStatus(items[1].id, QueueStatus.FAILED, 'err');

      const stats = queue.getStats();
      expect(stats.total).toBe(3);
      expect(stats.sent).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.pending).toBe(1);
    });
  });

  // ── clear() ───────────────────────────────────────────────────────────

  describe('clear()', () => {
    test('resets all queue state', async () => {
      await queue.initialize(makeContacts(3), 'Hi');
      await queue.clear();
      const stats = queue.getStats();
      expect(stats.total).toBe(0);
      expect(stats.sessionSentCount).toBe(0);
    });
  });
});
