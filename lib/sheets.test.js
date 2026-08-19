jest.mock('./auth', () => ({
  refreshAccessToken: jest.fn(),
}));

const { refreshAccessToken } = require('./auth');
const { getValues } = require('./sheets');

describe('sheetsFetch auth retry', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('retries once with a fresh token when the API rejects the cached one with 401', async () => {
    const calls = [];
    global.fetch = jest.fn((url, options) => {
      const bearer = options.headers.Authorization;
      calls.push(bearer);
      if (bearer === 'Bearer stale-token') {
        return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('{"error":"expired"}') });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ values: [['A1']] }) });
    });
    refreshAccessToken.mockResolvedValue('fresh-token');

    const values = await getValues('sheet123', 'A1:B2', 'stale-token');

    expect(values).toEqual([['A1']]);
    expect(calls).toEqual(['Bearer stale-token', 'Bearer fresh-token']);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  test('does not retry when the request succeeds on the first try', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, status: 200, json: () => Promise.resolve({ values: [] }),
    }));
    refreshAccessToken.mockResolvedValue('unused');

    await getValues('sheet123', 'A1:B2', 'good-token');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  test('still throws when the retry with a fresh token also fails', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false, status: 401, text: () => Promise.resolve('{"error":"still invalid"}'),
    }));
    refreshAccessToken.mockResolvedValue('fresh-token');

    await expect(getValues('sheet123', 'A1:B2', 'stale-token')).rejects.toThrow('Sheets API error 401');
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });
});
