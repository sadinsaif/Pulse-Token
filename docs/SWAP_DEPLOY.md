# PULSE Swap — Devnet Deploy Guide (Solana Playground)

এই AMM (swap) প্রোগ্রামটা **devnet**-এ deploy করতে হবে ব্রাউজার থেকেই — কিছু ইনস্টল করা লাগবে না।
আমি (Claude) deploy করতে পারি না (এই মেশিনে Solana toolchain নেই), তাই এই একটামাত্র ধাপ **আপনি** করবেন।
staking-এর সময় যেভাবে করেছিলেন, ঠিক সেভাবেই — আমি প্রতিটা ক্লিক ধরে ধরে লিখে দিলাম।

> 🔒 **নিরাপত্তা:** Playground যে wallet বানাবে তার **secret key / seed phrase কখনো কাউকে দেবেন না — আমাকেও না।**
> শেষে আমাকে শুধু **একটা public জিনিস** পাঠাবেন: **Program ID**। এটা public — গোপন কিছু নয়।
> (IDL পাঠানো লাগবে না — swap client-এর discriminator আমি কোড থেকেই হিসাব করে বসাই, ঠিক staking-এর মতো।)

---

## ০) দরকারি জিনিস
- একটা ব্রাউজার (Chrome/Brave/Edge)।
- আমাদের প্রোগ্রামের কোড: রিপোর এই দুটো ফাইল —
  - `anchor/pulse_swap/src/lib.rs`  ← পুরো Rust কোড
  - `anchor/pulse_swap/Cargo.toml`  ← dependency লাইনগুলো (রেফারেন্স)

> ℹ️ এটা staking প্রোগ্রামের থেকে **আলাদা একটা নতুন প্রোগ্রাম** — নতুন Playground project বানাবেন, নতুন Program ID পাবেন।
> staking-এর `52J8…` প্রোগ্রামে হাত দেবেন না; ওটা live আছে।

---

## ১) Playground খুলুন ও নতুন Anchor project বানান
1. যান: **https://beta.solpg.io**
2. **"Create a new project"** → framework **Anchor (Rust)** বেছে নিন → নাম দিন `pulse_swap` → Create।

## ২) Playground wallet + devnet
1. নিচে-বাঁয়ে **wallet আইকন**-এ ক্লিক করুন → একটা **Playground wallet** তৈরি হবে (throwaway, শুধু deploy fee-র জন্য)। **Connect** করুন।
   - staking-এর সময় বানানো Playground wallet-টাও reuse করতে পারেন (তাতে SOL থাকলে airdrop কম লাগবে)।
2. নিচের **টার্মিনালে** cluster devnet কিনা দেখুন:
   ```
   solana config get
   ```
   devnet না থাকলে সেট করুন:
   ```
   solana config set --url devnet
   ```

## ৩) Deploy fee-র জন্য devnet SOL নিন
নিচের টার্মিনালে:
```
solana airdrop 2
```
- throttle/429 এলে কয়েকবার চেষ্টা করুন, অথবা **https://faucet.solana.com** এ **Devnet** বেছে Playground wallet-এর address পেস্ট করে SOL নিন (address জানতে টার্মিনালে `solana address`)।
- deploy-এ সাধারণত ~2–4 devnet SOL লাগে; দরকারে আরও airdrop নিন।

## ৪) আমাদের কোড বসান
1. বাঁয়ের **Explorer**-এ `src/lib.rs` খুলুন → ভেতরের **সব মুছে ফেলুন** → আমার পাঠানো `anchor/pulse_swap/src/lib.rs`-এর **পুরো** কোড পেস্ট করুন।
2. **Cargo.toml নিয়ে কিছু করতে হবে না।** এই প্রোগ্রাম কোনো special anchor feature (init-if-needed) ব্যবহার করে না, আর `anchor-spl` Playground-এ এমনিতেই সাপোর্টেড — কোডে `use anchor_spl::...` থাকলেই চলবে।
   > (Settings-এ Anchor version বেছে নেওয়ার অপশন থাকলে **0.30.1** রাখুন। ভিন্ন version-এ সমস্যা হলে আমাকে জানাবেন।)

