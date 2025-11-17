import { encryptKey, decryptKey } from '../index';

const SECRET = 'test-secret-1234567890';

describe('Encryption helpers', () => {
  test('encrypt and decrypt returns original', () => {
    const plain = 'mySuperSecretKey';
    const encrypted = encryptKey(plain, SECRET);
    expect(encrypted).not.toBe(plain);
    const decrypted = decryptKey(encrypted, SECRET);
    expect(decrypted).toBe(plain);
  });
});
afterAll(async () => { try { await require('../index').gracefulShutdown(); } catch (e) { /* ignore */ } });
