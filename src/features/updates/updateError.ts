export function errorReason(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

const SIGNATURE_OR_INTEGRITY_PATTERNS = [
  'signature',
  'assinatura',
  'minisign',
  'signed for version',
  'requiresignedversion',
  'does not specify the version',
  'different key',
  'invalid encoding',
  'invalid symbol',
  'invalid padding',
  '6-bit remainder',
  'invalid last symbol',
  'invalid updater binary format',
  'binary for the current target not found',
  'integrity',
  'integridade',
  'tamper',
  'checksum',
  'digest',
  'sha256',
  'sha-256',
  'pubkey',
];

const NETWORK_OR_CONNECTIVITY_PATTERNS = [
  'error sending request',
  'could not fetch a valid release json',
  'failed to fetch',
  'networkerror',
  'network error',
  'network is unreachable',
  'offline',
  'err_internet_disconnected',
  'internet disconnected',
  'dns',
  'lookup address',
  'no such host',
  'name or service not known',
  'temporary failure in name resolution',
  'eai_again',
  'enotfound',
  'econnrefused',
  'econnreset',
  'ehostunreach',
  'enetunreach',
  'etimedout',
  'connection refused',
  'connection reset',
  'connection aborted',
  'tcp connect error',
  'timed out',
  'timeout',
  'error decoding response body',
  'http status',
  'status code',
  'client error (connect)',
  'proxy',
  'tls',
  'ssl',
];

/** Returns true when an updater error comes from signature or package integrity verification. */
export function isSignatureOrIntegrityError(error: unknown): boolean {
  const lower = errorReason(error).toLowerCase();
  return SIGNATURE_OR_INTEGRITY_PATTERNS.some(pattern => lower.includes(pattern));
}

/** Returns true when the environment is offline or the error indicates a network/connectivity failure. */
export function isConnectivityError(
  error: unknown,
  online = typeof navigator === 'undefined' ? true : navigator.onLine,
): boolean {
  if (!online) return true;
  const lower = errorReason(error).toLowerCase();
  return NETWORK_OR_CONNECTIVITY_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Automatic startup checks silently ignore connectivity and non-signature errors,
 * reserving the error notice for genuine signature or integrity failures.
 */
export function shouldIgnoreAutoCheckError(
  error: unknown,
  online = typeof navigator === 'undefined' ? true : navigator.onLine,
): boolean {
  if (isConnectivityError(error, online)) return true;
  return !isSignatureOrIntegrityError(error);
}

/** Formats an updater error, appending the invalid-signature notice only for signature/integrity failures. */
export function formatUpdateError(error: unknown, invalidSignatureNotice: string): string {
  const reason = errorReason(error);
  if (isSignatureOrIntegrityError(error)) {
    return reason ? `${reason} ${invalidSignatureNotice}` : invalidSignatureNotice;
  }
  return reason;
}
