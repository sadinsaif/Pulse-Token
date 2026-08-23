import "./globals.css";
import Providers from "@/components/Providers";
import WaveBackground from "@/components/WaveBackground";

const TOKEN_SYMBOL = process.env.NEXT_PUBLIC_TOKEN_SYMBOL || "PULSE";

export const metadata = {
  title: `$${TOKEN_SYMBOL} — a Solana utility token`,
  description:
    "$PULSE is a non-custodial Solana SPL utility token. Connect your Solana wallet to see your live on-chain $PULSE balance — read-only, no signing, no deposits. A utility token, not an investment.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400..800&family=Inter:wght@400..900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Animated decorative backdrop, matching the main app (see WaveBackground.js). */}
        <WaveBackground />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
