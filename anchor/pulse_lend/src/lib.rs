// PULSE lend — a REAL on-chain money-market for devnet: SOL collateral -> borrow PLSX.
//
// Model (authority-seeded, single market):
//   * The authority seeds a PLSX lending pool (a PDA-owned SPL token vault). Only the
//     authority supplies PLSX; regular users NEVER supply — they only deposit SOL
//     collateral, borrow PLSX against it, repay, and withdraw. This mirrors the swap
//     MVP (authority-only liquidity) and avoids audit-heavy supplier-share accounting.
//   * Collateral is NATIVE SOL held as lamports directly in the Market PDA (the same
//     program-owned-account pattern the swap pool uses for its SOL reserve).
//   * Borrowing accrues simple (linear) interest at an authority-set APR, settled
//     per-position on every interaction (settle-before-mutate), exactly like staking.
//   * PRICE ORACLE: the live PLSX/SOL price is read straight from OUR OWN pulse_swap
//     constant-product pool (market.swap_pool). We read its tracked reserves; the
//     Market pins the exact swap-pool key so no attacker can substitute a fake oracle.
//
// HONESTY / RISK (stated openly, never hidden):
//   * Because the oracle is a single on-chain AMM, the price is theoretically
//     manipulable (swap to move the ratio, then liquidate). For a DEVNET MVP this is
//     acceptable and disclosed; a TWAP / external oracle is future work ("Coming Soon").
//   * No admin secret lives on-chain or in the frontend. The "authority" is a normal
//     wallet; admin actions are plain signed transactions.
//   * User actions move the USER's own SOL/PLSX, signed by the USER's wallet only.
//   * The PLSX vault is a PDA owned by the Market PDA; only this program (signing with
//     the market seeds) can move PLSX out. SOL collateral lamports sit ON TOP of the
//     Market's rent-exempt minimum and are only ever paid out from tracked collateral,
//     so the account stays rent-exempt.
//
// Deploy this with Solana Playground (beta.solpg.io) on DEVNET — see
// docs/LEND_DEPLOY.md. Playground assigns the real program id on Build; the placeholder
// in declare_id!() below is updated automatically (accept the "update program id" prompt).

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("11111111111111111111111111111111"); // PLACEHOLDER (valid 32-byte id) — Playground updates it on Build; accept the "update program id" prompt

const BPS_DENOM: u128 = 10_000;
const SECONDS_PER_YEAR: u128 = 31_536_000;
const MAX_APR_BPS: u64 = 20_000; // hard cap 200% APR — no rug-tier rates
const MAX_LTV_BPS: u64 = 9_000; // never lend above 90% of collateral value

// Byte offsets of the pulse_swap `Pool` account (Anchor layout):
//   8 disc | mint 32 | authority 32 | fee_bps u16(2) | token_reserve u64(8) | sol_reserve u64(8) | ...
// token_reserve starts at 8+32+32+2 = 74; sol_reserve at 82. token_reserve == PLSX reserve.
const SWAP_TOKEN_RESERVE_OFFSET: usize = 74;
const SWAP_SOL_RESERVE_OFFSET: usize = 82;
const SWAP_MIN_LEN: usize = 90;

#[program]
pub mod pulse_lend {
    use super::*;

