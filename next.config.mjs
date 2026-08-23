/** @type {import('next').NextConfig} */

// The standalone token site only talks to Solana RPC from the browser (to read an
// on-chain balance) and loads Google Fonts. Keep the CSP tight but Report-Only for
// now — like the main app — so a missing origin logs instead of breaking the page.
// Flip the header name to "Content-Security-Policy" to enforce once the console is
// clean. If you set NEXT_PUBLIC_SOLANA_RPC to a dedicated provider, add its host to
// connect-src below.
const RPC_CONNECT = [
  "https://api.devnet.solana.com",
  "https://api.mainnet-beta.solana.com",
  "https://api.testnet.solana.com",
  "https://*.solana.com",
  "wss://api.devnet.solana.com",
  "wss://api.mainnet-beta.solana.com",
  "wss://*.solana.com",
  "https://*.helius-rpc.com",
  "wss://*.helius-rpc.com",
  "https://*.quiknode.pro",
  "wss://*.quiknode.pro",
  "https://*.g.alchemy.com",
  "wss://*.g.alchemy.com",
];

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  `connect-src 'self' ${RPC_CONNECT.join(" ")}`,
  "frame-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy-Report-Only", value: csp }],
      },
    ];
  },
};

export default nextConfig;
