'use strict';

const express = require('express');
const { readState, writeState } = require('../lib/db');

const router = express.Router();

router.get('/', (req, res) => {
    res.json(readState());
});

router.post('/', (req, res) => {
    const success = writeState(req.body);
    if (success) {
        res.json({ message: 'State successfully updated.', state: req.body });
    } else {
        res.status(500).json({ error: 'Failed to write database state.' });
    }
});

module.exports = router;
