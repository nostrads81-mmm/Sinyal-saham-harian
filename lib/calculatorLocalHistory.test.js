function makeLocalStorageMock() {
  let store = {};
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    clear: () => { store = {}; },
  };
}

global.window = {};
global.localStorage = makeLocalStorageMock();

const {
  getLocalCalculatorHistory, addLocalCalculatorEntry, deleteLocalCalculatorEntry,
} = require('./calculatorLocalHistory');

beforeEach(() => {
  global.localStorage.clear();
});

test('starts empty', () => {
  expect(getLocalCalculatorHistory()).toEqual([]);
});

test('adding an entry assigns it an increasing local id (rowNumber)', () => {
  addLocalCalculatorEntry({ simbol: 'BBCA', lot: 10 });
  addLocalCalculatorEntry({ simbol: 'TLKM', lot: 5 });

  const history = getLocalCalculatorHistory();
  expect(history).toHaveLength(2);
  expect(history[0]).toMatchObject({ simbol: 'BBCA', lot: 10, rowNumber: 1 });
  expect(history[1]).toMatchObject({ simbol: 'TLKM', lot: 5, rowNumber: 2 });
});

test('deleting removes only the matching entry, by id', () => {
  addLocalCalculatorEntry({ simbol: 'BBCA' });
  addLocalCalculatorEntry({ simbol: 'TLKM' });

  deleteLocalCalculatorEntry(1);

  const history = getLocalCalculatorHistory();
  expect(history).toHaveLength(1);
  expect(history[0].simbol).toBe('TLKM');
});