    /// Authority-only. Creates the Market config PDA + the PLSX lending vault (owned by
    /// the Market PDA). One market per PLSX mint. Pins the swap pool used as the oracle.
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        borrow_apr_bps: u64,
        ltv_bps: u64,
        liq_threshold_bps: u64,
        liq_bonus_bps: u64,
    ) -> Result<()> {
        require!(borrow_apr_bps <= MAX_APR_BPS, LendError::BadParam);
        require!(ltv_bps <= MAX_LTV_BPS, LendError::BadParam);
        // Liquidation must trigger ABOVE the borrow limit, else a fresh max-LTV loan is
        // instantly liquidatable. threshold must be in (ltv, 100%].
        require!(liq_threshold_bps > ltv_bps && liq_threshold_bps <= 10_000, LendError::BadParam);
        require!(liq_bonus_bps <= 2_000, LendError::BadParam); // bonus capped at 20%

        let m = &mut ctx.accounts.market;
        m.authority = ctx.accounts.authority.key();
        m.plsx_mint = ctx.accounts.mint.key();
        m.swap_pool = ctx.accounts.swap_pool.key();
        m.borrow_apr_bps = borrow_apr_bps;
        m.ltv_bps = ltv_bps;
        m.liq_threshold_bps = liq_threshold_bps;
        m.liq_bonus_bps = liq_bonus_bps;
        m.total_borrowed = 0;
        m.paused = false;
        m.bump = ctx.bumps.market;
        m.plsx_vault_bump = ctx.bumps.plsx_vault;
        Ok(())
    }

    /// Authority-only. Adjust risk params (same caps as init). Lets the operator tune
    /// APR/LTV or tighten liquidation without redeploying.
    pub fn set_params(
        ctx: Context<AdminOnly>,
        borrow_apr_bps: u64,
        ltv_bps: u64,
        liq_threshold_bps: u64,
        liq_bonus_bps: u64,
    ) -> Result<()> {
        require!(borrow_apr_bps <= MAX_APR_BPS, LendError::BadParam);
        require!(ltv_bps <= MAX_LTV_BPS, LendError::BadParam);
        require!(liq_threshold_bps > ltv_bps && liq_threshold_bps <= 10_000, LendError::BadParam);
        require!(liq_bonus_bps <= 2_000, LendError::BadParam);
        let m = &mut ctx.accounts.market;
        m.borrow_apr_bps = borrow_apr_bps;
        m.ltv_bps = ltv_bps;
        m.liq_threshold_bps = liq_threshold_bps;
        m.liq_bonus_bps = liq_bonus_bps;
        Ok(())
    }

    /// Authority-only. Emergency pause: blocks new borrows (repay / withdraw / liquidate
    /// stay open so users are never trapped).
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.market.paused = paused;
        Ok(())
    }

    /// Authority-only. Supply PLSX into the lending vault (the borrow-able pool).
    pub fn seed_pool(ctx: Context<SeedPool>, amount: u64) -> Result<()> {
        require!(amount > 0, LendError::ZeroAmount);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.authority_token.to_account_info(),
                    to: ctx.accounts.plsx_vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;
        Ok(())
    }

    /// Authority-only. Withdraw surplus PLSX from the lending vault (e.g. wind-down).
    /// The vault may still owe against outstanding loans; the operator is trusted here
    /// exactly as in the swap MVP (authority-only liquidity).
    pub fn withdraw_pool(ctx: Context<WithdrawPool>, amount: u64) -> Result<()> {
        require!(amount > 0, LendError::ZeroAmount);
        require!(amount <= ctx.accounts.plsx_vault.amount, LendError::InsufficientPool);
        let mint_key = ctx.accounts.market.plsx_mint;
        let bump = ctx.accounts.market.bump;
        let seeds: &[&[u8]] = &[b"market", mint_key.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.plsx_vault.to_account_info(),
                    to: ctx.accounts.authority_token.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;
        Ok(())
    }

    /// User creates their own Position PDA — one-time, before their first deposit. Kept
    /// separate so the program needs NO `init_if_needed` feature (simpler Playground
    /// build). The frontend sends this automatically the first time a wallet interacts.
    pub fn open_position(ctx: Context<OpenPosition>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let p = &mut ctx.accounts.position;
        p.owner = ctx.accounts.owner.key();
        p.collateral_lamports = 0;
        p.borrowed_plsx = 0;
        p.last_accrual_ts = now;
        p.bump = ctx.bumps.position;
        Ok(())
    }

    /// User deposits `lamports` of native SOL as collateral (SOL -> Market PDA).
    pub fn deposit_collateral(ctx: Context<DepositCollateral>, lamports: u64) -> Result<()> {
        require!(lamports > 0, LendError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;
        let apr = ctx.accounts.market.borrow_apr_bps;
        accrue(&mut ctx.accounts.position, apr, now)?;

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.market.to_account_info(),
                },
            ),
            lamports,
        )?;

        let p = &mut ctx.accounts.position;
        p.collateral_lamports = p.collateral_lamports.checked_add(lamports).ok_or(LendError::Overflow)?;
        Ok(())
    }

    /// User borrows `amount` PLSX against their SOL collateral. Reverts unless the new
    /// debt stays within LTV of the live collateral value (priced by the swap oracle).
    pub fn borrow(ctx: Context<Borrow>, amount: u64) -> Result<()> {
        require!(amount > 0, LendError::ZeroAmount);
        require!(!ctx.accounts.market.paused, LendError::Paused);
        require!(amount <= ctx.accounts.plsx_vault.amount, LendError::InsufficientPool);
        let now = Clock::get()?.unix_timestamp;
        let apr = ctx.accounts.market.borrow_apr_bps;
        accrue(&mut ctx.accounts.position, apr, now)?;

        // Live collateral value in PLSX, from our own swap pool reserves.
        let (plsx_res, sol_res) = read_oracle(&ctx.accounts.swap_pool, ctx.accounts.market.swap_pool)?;
        let collateral_plsx = mul_div(
            ctx.accounts.position.collateral_lamports as u128,
            plsx_res,
            sol_res,
        )?;
        let borrow_limit = mul_div(collateral_plsx, ctx.accounts.market.ltv_bps as u128, BPS_DENOM)?;

        let new_debt = (ctx.accounts.position.borrowed_plsx as u128)
            .checked_add(amount as u128)
            .ok_or(LendError::Overflow)?;
        require!(new_debt <= borrow_limit, LendError::ExceedsLtv);

        let mint_key = ctx.accounts.market.plsx_mint;
        let bump = ctx.accounts.market.bump;
        let seeds: &[&[u8]] = &[b"market", mint_key.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.plsx_vault.to_account_info(),
                    to: ctx.accounts.owner_token.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        ctx.accounts.position.borrowed_plsx =
            u64::try_from(new_debt).map_err(|_| LendError::Overflow)?;
        let m = &mut ctx.accounts.market;
        m.total_borrowed = m.total_borrowed.checked_add(amount).ok_or(LendError::Overflow)?;
        Ok(())
    }

    /// User repays up to their outstanding debt (PLSX -> vault). Overpayment is clamped
    /// to the exact debt so a borrower can always fully clear with a generous amount.
    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        require!(amount > 0, LendError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;
        let apr = ctx.accounts.market.borrow_apr_bps;
        accrue(&mut ctx.accounts.position, apr, now)?;

        let pay = amount.min(ctx.accounts.position.borrowed_plsx);
        require!(pay > 0, LendError::NothingToRepay);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.owner_token.to_account_info(),
                    to: ctx.accounts.plsx_vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            pay,
        )?;

        ctx.accounts.position.borrowed_plsx =
            ctx.accounts.position.borrowed_plsx.checked_sub(pay).ok_or(LendError::Overflow)?;
        let m = &mut ctx.accounts.market;
        m.total_borrowed = m.total_borrowed.saturating_sub(pay);
        Ok(())
    }

    /// User withdraws `lamports` of collateral, provided the remaining collateral still
    /// covers the outstanding debt within LTV (SOL -> user, Market PDA pays directly).
    pub fn withdraw_collateral(ctx: Context<WithdrawCollateral>, lamports: u64) -> Result<()> {
        require!(lamports > 0, LendError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;
        let apr = ctx.accounts.market.borrow_apr_bps;
        accrue(&mut ctx.accounts.position, apr, now)?;
        require!(lamports <= ctx.accounts.position.collateral_lamports, LendError::InsufficientCollateral);

        // Remaining collateral must still satisfy LTV against current debt.
        let remaining = ctx.accounts.position.collateral_lamports - lamports;
        if ctx.accounts.position.borrowed_plsx > 0 {
            let (plsx_res, sol_res) = read_oracle(&ctx.accounts.swap_pool, ctx.accounts.market.swap_pool)?;
            let remaining_plsx = mul_div(remaining as u128, plsx_res, sol_res)?;
            let borrow_limit = mul_div(remaining_plsx, ctx.accounts.market.ltv_bps as u128, BPS_DENOM)?;
            require!((ctx.accounts.position.borrowed_plsx as u128) <= borrow_limit, LendError::ExceedsLtv);
        }

        // Market PDA pays lamports out (program-owned account, direct debit).
        **ctx.accounts.market.to_account_info().try_borrow_mut_lamports()? -= lamports;
        **ctx.accounts.owner.to_account_info().try_borrow_mut_lamports()? += lamports;

        ctx.accounts.position.collateral_lamports =
            ctx.accounts.position.collateral_lamports.checked_sub(lamports).ok_or(LendError::Overflow)?;
        Ok(())
    }

    /// Anyone. Liquidate an unhealthy position: the liquidator repays the FULL debt in
    /// PLSX and seizes the borrower's SOL collateral worth (debt + liquidation bonus),
    /// capped at the available collateral. Only permitted once the debt exceeds the
    /// liquidation threshold of the collateral value.
    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let apr = ctx.accounts.market.borrow_apr_bps;
        accrue(&mut ctx.accounts.position, apr, now)?;

        let debt = ctx.accounts.position.borrowed_plsx;
        require!(debt > 0, LendError::NothingToRepay);

        let (plsx_res, sol_res) = read_oracle(&ctx.accounts.swap_pool, ctx.accounts.market.swap_pool)?;
        let collateral_plsx = mul_div(
            ctx.accounts.position.collateral_lamports as u128,
            plsx_res,
            sol_res,
        )?;
        // Liquidatable only when debt > collateral_value * liq_threshold.
        let liq_line = mul_div(collateral_plsx, ctx.accounts.market.liq_threshold_bps as u128, BPS_DENOM)?;
        require!((debt as u128) > liq_line, LendError::Healthy);

        // Liquidator repays the full debt (PLSX -> vault).
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.liquidator_token.to_account_info(),
                    to: ctx.accounts.plsx_vault.to_account_info(),
                    authority: ctx.accounts.liquidator.to_account_info(),
                },
            ),
            debt,
        )?;

        // Seize collateral worth (debt in SOL) * (1 + bonus), capped at the collateral.
        let debt_sol = mul_div(debt as u128, sol_res, plsx_res)?;
        let seize = mul_div(debt_sol, (BPS_DENOM + ctx.accounts.market.liq_bonus_bps as u128), BPS_DENOM)?;
        let seize_lamports =
            u64::try_from(seize.min(ctx.accounts.position.collateral_lamports as u128))
                .map_err(|_| LendError::Overflow)?;

        **ctx.accounts.market.to_account_info().try_borrow_mut_lamports()? -= seize_lamports;
        **ctx.accounts.liquidator.to_account_info().try_borrow_mut_lamports()? += seize_lamports;

        let p = &mut ctx.accounts.position;
        p.collateral_lamports = p.collateral_lamports.checked_sub(seize_lamports).ok_or(LendError::Overflow)?;
        p.borrowed_plsx = 0;
        let m = &mut ctx.accounts.market;
        m.total_borrowed = m.total_borrowed.saturating_sub(debt);
        Ok(())
    }
}

