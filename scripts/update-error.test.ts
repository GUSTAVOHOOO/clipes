import { describe, expect, it } from 'bun:test';
import {
  formatUpdateError,
  isConnectivityError,
  isSignatureOrIntegrityError,
  shouldIgnoreAutoCheckError,
} from '../src/features/updates/updateError';

const NOTICE = 'Atualizações sem assinatura válida são recusadas.';

describe('UpdateNotice error classification', () => {
  it('ignores connectivity and offline errors during automatic startup check', () => {
    const connectivityErrors = [
      new Error('error sending request for url (https://github.com/GUSTAVOHOOO/clipes/releases/latest/download/latest.json): client error (Connect)'),
      new Error('Could not fetch a valid release JSON from the remote'),
      new Error('dns error: failed to lookup address information'),
      new Error('operation timed out'),
      new TypeError('Failed to fetch'),
      'ERR_INTERNET_DISCONNECTED',
    ];

    for (const err of connectivityErrors) {
      expect(isConnectivityError(err, true)).toBe(true);
      expect(isSignatureOrIntegrityError(err)).toBe(false);
      expect(shouldIgnoreAutoCheckError(err, true)).toBe(true);
      expect(formatUpdateError(err, NOTICE)).not.toContain(NOTICE);
    }

    expect(shouldIgnoreAutoCheckError(new Error('unexpected failure'), false)).toBe(true);
  });

  it('surfaces real signature and integrity failures with the signature notice', () => {
    const signatureErrors = [
      new Error('The signature verification failed'),
      new Error('The signature was created with a different key than the one provided'),
      new Error('Invalid encoding in minisign data'),
      new Error('The update was signed for version 0.1.0 but the update endpoint announced version 0.2.0.'),
      new Error('The update signature does not specify the version it was signed for, which `requireSignedVersion` requires.'),
      new Error('invalid updater binary format'),
    ];

    for (const err of signatureErrors) {
      expect(isConnectivityError(err, true)).toBe(false);
      expect(isSignatureOrIntegrityError(err)).toBe(true);
      expect(shouldIgnoreAutoCheckError(err, true)).toBe(false);
      expect(formatUpdateError(err, NOTICE)).toContain(NOTICE);
    }
  });
});
