// Minimal localStorage stand-in, same pattern as lib/sheets.test.js - the
// token cache and silent-sign-in flow both need `typeof window !== 'undefined'`
// to be true, which the node test environment doesn't provide on its own.
function installFakeLocalStorage() {
  const store = new Map();
  global.window = global.window || {};
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

// Stubs the bit of the real Google Identity Services API this module talks
// to - initTokenClient/requestAccessToken - so trySilentSignIn can be tested
// without a real browser or network. `respond` decides what the stubbed
// client does when requestAccessToken() is called.
function installFakeGoogleOauth(respond) {
  global.window.google = {
    accounts: {
      oauth2: {
        initTokenClient: (opts) => ({
          requestAccessToken: () => respond(opts),
        }),
      },
    },
  };
}

describe('trySilentSignIn', () => {
  beforeEach(() => {
    jest.resetModules();
    installFakeLocalStorage();
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'test-client-id';
  });

  afterEach(() => {
    delete global.window.google;
  });

  test('resolves the token and caches it when the silent flow succeeds', async () => {
    installFakeGoogleOauth((opts) => {
      expect(opts.prompt).toBe('');
      opts.callback({ access_token: 'silent-token', expires_in: 3600 });
    });
    const { trySilentSignIn, getStoredToken } = require('./auth');

    const token = await trySilentSignIn();

    expect(token).toBe('silent-token');
    expect(getStoredToken()).toBe('silent-token');
  });

  test('resolves null (no throw) when Google reports an error', async () => {
    installFakeGoogleOauth((opts) => {
      opts.callback({ error: 'interaction_required' });
    });
    const { trySilentSignIn, getStoredToken } = require('./auth');

    await expect(trySilentSignIn()).resolves.toBeNull();
    expect(getStoredToken()).toBeNull();
  });

  test('resolves null when the client reports an error via error_callback', async () => {
    installFakeGoogleOauth((opts) => {
      opts.error_callback({ type: 'popup_failed_to_open' });
    });
    const { trySilentSignIn } = require('./auth');

    await expect(trySilentSignIn()).resolves.toBeNull();
  });

  test('resolves null instead of hanging forever when nothing ever calls back', async () => {
    jest.useFakeTimers();
    installFakeGoogleOauth(() => {
      // Simulates a browser (Safari ITP, private mode) that blocks the silent
      // flow's storage access and never calls back at all.
    });
    const { trySilentSignIn } = require('./auth');

    const pending = trySilentSignIn();
    // trySilentSignIn awaits loadGisScript() before registering the timeout,
    // so the timer isn't there to advance yet on this very tick - let that
    // microtask settle first.
    await jest.advanceTimersByTimeAsync(4000);
    await expect(pending).resolves.toBeNull();
    jest.useRealTimers();
  });

  test('resolves null when NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set', async () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    installFakeGoogleOauth(() => {
      throw new Error('should not be called without a client ID');
    });
    const { trySilentSignIn } = require('./auth');

    await expect(trySilentSignIn()).resolves.toBeNull();
  });
});

describe('resolveInitialToken', () => {
  beforeEach(() => {
    jest.resetModules();
    installFakeLocalStorage();
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'test-client-id';
  });

  afterEach(() => {
    delete global.window.google;
  });

  test('returns the cached token without attempting a silent sign-in', async () => {
    installFakeGoogleOauth(() => {
      throw new Error('should not be called when a cached token exists');
    });
    const { resolveInitialToken } = require('./auth');
    global.localStorage.setItem('gsheets_access_token', 'cached-token');
    global.localStorage.setItem('gsheets_access_token_expiry', String(Date.now() + 60_000));

    await expect(resolveInitialToken()).resolves.toBe('cached-token');
  });

  test('falls back to a silent sign-in when there is no cached token', async () => {
    installFakeGoogleOauth((opts) => {
      opts.callback({ access_token: 'fresh-silent-token', expires_in: 3600 });
    });
    const { resolveInitialToken } = require('./auth');

    await expect(resolveInitialToken()).resolves.toBe('fresh-silent-token');
  });
});
