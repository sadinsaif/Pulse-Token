// ============================================================================
// Backend TREASURY faucet — self-service test SOL that actually works.
// ============================================================================
//
// The public Solana faucet (connection.requestAirdrop) is heavily throttled and
// often returns "Internal error" on Testnet, so users can't reliably get test
// SOL. This route instead transfers a small, fixed amount of test SOL from a
// USER-FUNDED throwaway "treasury" wallet straight to the requester — no public
// faucet dependency, so it works as long as the treasury has a balance.
//
// SECURITY / HONESTY (non-negotiable):
//   • The treasury secret key is read ONLY here, on the server, from a
//     NON-public env var (FAUCET_SECRET_KEY). It is NEVER shipped to the browser
//     and NEVER logged. The frontend holds no key.
//   • This TRANSFERS pre-funded SOL — it never mints. The treasury's finite
//     balance is itself a hard spend cap; when empty we say so honestly.
//   • The recipient wallet never signs anything — a faucet transfer is signed by
//     the treasury key only. No user seed/secret is ever touched.
//   • Rate limit: 1 claim / wallet / 24h, plus per-IP. Durable across the whole
//     fleet when a KV (Vercel KV / Upstash) is configured; best-effort in-memory
//     otherwise. The client also keeps its own 24h guard for instant UX.
//   • On failure we return the REAL reason — never a fake "success".
//
// Runs on the Node runtime (web3.js Keypair signing needs Node, not Edge) and is
// always dynamic (never prerendered/cached).

import { NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- server-only config (NONE of these are NEXT_PUBLIC_) -------------------
const PUBLIC_RPC = {
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};
const FAUCET_CLUSTER = process.env.FAUCET_CLUSTER || "testnet";
const FAUCET_RPC = process.env.FAUCET_RPC || PUBLIC_RPC[FAUCET_CLUSTER] || PUBLIC_RPC.testnet;
const AMOUNT_SOL = Number(process.env.FAUCET_AMOUNT_SOL || "0.1");
const TRANSFER_LAMPORTS = Math.max(1, Math.round(AMOUNT_SOL * LAMPORTS_PER_SOL));
const FEE_BUFFER_LAMPORTS = 10_000; // leave room for the tx fee the treasury pays
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

// ---- durable-or-best-effort rate limit (zero extra dependency) -------------
const KV_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const KV_ENABLED = Boolean(KV_URL && KV_TOKEN);

// Per-instance fallback store: key -> expiresAtMs. Persists only within a warm
// serverless instance, so it's best-effort unless a KV is configured.
const memStore = new Map();

async function kvFetch(path) {
  const res = await fetch(`${KV_URL}/${path}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`KV ${res.status}`);
  return res.json(); // { result: <string|null> }
}

// Returns the expiry timestamp (ms) if the key is currently limited, else 0.
async function limitGet(key) {
  if (KV_ENABLED) {
    try {
      const { result } = await kvFetch(`get/${encodeURIComponent(key)}`);
      return result ? Number(result) : 0;
    } catch {
      return 0; // never hard-block users on a KV hiccup
    }
  }
  const exp = memStore.get(key) || 0;
  if (exp && exp <= Date.now()) {
    memStore.delete(key);
    return 0;
  }
  return exp;
}

async function limitSet(key, ttlMs) {
  const expiresAt = Date.now() + ttlMs;
  if (KV_ENABLED) {
    try {
      await kvFetch(`setex/${encodeURIComponent(key)}/${Math.ceil(ttlMs / 1000)}/${expiresAt}`);
    } catch {
      /* ignore — best effort */
    }
    return;
  }
  memStore.set(key, expiresAt);
}

// ---- helpers ---------------------------------------------------------------
function isValidAddress(value) {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

/** Load the treasury keypair from a JSON byte-array secret. null (never throws
 *  or logs the secret) when unset/malformed. */
function loadFaucet() {
  const raw = process.env.FAUCET_SECRET_KEY;
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch {
    return null; // do NOT surface the secret in any error
  }
}

function clientIp(req) {
  const xff = req.headers.get("x-forwarded-for") || "";
  const ip = xff.split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  return ip;
}

function json(body, status = 200) {
  return NextResponse.json(body, { status });
}

// ---- POST /api/faucet  { address, cluster } --------------------------------
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: "bad-request", message: "Invalid request body." }, 400);
  }

  const address = typeof body?.address === "string" ? body.address.trim() : "";
  const cluster = typeof body?.cluster === "string" ? body.cluster.trim() : FAUCET_CLUSTER;

  // 1) Valid recipient?
  if (!address || !isValidAddress(address)) {
    return json({ ok: false, reason: "bad-address", message: "A valid wallet address is required." }, 400);
  }

  // 2) Does the treasury even serve this cluster? (checked before load so the
  //    UI can fall back to the keyless public faucet for other clusters.)
  if (cluster !== FAUCET_CLUSTER) {
    return json({ ok: false, reason: "wrong-cluster", cluster: FAUCET_CLUSTER });
  }

  // 3) Treasury configured? If not, tell the UI so it can fall back gracefully.
  const faucet = loadFaucet();
  if (!faucet) {
    return json({ ok: false, reason: "not-configured", cluster: FAUCET_CLUSTER });
  }

  // 4) Never fund the treasury's own address.
  if (address === faucet.publicKey.toBase58()) {
    return json({ ok: false, reason: "bad-address", message: "That address cannot be used." }, 400);
  }

  // 5) Rate limit: per-wallet AND per-IP (skip IP bucket when IP is unknown).
  const ip = clientIp(req);
  const walletKey = `w_${FAUCET_CLUSTER}_${address}`;
  const ipKey = ip ? `ip_${FAUCET_CLUSTER}_${ip.replace(/[^A-Za-z0-9]/g, "_")}` : "";
  const wExp = await limitGet(walletKey);
  const ipExp = ipKey ? await limitGet(ipKey) : 0;
  const limitedUntil = Math.max(wExp, ipExp);
  if (limitedUntil > Date.now()) {
    return json({ ok: false, reason: "cooldown", retryAfterMs: limitedUntil - Date.now() });
  }

  // 6) Transfer from the treasury.
  try {
    const conn = new Connection(FAUCET_RPC, "confirmed");
    const balance = await conn.getBalance(faucet.publicKey);
    if (balance < TRANSFER_LAMPORTS + FEE_BUFFER_LAMPORTS) {
      return json({ ok: false, reason: "empty", message: "The faucet treasury is temporarily empty." });
    }

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: faucet.publicKey,
        toPubkey: new PublicKey(address),
        lamports: TRANSFER_LAMPORTS,
      })
    );
    const signature = await sendAndConfirmTransaction(conn, tx, [faucet], {
      commitment: "confirmed",
    });

    // Only burn the cooldown on a real, confirmed success.
    await limitSet(walletKey, COOLDOWN_MS);
    if (ipKey) await limitSet(ipKey, COOLDOWN_MS);

    return json({ ok: true, signature, amountSol: AMOUNT_SOL, cluster: FAUCET_CLUSTER });
  } catch (e) {
    const raw = e?.message || String(e);
    // Surface a real (but bounded) reason — never a fake success.
    return json({ ok: false, reason: "tx-failed", message: raw.slice(0, 200) });
  }
}

// A stray GET (or crawler) shouldn't 500 — return a tiny honest status.
export async function GET() {
  return json({ ok: true, service: "faucet", method: "POST", cluster: FAUCET_CLUSTER, amountSol: AMOUNT_SOL });
}
