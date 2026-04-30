/**
 * Jest global setup — runs in the Jest context before all tests.
 * Provides a minimal chrome.storage.local mock for ESM modules.
 */

const store = {};

global.chrome = {
  storage: {
    local: {
      set: jest.fn(async (obj) => { Object.assign(store, obj); }),
      get: jest.fn(async (keys) => {
        if (Array.isArray(keys)) {
          const result = {};
          keys.forEach((k) => { if (store[k] !== undefined) result[k] = store[k]; });
          return result;
        }
        return store[keys] !== undefined ? { [keys]: store[keys] } : {};
      }),
      remove: jest.fn(async (keys) => {
        const keysArr = Array.isArray(keys) ? keys : [keys];
        keysArr.forEach((k) => delete store[k]);
      }),
    },
  },
  runtime: {
    sendMessage: jest.fn(),
    onMessage: { addListener: jest.fn() },
  },
};