// ---- helpers ---------------------------------------------------------------

/// floor(a * b / d) in u128, erroring on overflow or zero divisor. Signer seeds for the
/// Market PDA are built INLINE at each call site (the bump byte needs a local home), the
/// same pattern the swap/staking programs use — see `borrow` / `withdraw_pool`.
fn mul_div(a: u128, b: u128, d: u128) -> Result<u128> {
    require!(d > 0, LendError::NoLiquidity);
    Ok(a
        .checked_mul(b)
        .ok_or(LendError::Overflow)?
        .checked_div(d)
        .ok_or(LendError::Overflow)?)
}

/// Read (plsx_reserve, sol_reserve) from the pinned pulse_swap pool account. Verifies
/// the account key matches the market's configured oracle so it can't be spoofed.
fn read_oracle(swap_pool: &AccountInfo, expected: Pubkey) -> Result<(u128, u128)> {
    require_keys_eq!(*swap_pool.key, expected, LendError::WrongOracle);
    let data = swap_pool.try_borrow_data()?;
    require!(data.len() >= SWAP_MIN_LEN, LendError::WrongOracle);
    let plsx = u64::from_le_bytes(
        data[SWAP_TOKEN_RESERVE_OFFSET..SWAP_TOKEN_RESERVE_OFFSET + 8].try_into().unwrap(),
    );
    let sol = u64::from_le_bytes(
        data[SWAP_SOL_RESERVE_OFFSET..SWAP_SOL_RESERVE_OFFSET + 8].try_into().unwrap(),
    );
    require!(plsx > 0 && sol > 0, LendError::NoLiquidity);
    Ok((plsx as u128, sol as u128))
}

