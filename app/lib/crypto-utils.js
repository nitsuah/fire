'use strict';

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY = process.env.SYNC_MASTER_KEY
    ? Buffer.from(process.env.SYNC_MASTER_KEY, 'hex')
    : crypto.randomBytes(32);

function encrypt(text) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(text) {
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
