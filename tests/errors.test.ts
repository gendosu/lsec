import { describe, it, expect } from 'vitest';
import { CryptoError, SecretNotFoundError, StoreError } from '../src/errors.js';

describe('CryptoError', () => {
  it('is an instance of Error and CryptoError', () => {
    const err = new CryptoError('master.key is corrupt (invalid size)');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CryptoError);
  });

  it('sets name to CryptoError', () => {
    const err = new CryptoError('decryption failed');
    expect(err.name).toBe('CryptoError');
  });

  it('preserves the message', () => {
    const err = new CryptoError('decryption failed: tampered ciphertext');
    expect(err.message).toBe('decryption failed: tampered ciphertext');
  });

  it('is not an instance of the other custom error classes', () => {
    const err = new CryptoError('boom');
    expect(err).not.toBeInstanceOf(SecretNotFoundError);
    expect(err).not.toBeInstanceOf(StoreError);
  });
});

describe('SecretNotFoundError', () => {
  it('is an instance of Error and SecretNotFoundError', () => {
    const err = new SecretNotFoundError('key "api-key" not found');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SecretNotFoundError);
  });

  it('sets name to SecretNotFoundError', () => {
    const err = new SecretNotFoundError('key "api-key" not found');
    expect(err.name).toBe('SecretNotFoundError');
  });

  it('preserves the message', () => {
    const err = new SecretNotFoundError('key "api-key" not found');
    expect(err.message).toBe('key "api-key" not found');
  });

  it('is not an instance of the other custom error classes', () => {
    const err = new SecretNotFoundError('boom');
    expect(err).not.toBeInstanceOf(CryptoError);
    expect(err).not.toBeInstanceOf(StoreError);
  });
});

describe('StoreError', () => {
  it('is an instance of Error and StoreError', () => {
    const err = new StoreError('secrets.json is corrupt');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StoreError);
  });

  it('sets name to StoreError', () => {
    const err = new StoreError('failed to write secrets.json');
    expect(err.name).toBe('StoreError');
  });

  it('preserves the message', () => {
    const err = new StoreError('failed to parse secrets.json');
    expect(err.message).toBe('failed to parse secrets.json');
  });

  it('is not an instance of the other custom error classes', () => {
    const err = new StoreError('boom');
    expect(err).not.toBeInstanceOf(CryptoError);
    expect(err).not.toBeInstanceOf(SecretNotFoundError);
  });
});