/// Accrue simple (linear) interest on the position for the elapsed time, then stamp
/// last_accrual_ts = now. MUST be called before any debt mutation (settle-before-mutate).
///   interest = borrowed * apr_bps * dt / (10_000 * SECONDS_PER_YEAR)
fn accrue(position: &mut Account<'_, Position>, apr_bps: u64, now: i64) -> Result<()> {
    let dt = now.saturating_sub(position.last_accrual_ts);
    if dt > 0 && position.borrowed_plsx > 0 && apr_bps > 0 {
        let interest = (position.borrowed_plsx as u128)
            .checked_mul(apr_bps as u128).ok_or(LendError::Overflow)?
            .checked_mul(dt as u128).ok_or(LendError::Overflow)?
            .checked_div(BPS_DENOM).ok_or(LendError::Overflow)?
            .checked_div(SECONDS_PER_YEAR).ok_or(LendError::Overflow)?;
        let interest_u64 = u64::try_from(interest).map_err(|_| LendError::Overflow)?;
        position.borrowed_plsx =
            position.borrowed_plsx.checked_add(interest_u64).ok_or(LendError::Overflow)?;
    }
    position.last_accrual_ts = now;
    Ok(())
}

// ---- account contexts ------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: Account<'info, Mint>,
    /// CHECK: the pulse_swap pool used as the price oracle; only its key is stored and
    /// later re-verified in read_oracle. Not deserialized here.
    pub swap_pool: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Market::LEN,
        seeds = [b"market", mint.key().as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = authority,
        token::mint = mint,
        token::authority = market,
        seeds = [b"lend_plsx_vault", market.key().as_ref()],
        bump
    )]
    pub plsx_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"market", market.plsx_mint.as_ref()],
        bump = market.bump,
        has_one = authority
    )]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct SeedPool<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"market", market.plsx_mint.as_ref()],
        bump = market.bump,
        has_one = authority
    )]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"lend_plsx_vault", market.key().as_ref()], bump = market.plsx_vault_bump)]
    pub plsx_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = authority_token.mint == market.plsx_mint @ LendError::WrongMint,
        constraint = authority_token.owner == authority.key() @ LendError::WrongOwner
    )]
    pub authority_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawPool<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"market", market.plsx_mint.as_ref()],
        bump = market.bump,
        has_one = authority
    )]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"lend_plsx_vault", market.key().as_ref()], bump = market.plsx_vault_bump)]
    pub plsx_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = authority_token.mint == market.plsx_mint @ LendError::WrongMint,
        constraint = authority_token.owner == authority.key() @ LendError::WrongOwner
    )]
    pub authority_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"market", market.plsx_mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = owner,
        space = 8 + Position::LEN,
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositCollateral<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"market", market.plsx_mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        has_one = owner
    )]
    pub position: Account<'info, Position>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Borrow<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"market", market.plsx_mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        has_one = owner
    )]
    pub position: Account<'info, Position>,
    #[account(mut, seeds = [b"lend_plsx_vault", market.key().as_ref()], bump = market.plsx_vault_bump)]
    pub plsx_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = owner_token.mint == market.plsx_mint @ LendError::WrongMint,
        constraint = owner_token.owner == owner.key() @ LendError::WrongOwner
    )]
    pub owner_token: Account<'info, TokenAccount>,
    /// CHECK: must equal market.swap_pool; verified in read_oracle before use.
    #[account(constraint = swap_pool.key() == market.swap_pool @ LendError::WrongOracle)]
    pub swap_pool: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"market", market.plsx_mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        has_one = owner
    )]
    pub position: Account<'info, Position>,
    #[account(mut, seeds = [b"lend_plsx_vault", market.key().as_ref()], bump = market.plsx_vault_bump)]
    pub plsx_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = owner_token.mint == market.plsx_mint @ LendError::WrongMint,
        constraint = owner_token.owner == owner.key() @ LendError::WrongOwner
    )]
    pub owner_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawCollateral<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"market", market.plsx_mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        has_one = owner
    )]
    pub position: Account<'info, Position>,
    /// CHECK: must equal market.swap_pool; verified in read_oracle before use.
    #[account(constraint = swap_pool.key() == market.swap_pool @ LendError::WrongOracle)]
    pub swap_pool: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,
    #[account(mut, seeds = [b"market", market.plsx_mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    /// The position being liquidated (any owner; NOT the signer).
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), position.owner.as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, Position>,
    #[account(mut, seeds = [b"lend_plsx_vault", market.key().as_ref()], bump = market.plsx_vault_bump)]
    pub plsx_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = liquidator_token.mint == market.plsx_mint @ LendError::WrongMint,
        constraint = liquidator_token.owner == liquidator.key() @ LendError::WrongOwner
    )]
    pub liquidator_token: Account<'info, TokenAccount>,
    /// CHECK: must equal market.swap_pool; verified in read_oracle before use.
    #[account(constraint = swap_pool.key() == market.swap_pool @ LendError::WrongOracle)]
    pub swap_pool: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

