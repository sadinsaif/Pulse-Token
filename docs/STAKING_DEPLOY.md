# PULSE Staking — Devnet Deploy Guide (Solana Playground)

এই প্রোগ্রামটা **devnet**-এ deploy করতে হবে ব্রাউজার থেকেই — কোনো কিছু ইনস্টল করা লাগবে না।
আমি (Claude) deploy করতে পারি না (এই মেশিনে Solana toolchain নেই), তাই এই একটামাত্র ধাপ **আপনি** করবেন।
আমি প্রতিটা ক্লিক ধরে ধরে লিখে দিলাম।

> 🔒 **নিরাপত্তা:** Playground যে wallet বানাবে তার **secret key / seed phrase কখনো কাউকে দেবেন না — আমাকেও না।**
> আপনি আমাকে শেষে শুধু **তিনটা public জিনিস** পাঠাবেন: (1) Program ID, (2) `pulse_staking.json` (IDL), (3) আপনার
> **main wallet-এর public address** (যেটায় PLSX আছে / যেটা mint authority)। এগুলো সবই public — গোপন কিছু নয়।

---

## ০) দরকারি জিনিস
- একটা ব্রাউজার (Chrome/Brave/Edge)।
- আমাদের প্রোগ্রামের কোড: এই রিপোর দুটো ফাইল —
  - `anchor/pulse_staking/src/lib.rs`  ← পুরো Rust কোড
  - `anchor/pulse_staking/Cargo.toml`  ← dependency লাইনগুলো (রেফারেন্স)

---

## ১) Playground খুলুন ও Anchor project বানান
1. যান: **https://beta.solpg.io**
2. উপরে/স্ক্রিনে **"Create a new project"** → framework **Anchor (Rust)** বেছে নিন → নাম দিন `pulse_staking` → Create।

## ২) Playground wallet + devnet
1. নিচে-বাঁয়ে **wallet আইকন**-এ ক্লিক করুন → একটা **Playground wallet** তৈরি হবে (এটা throwaway, শুধু deploy fee দেওয়ার জন্য)। **Connect** করুন।
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
- থ্রটল/429 এলে কয়েকবার চেষ্টা করুন, অথবা **https://faucet.solana.com** এ গিয়ে **Devnet** বেছে Playground wallet-এর address পেস্ট করে SOL নিন (address জানতে টার্মিনালে `solana address`)।
- deploy-এ সাধারণত ~2–4 devnet SOL লাগতে পারে; দরকারে আরও airdrop নিন।

## ৪) আমাদের কোড বসান
1. বাঁয়ের **Explorer**-এ `src/lib.rs` খুলুন → ভেতরের **সব মুছে ফেলুন** → আমার পাঠানো `lib.rs`-এর **পুরো** কোড পেস্ট করুন।
2. **Cargo.toml নিয়ে কিছু করতে হবে না।** এই প্রোগ্রাম কোনো special anchor feature (init-if-needed) ব্যবহার করে না, আর `anchor-spl` Playground-এ এমনিতেই সাপোর্টেড — শুধু কোডে `use anchor_spl::...` থাকলেই চলবে।
   > (যদি Settings-এ Anchor version বেছে নেওয়ার অপশন থাকে, **0.30.1** রাখুন। ভিন্ন version হলেও সমস্যা হলে আমাকে জানাবেন।)

## ৫) Build
1. বাঁয়ের **হাতুড়ি (Build)** আইকনে ক্লিক → **Build**।
2. যদি **"update program id" / declare_id** আপডেটের প্রম্পট আসে → **Yes** দিন, তারপর আবার **Build** করুন।
3. কোনো **error** থাকলে সেটা আমাকে হুবহু পাঠান — আমি কোড ঠিক করে দেব। error না যাওয়া পর্যন্ত পরের ধাপে যাবেন না।

## ৬) Deploy
1. **রকেট (Deploy)** আইকনে ক্লিক → **Deploy**। (এখানে devnet SOL খরচ হয় — তাই ধাপ ৩ দরকার ছিল।)
2. **"Deployment successful"** দেখালে হয়ে গেছে।

## ৭) আমাকে যা পাঠাবেন (তিনটা public জিনিস)
1. **Program ID** — Build&Deploy ট্যাবে/`Program` প্যানেলে দেখাবে; অথবা টার্মিনালে:
   ```
   solana address -k target/deploy/pulse_staking-keypair.json
   ```
2. **IDL (`pulse_staking.json`)** — Build-এর পর `target/idl/pulse_staking.json` তৈরি হয়। Explorer-এ ওই ফাইল খুলে **পুরো JSON কপি** করুন (অথবা ডান-ক্লিক → Download / "Export IDL")। পুরোটা আমাকে পাঠান।
3. আপনার **main wallet-এর public address** — যেটায় PLSX আছে / যেটা PLSX mint authority (সাধারণত আপনার Phantom)। এটাই pool-এর **authority** হবে এবং সাইটে শুধু এই wallet-ই admin (Initialize/Fund) বাটন দেখবে।

> ⚠️ **কখনো পাঠাবেন না:** কোনো secret key, seed phrase, বা `*-keypair.json` ফাইলের **ভেতরের** সংখ্যা-অ্যারে। শুধু উপরের তিনটা public জিনিস।

---

## এরপর কী হবে (আমার কাজ)
- আপনি Program ID + IDL + main address দিলে আমি সাইটে client wire করব (`lib/staking.js`, StakePanel, admin panel) — কিন্তু Stake কার্ড তখনো **"Coming Soon"**-ই থাকবে।
- তারপর আপনি **main wallet** connect করে সাইটের admin প্যানেল থেকে **Initialize pool** + **Fund rewards** (আসল PLSX) করবেন — সবই আপনার wallet দিয়ে সই করা।
  - Reward-এর জন্য PLSX দরকার হলে, আপনি mint authority হিসেবে নিজের wallet-এ PLSX mint করে নিতে পারবেন (এটা বৈধ, আপনার নিজের devnet token)।
- সব ঠিকঠাক কাজ করছে devnet-এ যাচাই করে **তবেই** আমি Stake কার্ডটা live করব।

> 📌 **টীকা (devnet):** যেহেতু pool per-mint, deploy করার পর **যত দ্রুত সম্ভব নিজে Initialize** করে নেবেন — যাতে অন্য কেউ আগে init করে ফেলতে না পারে। devnet টেস্টিং-এ ঝুঁকি কম, তবু এটা মাথায় রাখবেন।
