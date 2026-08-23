'use strict';

const express = require('express');
const { readState, mutateState } = require('../lib/db');
const { decodeVin, estimateVehicleValue } = require('../lib/vehicle-api');

const router = express.Router();

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;

router.get('/vin/:vin', async (req, res) => {
    if (!VIN_RE.test(req.params.vin)) {
        return res.status(400).json({
            error: 'VIN must be exactly 17 alphanumeric characters (I, O, Q excluded).',
        });
    }
    try {
        const info = await decodeVin(req.params.vin);
        res.json(info);
    } catch (err) {
        res.status(err.status || 400).json({ error: err.message });
    }
});

// Returns combined depreciation + market estimates without writing to db.
// Caller decides whether to accept the suggested value.
router.get('/:id/estimate', async (req, res) => {
    const db = readState();
    const vehicle = (db.vehicles || []).find((v) => v.id === req.params.id);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found.' });

    if (!vehicle.purchasePrice && !vehicle.vin) {
        return res.status(400).json({
            error: 'Vehicle needs a purchase price (for depreciation) or a VIN (for market lookup) to estimate value.',
        });
    }

    try {
        const result = await estimateVehicleValue(vehicle);
        res.json(result);
    } catch (err) {
        res.status(err.status || 502).json({ error: err.message });
    }
});

// Accepts the suggested value and writes it back to state.
router.post('/:id/accept-estimate', async (req, res) => {
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Request body is required.' });
    }
    const { value } = req.body;
    const accepted = parseFloat(value);
    if (!Number.isFinite(accepted) || accepted < 0) {
        return res.status(400).json({ error: 'A valid value is required.' });
    }

    let notFound = false;
    let updated = null;
    const ok = await mutateState((state) => {
        const idx = (state.vehicles || []).findIndex(
            (v) => v.id === req.params.id,
        );
        if (idx === -1) {
            notFound = true;
            return;
        }
        state.vehicles[idx] = {
            ...state.vehicles[idx],
            currentValue: accepted,
            valueLastRefreshed: new Date().toISOString(),
            valueSource: req.body.source || 'estimate',
        };
        updated = state.vehicles[idx];
    });

    if (notFound) return res.status(404).json({ error: 'Vehicle not found.' });
    if (!ok)
        return res.status(500).json({ error: 'Failed to update vehicle.' });
    res.json(updated);
});

module.exports = router;
