import crypto from 'node:crypto';

export function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sha256Object(value) {
  return sha256Text(JSON.stringify(value));
}
