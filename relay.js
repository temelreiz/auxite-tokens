import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';

const app = express();
const GOLDAPI = process.env.GOLDAPI_BASE || 'https://www.goldapi.io/api';
const KEY = process.env.GOLDAPI_KEY;

if (!KEY) {
  console.error('❌ GOLDAPI_KEY eksik (.env)');
  process.exit(1);
}

app.get('/price/:metal', async (req, res) => {
  try {
    const sym = req.params.metal.toUpperCase();
    const r = await fetch(`${GOLDAPI}/${sym}/USD`, {
      headers: { 'x-access-token': KEY },
      timeout: 5000
    });
    if (!r.ok) return res.status(r.status).json({ error: 'provider_error' });
    const d = await r.json();
    return res.json({
      provider: 'goldapi',
      metal: sym,
      usd_per_oz: d.price,
      ts: d.timestamp
    });
  } catch (e) {
    console.error('GoldAPI error:', e);
    return res.status(502).json({ error: 'upstream_error' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.listen(8080, () => console.log('✅ Relay up on :8080'));
JS

cat > update-oracle.mjs <<'JS'
import 'dotenv/config';
import fetch from 'node-fetch';
import { ethers } from 'ethers';
const RELAY = process.env.RELAY_URL || 'http://localhost:8080';
const RPC_URL = process.env.RPC_URL;
const PK = process.env.PRIVATE_KEY;
const NETWORK = process.env.NETWORK || 'sepolia';
const SYMBOLS = (process.env.SYMBOLS || 'XAU,XAG,XPT,XPD').split(',');

// TODO: adresleri doldur
const ORACLE_ADDRESSES = {
  XAU: process.env.ORACLE_XAU,
  XAG: process.env.ORACLE_XAG,
  XPT: process.env.ORACLE_XPT,
  XPD: process.env.ORACLE_XPD
};

// Minimal oracle ABI (setPricePerOzE6(uint256) & lastUpdated())
const ORACLE_ABI = [
  'function setPricePerOzE6(uint256 p) external',
  'function lastUpdated() view returns (uint256)'
];

if (!RPC_URL || !PK) {
  console.error('❌ RPC_URL veya PRIVATE_KEY eksik (.env)');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PK, provider);

function toE6(x) {
  return Math.round(Number(x) * 1e6);
}

for (const sym of SYMBOLS) {
  if (!ORACLE_ADDRESSES[sym]) {
    console.warn(`⚠️  ${sym} için ORACLE adresi yok, atlıyorum.`);
  }
}

async function updateSymbol(sym) {
  const url = `${RELAY}/price/${sym}`;
  const r = await fetch(url, { timeout: 5000 });
  if (!r.ok) throw new Error(`relay_error_${r.status}`);
  const { usd_per_oz } = await r.json();
  const priceE6 = toE6(usd_per_oz);

  const addr = ORACLE_ADDRESSES[sym];
  if (!addr) return;

  const oracle = new ethers.Contract(addr, ORACLE_ABI, wallet);
  const tx = await oracle.setPricePerOzE6(priceE6);
  console.log(`✅ ${sym} → ${priceE6} (E6) tx: ${tx.hash}`);
  await tx.wait();
}

(async () => {
  for (const s of SYMBOLS) {
    try { await updateSymbol(s); } 
    catch (e) { console.error(`❌ ${s} update failed:`, e.message); }
  }
})();