// ---- state -----------------------------------------------------------------

#[account]
pub struct Market {
    pub authority: Pubkey,
    pub plsx_mint: Pubkey,
    pub swap_pool: Pubkey,
    pub borrow_apr_bps: u64,
    pub ltv_bps: u64,
    pub liq_threshold_bps: u64,
    pub liq_bonus_bps: u64,
    pub total_borrowed: u64,
    pub paused: bool,
    pub bump: u8,
    pub plsx_vault_bump: u8,
}
impl Market {
    pub const LEN: usize = 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 1;
}

#[account]
pub struct Position {
    pub owner: Pubkey,
    pub collateral_lamports: u64,
    pub borrowed_plsx: u64,
    pub last_accrual_ts: i64,
    pub bump: u8,
}
impl Position {
    pub const LEN: usize = 32 + 8 + 8 + 8 + 1;
}

#[error_code]
pub enum LendError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Token account mint does not match the market mint")]
    WrongMint,
    #[msg("Token account owner does not match the signer")]
    WrongOwner,
    #[msg("Lending pool has insufficient PLSX")]
    InsufficientPool,
    #[msg("Insufficient collateral")]
    InsufficientCollateral,
    #[msg("Borrow would exceed the allowed loan-to-value")]
    ExceedsLtv,
    #[msg("Nothing to repay")]
    NothingToRepay,
    #[msg("Position is healthy and cannot be liquidated")]
    Healthy,
    #[msg("Oracle pool account does not match the configured swap pool")]
    WrongOracle,
    #[msg("Oracle pool has no liquidity")]
    NoLiquidity,
    #[msg("Invalid risk parameter")]
    BadParam,
    #[msg("Borrowing is paused")]
    Paused,
}
