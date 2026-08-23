"use client";

import { useState } from "react";

// Honest, Devnet-accurate answers. No monetary-value claims, no trading, no
// fabricated team/dates. PULSE = project, PLSX = token ticker.
const ITEMS = [
  [
    "What is PULSE, and what is PLSX?",
    "PULSE is the project. PLSX is its token — a standard SPL token on Solana. When you see “PULSE — PLSX”, PULSE is the name and PLSX is the ticker.",
  ],
  [
    "Is PLSX live on Mainnet?",
    "Not yet. PLSX currently exists only on Solana Devnet while the ecosystem is being built and tested. A Mainnet launch has not happened.",
  ],
  [
    "Does PLSX have any monetary value?",
    "No. On Devnet, PLSX has no monetary value and is not for sale. Nothing here is financial or investment advice.",
  ],
  [
    "Can I buy or trade PLSX?",
    "No. There is no price, no liquidity, and no trading on Devnet. Ignore anyone offering to sell you “PLSX” — always verify against the official mint address shown on this site.",
  ],
  [
    "Is it safe to connect my wallet here?",
    "Yes. Connecting is read-only: the site reads your on-chain balance and never signs a transaction, moves funds, or asks for your private keys.",
  ],
  [
    "How do I verify the token is real?",
    "Every value on this site is read live from Solana. Open the mint address on Solana Explorer (links throughout the site) and confirm the supply, decimals, and authorities yourself.",
  ],
  [
    "When is the Mainnet launch?",
    "There is no date to announce yet. Tokenomics, allocation, and launch details will be published before Mainnet — no promises are made here in the meantime.",
  ],
];

/** Accessible single-open accordion (button + aria-expanded + region). */
export default function FAQ() {
  const [open, setOpen] = useState(-1);

  return (
    <div className="faq">
      {ITEMS.map(([q, a], i) => {
        const isOpen = open === i;
        return (
          <div className={`faq-item ${isOpen ? "open" : ""}`} key={q}>
            <button
              type="button"
              className="faq-q"
              aria-expanded={isOpen}
              aria-controls={`faq-a-${i}`}
              id={`faq-q-${i}`}
              onClick={() => setOpen(isOpen ? -1 : i)}
            >
              <span>{q}</span>
              <span className="faq-chev" aria-hidden="true">{isOpen ? "−" : "+"}</span>
            </button>
            <div
              className="faq-a"
              id={`faq-a-${i}`}
              role="region"
              aria-labelledby={`faq-q-${i}`}
              hidden={!isOpen}
            >
              <p>{a}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
