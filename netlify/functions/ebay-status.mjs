import ebayConnector from '../../app/lib/ebay-connector.js';
import { json, methodNotAllowed } from '../lib/http.mjs';

export default async function handler(req) {
    if (req.method !== 'GET') return methodNotAllowed('GET');
    return json(200, { configured: ebayConnector.isConfigured() });
}