## ৫) Build
1. বাঁয়ের **হাতুড়ি (Build)** আইকনে ক্লিক → **Build**।
2. **"update program id" / declare_id** আপডেটের প্রম্পট এলে → **Yes** দিন, তারপর আবার **Build** করুন।
3. কোনো **error** থাকলে সেটা আমাকে **হুবহু** পাঠান — আমি কোড ঠিক করে দেব। ⚠️ error না যাওয়া পর্যন্ত পরের ধাপে যাবেন **না** (build fail হলে পুরনো/template .so deploy হয়ে যেতে পারে — staking-এ একবার এই সমস্যা হয়েছিল)।

## ৬) Deploy
1. **রকেট (Deploy)** আইকনে ক্লিক → **Deploy**। (এখানে devnet SOL খরচ হয়।)
2. **"Deployment successful"** দেখালে হয়ে গেছে। (rate-limit-এ কয়েকবার retry লাগতে পারে — staking-এর মতোই।)

## ৭) আমাকে যা পাঠাবেন (একটা public জিনিস)
- **Program ID** — Build&Deploy ট্যাবে/`Program` প্যানেলে দেখাবে; অথবা টার্মিনালে:
  ```
  solana address -k target/deploy/pulse_swap-keypair.json
  ```

> ⚠️ **কখনো পাঠাবেন না:** কোনো secret key, seed phrase, বা `*-keypair.json` ফাইলের **ভেতরের** সংখ্যা-অ্যারে। শুধু উপরের **Program ID**।

---

## authority (pool-এর মালিক) wallet
- swap pool-এর **authority** হবে আপনার সেই **main wallet `hU7g65F7jkyryGGWXSYTE4SY6k94NeQYfnYkveuSvvN`** — যেটা staking-এও authority, যেটায় PLSX + devnet SOL আছে।
- সাইটে শুধু এই wallet-ই swap admin বাটন (Initialize / Add liquidity / Remove liquidity) দেখবে; আর কেউ না।
- **অন্য কোনো wallet** authority বানাতে চাইলে deploy-এর আগে আমাকে সেই public address-টা বলবেন — আমি config-এ বসিয়ে দেব।

## এরপর কী হবে (আমার কাজ + আপনার কাজ)
1. আপনি **Program ID** দিলে আমি প্রথমে keyless verify করব (প্রোগ্রামটা ঠিকঠাক deploy হয়েছে কিনা — কোনো সই ছাড়াই)।
2. তারপর আমি সাইটে client wire করব (`lib/swap.js`, `SwapPanel`, `SwapAdmin`) — কিন্তু Swap কার্ড তখনো **"Coming Soon"**-ই থাকবে (`features.swap=false`)।
3. এরপর আপনি **main wallet `hU7g65F…`** connect করে সাইটের admin প্যানেল থেকে —
   - **Initialize pool** (একবার; fee ঠিক করে, ডিফল্ট 0.30%),
   - **Add liquidity** — আসল PLSX + আসল devnet SOL দুটোই দেবেন (এই দুটোর অনুপাতই শুরুর দাম ঠিক করবে; যেমন 1000 PLSX + 1 SOL হলে শুরুতে 1 SOL ≈ 1000 PLSX)।
   - সবই আপনার wallet দিয়ে সই করা — কোনো secret আমি ছুঁই না।
4. reserve সত্যিই on-chain-এ আছে যাচাই করে **তবেই** আমি Swap কার্ডটা live করব (`features.swap=true`, devnet only)। তার আগ পর্যন্ত কোনো fake quote/price দেখাবে না — pool খালি থাকলে সৎভাবে "no liquidity yet" দেখাবে।

> 📌 **টীকা (devnet):** pool per-mint, তাই deploy-এর পর **যত দ্রুত সম্ভব নিজে Initialize** করে নেবেন — যাতে অন্য কেউ আগে init করে দিতে না পারে। devnet-এ ঝুঁকি কম, তবু মাথায় রাখবেন।

> 💡 **কত liquidity দেবেন:** devnet টেস্টের জন্য ছোট অঙ্কই যথেষ্ট (যেমন কয়েক হাজার PLSX + 1–2 SOL)। ফি দেওয়ার জন্য wallet-এ কিছু SOL আলাদা রেখে দেবেন।
