'use strict';

const express = require('express');
const { readState, mutateState } = require('../lib/db');
const { decodeVin, estimateVehicleValue } = require('../lib/vehicle-api');

const router = express.Router();

router.get('/vin/:vin', async (req, res) => {
    try {
        const info = await decodeVin(req.params.vin);
        res.json(info);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/:id/refresh-value', async (req, res) => {
    const db = readState();
    const vehicle = (db.vehicles || []).find((v) => v.id === req.params.id);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found.' });

    if (!vehicle.vin) {
        return res.status(400).json({
            error: 'Vehicle has no VIN. Add a VIN to enable automatic value refresh.',
        });
    }

    try {
        const estimate = await estimateVehicleValue(vehicle.vin, vehicle.mileage);
        const updated = {
            ...vehicle,
            vinInfo: estimate.vinInfo || vehicle.vinInfo,
            valueLastRefreshed: new Date().toISOString(),
            valueSource: estimate.estimated ? estimate.provider : 'manual',
        };
        if (estimate.estimated && estimate.value != null) {
            updated.currentValue = estimate.value;
        }
        const ok = await mutateState((state) => {
            if (!state.vehicles) state.vehicles = [];
            const idx = state.vehicles.findIndex((v) => v.id === req.params.id);
            if (idx !== -1) state.vehicles[idx] = updated;
        });
        if (!ok) return res.status(500).json({ error: 'Failed to update vehicle.' });
        res.json({
            ...updated,
            valueEstimate: estimate,
        });
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
});

module.exports = router;
