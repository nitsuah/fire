'use strict';

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
    const raw = process.env.SYNC_MASTER_KEY;
    if (!raw) {
        throw new Error(
            'SYNC_MASTER_KEY is required for sync token encryption. ' +
                "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        );
    }
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
        throw new Error(
            'SYNC_MASTER_KEY must be exactly 64 hexadecimal characters (32 bytes).',
        );
    }
    return Buffer.from(raw, 'hex');
}

function encrypt(text) {
    const KEY = getKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(text) {
    const KEY = getKey();
    const [iv, authTag, encrypted] = text.split(':');
    const decipher = crypto.createDecipheriv(
        ALGORITHM,
        KEY,
        Buffer.from(iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

module.exports = { encrypt, decrypt };
