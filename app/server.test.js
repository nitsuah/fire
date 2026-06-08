const request = require('supertest');
const app = require('./server');

describe('FIRE Tracker API', () => {
    it('GET /api/state returns the persisted state as JSON', async () => {
        const res = await request(app).get('/api/state');

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('importedPositions');
        expect(res.body).toHaveProperty('customAccounts');
    });

    it('serves the frontend index page', async () => {
        const res = await request(app).get('/');

        expect(res.status).toBe(200);
        expect(res.text).toContain('<html');
    });
});
