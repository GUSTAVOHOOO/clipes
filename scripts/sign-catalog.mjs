import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const tag = process.env.RELEASE_TAG ?? '';
const keyInput = process.env.CATALOG_SIGNING_KEY ?? '';
const outDir = process.argv[2] ?? 'dist-catalog';

const match = /^catalog-(\d+)$/.exec(tag);
if (!match) {
  throw new Error(`Invalid catalog release tag "${tag}"; expected catalog-<N>.`);
}
const tagVersion = Number(match[1]);
if (!Number.isSafeInteger(tagVersion) || tagVersion <= 0) {
  throw new Error(`Invalid catalog version in tag "${tag}".`);
}

if (!keyInput.trim()) {
  throw new Error('CATALOG_SIGNING_KEY is required.');
}

const catalogBytes = fs.readFileSync('catalog/models.json');
const catalog = JSON.parse(catalogBytes.toString('utf8'));
if (catalog.version !== tagVersion) {
  throw new Error(
    `catalog/models.json version (${catalog.version}) does not match tag version (${tagVersion}).`,
  );
}

const trimmedKey = keyInput.trim();
const privateKey = trimmedKey.includes('BEGIN PRIVATE KEY')
  ? crypto.createPrivateKey(trimmedKey)
  : (() => {
      if (!/^[0-9a-fA-F]{64}$/.test(trimmedKey)) {
        throw new Error('CATALOG_SIGNING_KEY must be a PKCS#8 PEM or 64-char hex Ed25519 seed.');
      }
      const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
      const der = Buffer.concat([pkcs8Header, Buffer.from(trimmedKey, 'hex')]);
      return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    })();

const derivedPubHex = crypto
  .createPublicKey(privateKey)
  .export({ type: 'spki', format: 'der' })
  .subarray(-32)
  .toString('hex');

const catalogRs = fs.readFileSync('core/src/components/catalog.rs', 'utf8');
const pubMatch = /CATALOG_PUBLIC_KEY_HEX:\s*&str\s*=\s*"([0-9a-fA-F]{64})"/.exec(catalogRs);
if (!pubMatch) {
  throw new Error('Could not find CATALOG_PUBLIC_KEY_HEX in core/src/components/catalog.rs.');
}
const pinnedPubHex = pubMatch[1].toLowerCase();
if (pinnedPubHex !== derivedPubHex) {
  throw new Error(
    `CATALOG_SIGNING_KEY public key (${derivedPubHex}) does not match CATALOG_PUBLIC_KEY_HEX (${pinnedPubHex}).`,
  );
}

const signature = crypto.sign(null, catalogBytes, privateKey);
const sigText = `${signature.toString('hex')}\n`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'catalog.json'), catalogBytes);
fs.writeFileSync(path.join(outDir, 'catalog.json.sig'), sigText, 'utf8');

console.log(`Signed catalog.json v${tagVersion} (${catalogBytes.length} bytes).`);
