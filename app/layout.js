import "./globals.css";
import Providers from "@/components/Providers";
import WaveBackground from "@/components/WaveBackground";

const SITE_URL = "https://pulse-token-six.vercel.app";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: "PULSE — PLSX | Solana Token",
  description:
    "PULSE (PLSX) is a Solana-based token project currently running on Devnet while the ecosystem is being developed and tested.",
  icons: {
    icon: "/token/logo.png",
    apple: "/token/logo.png",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    title: "PULSE — PLSX | Solana Token",
    description:
      "PULSE (PLSX) is a Solana-based token project currently running on Devnet while the ecosystem is being developed and tested.",
    siteName: "PULSE",
    images: [{ url: "/token/logo.png", width: 512, height: 512, alt: "PULSE (PLSX)" }],
  },
  twitter: {
    card: "summary",
    title: "PULSE — PLSX | Solana Token",
    description:
      "PULSE (PLSX) is a Solana-based token project currently running on Devnet while the ecosystem is being developed and tested.",
    images: ["/token/logo.png"],
  },
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
