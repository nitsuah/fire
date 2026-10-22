// privacy.js touches document/localStorage at load time — stub before require
globalThis.document = {
    readyState: 'complete',
    getElementById: () => ({ addEventListener() {} }),
    addEventListener() {},
};
globalThis.localStorage = {
    getItem: () => '1',
    setItem() {},
};

const { stripNavRow } = require('./privacy.js');

describe('stripNavRow', () => {
    it('removes a line ending in <!-- nav -->', () => {
        const input = 'line1\n> nav line <!-- nav -->\nline3';
        expect(stripNavRow(input)).toBe('line1\n\nline3');
    });

    it('leaves markdown unchanged when no nav line is present', () => {
        const input = '# Title\n\nSome content here.';
        expect(stripNavRow(input)).toBe(input);
    });
});
