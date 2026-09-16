import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourceFile = join(here, '..', 'src', 'lib', 'walletProviders.ts');
const tscBin = join(here, '..', 'node_modules', '.bin', 'tsc');

let wallet;
let tmpDir;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'af-wallet-'));
  const tsconfig = {
    compilerOptions: {
      target: 'ES2020',
      module: 'commonjs',
      moduleResolution: 'node',
      esModuleInterop: true,
      skipLibCheck: true,
      strict: false,
      outDir: tmpDir,
    },
    include: [sourceFile],
  };
  writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify(tsconfig));
  execSync(`"${tscBin}" -p tsconfig.json`, { cwd: tmpDir, stdio: 'pipe' });
  const compiled = pathToFileURL(join(tmpDir, 'walletProviders.js')).href;
  const mod = await import(compiled);
  wallet = mod.default || mod;
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test('detectInjectedProviders returns nothing when no wallet is present', () => {
  assert.deepEqual(wallet.detectInjectedProviders(undefined), []);
  assert.deepEqual(wallet.detectInjectedProviders(null), []);
});

test('detectInjectedProviders returns a single provider when only window.ethereum exists', () => {
  const ethereum = { isMetaMask: true };
  const result = wallet.detectInjectedProviders(ethereum);
  assert.equal(result.length, 1);
  assert.equal(result[0].label, 'MetaMask');
  assert.equal(result[0].provider, ethereum);
});

test('detectInjectedProviders lists every provider from window.ethereum.providers and dedupes labels', () => {
  const metaMask = { isMetaMask: true };
  const brave = { isMetaMask: true, isBraveWallet: true };
  const coinbase = { isCoinbaseWallet: true };
  const okx = { isOkxWallet: true };
  const ethereum = { providers: [metaMask, brave, coinbase, okx] };

  const result = wallet.detectInjectedProviders(ethereum);
  const labels = result.map((item) => item.label);
  assert.equal(labels[0], 'MetaMask');
  assert.ok(labels.includes('Brave Wallet'), 'Brave Wallet option expected');
  assert.ok(labels.includes('Coinbase Wallet'), 'Coinbase Wallet option expected');
  assert.ok(labels.includes('OKX Wallet'), 'OKX Wallet option expected');
  assert.ok(result.some((item) => item.provider === brave), 'Brave must be selectable');
});

test('detectInjectedProviders never auto-selects a provider without user choice', () => {
  const metaMask = { isMetaMask: true };
  const coinbase = { isCoinbaseWallet: true };
  const result = wallet.detectInjectedProviders({ providers: [metaMask, coinbase] });
  assert.equal(result.length, 2);
  // The list returns both options; the caller decides which provider to connect.
  assert.ok(result.every((item) => item.provider && item.label));
});

test('requestWalletAccounts requests accounts explicitly', async () => {
  let requested = false;
  const provider = { request: async ({ method }) => { requested = true; return ['0xabc']; } };
  const accounts = await wallet.requestWalletAccounts(provider);
  assert.equal(requested, true);
  assert.deepEqual(accounts, ['0xabc']);
});

test('switchWalletNetwork maps the 4902 unsupported-chain error to a readable message', async () => {
  const provider = {
    request: async () => {
      const err = new Error('Unrecognized chain ID');
      err.code = 4902;
      throw err;
    },
  };
  await assert.rejects(() => wallet.switchWalletNetwork(provider, '0x38'), /not added to your wallet/);
});

test('switchWalletNetwork ignores a user-cancelled switch (code 4001)', async () => {
  const provider = {
    request: async () => {
      const err = new Error('User rejected the request.');
      err.code = 4001;
      throw err;
    },
  };
  await wallet.switchWalletNetwork(provider, '0x38');
});

test('NO_WALLET_MESSAGE guides the user to install a wallet', () => {
  assert.match(wallet.NO_WALLET_MESSAGE, /No browser wallet was detected/);
});