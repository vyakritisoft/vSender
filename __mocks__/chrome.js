/**
 * Chrome API mock for Jest tests.
 * Mocks chrome.storage.local with an in-memory store.
 */

const store = {};

const chrome = {
  storage: {
    local: {
      set: jest.fn(async (obj) => {
        Object.assign(store, obj);
      }),
      get: jest.fn(async (keys) => {
        if (Array.isArray(keys)) {
          const result = {};
          keys.forEach((k) => {
            if (store[k] !== undefined) result[k] = store[k];
          });
          return result;
        }
        return store[keys] !== undefined ? { [keys]: store[keys] } : {};
      }),
      remove: jest.fn(async (keys) => {
        const keysArr = Array.isArray(keys) ? keys : [keys];
        keysArr.forEach((k) => delete store[k]);
      }),
      clear: jest.fn(async () => {
        Object.keys(store).forEach((k) => delete store[k]);
      }),
    },
  },
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
    },
  },
};

export default chrome;
global.chrome = chrome;
