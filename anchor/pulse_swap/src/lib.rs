// PULSE swap — a REAL on-chain constant-product AMM for PLSX <-> native SOL on devnet.
//
// Model: a single liquidity pool holding PLSX (in a PDA-owned SPL token vault) and
// native SOL (as lamports held directly in the pool config PDA). Price is the pure
// constant-product invariant x*y=k:
//   * swap SOL -> PLSX and PLSX -> SOL at the live reserve ratio,
//   * a fee (default 0.30% = 30 bps, authority-adjustable, capped at 10%) is taken on
//     the INPUT and stays in the pool as extra reserve (so k grows — the classic
//     Uniswap-v2 fee-to-LP behaviour),
//   * every swap is slippage-protected: the caller passes min_out and the program
//     reverts if the computed output is below it.
//
// LIQUIDITY (MVP): only the pool `authority` may add/remove liquidity (add_liquidity /
// remove_liquidity are authority-gated). Regular users can only swap. There is NO
// public LP-share accounting — that is a larger, audit-heavy design and is deferred.
//
// SECURITY NOTES (why this is honest & safe):
//  * No admin secret lives anywhere on-chain or in the frontend. The "authority" is
//    just a normal wallet; admin actions (initialize/add/remove/set_fee) are plain
//    transactions signed by that wallet.
//  * Swaps move the USER's own SOL/PLSX, signed by the USER's wallet.
//  * The PLSX vault is a PDA owned by the pool PDA; only this program, signing with the
//    pool seeds, can move PLSX out of it. The SOL reserve is lamports held in the pool
//    PDA (owned by this program), so only this program can pay SOL out (direct lamport
//    debit). The pool is always kept rent-exempt (we only ever pay out from the tracked
//    `sol_reserve`, which sits ON TOP of the rent-exempt minimum).
//  * Reserves are tracked in POOL STATE (not read from raw balances), so a stray SOL or
//    token donation to the pool/vault cannot skew the price or be swept out.
//
// Deploy this with Solana Playground (beta.solpg.io) on DEVNET — see
// docs/SWAP_DEPLOY.md. Playground assigns the real program id on Build; the placeholder
// in declare_id!() below is updated automatically (accept the "update program id" prompt).

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("11111111111111111111111111111111"); // PLACEHOLDER (valid 32-byte id) — Playground updates it on Build; accept the "update program id" prompt

const FEE_DENOM: u64 = 10_000; // fee_bps is out of 10_000 (30 = 0.30%)
const MAX_FEE_BPS: u64 = 1_000; // hard cap 10% — no rug-tier fees

#[program]
pub mod pulse_swap {
    use super::*;

    /// Authority-only. Creates the pool config PDA + the PLSX token vault (owned by the
    /// pool PDA). One pool per mint. Reserves start at zero — seed them with add_liquidity.
    pub fn initialize_pool(ctx: Context<InitializePool>, fee_bps: u64) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, SwapError::FeeTooHigh);
        let pool = &mut ctx.accounts.pool;
        pool.mint = ctx.accounts.mint.key();
        pool.authority = ctx.accounts.authority.key();
        pool.fee_bps = fee_bps as u16;
        pool.token_reserve = 0;
        pool.sol_reserve = 0;
        pool.bump = ctx.bumps.pool;
        pool.token_vault_bump = ctx.bumps.token_vault;
        Ok(())
    }

    /// Authority-only. Adjust the swap fee (bps, capped at MAX_FEE_BPS).
    pub fn set_fee_bps(ctx: Context<AdminOnly>, fee_bps: u64) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, SwapError::FeeTooHigh);
        ctx.accounts.pool.fee_bps = fee_bps as u16;
        Ok(())
    }

    /// Authority-only. Seed REAL liquidity: PLSX -> token vault, native SOL -> pool PDA.
    /// Both legs are signed by the authority. The first deposit sets the initial price;
    /// since only the authority provides liquidity there is no LP-fairness concern, so
    /// any ratio is accepted (it simply defines / moves the price).
    pub fn add_liquidity(ctx: Context<AddLiquidity>, token_amount: u64, sol_amount: u64) -> Result<()> {
        require!(token_amount > 0 && sol_amount > 0, SwapError::ZeroAmount);

        // PLSX: authority token account -> vault (authority signs).
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.authority_token.to_account_info(),
                    to: ctx.accounts.token_vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            token_amount,
        )?;

        // SOL: authority -> pool PDA (authority signs; System CPI). Transferring lamports
        // INTO a program-owned data account is allowed (only the FROM must be system-owned).
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.authority.to_account_info(),
                    to: ctx.accounts.pool.to_account_info(),
                },
            ),
            sol_amount,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.token_reserve = pool.token_reserve.checked_add(token_amount).ok_or(SwapError::Overflow)?;
        pool.sol_reserve = pool.sol_reserve.checked_add(sol_amount).ok_or(SwapError::Overflow)?;
        Ok(())
    }

    /// Authority-only. Withdraw liquidity: PLSX vault -> authority, SOL pool -> authority.
    /// Can withdraw up to the full tracked reserves; the pool always keeps its rent-exempt
    /// minimum (we only ever debit lamports from `sol_reserve`, which sits above it).
    pub fn remove_liquidity(ctx: Context<RemoveLiquidity>, token_amount: u64, sol_amount: u64) -> Result<()> {
        require!(token_amount > 0 || sol_amount > 0, SwapError::ZeroAmount);
        require!(token_amount <= ctx.accounts.pool.token_reserve, SwapError::InsufficientReserve);
        require!(sol_amount <= ctx.accounts.pool.sol_reserve, SwapError::InsufficientReserve);

        // PLSX: vault -> authority (pool PDA signs).
        if token_amount > 0 {
            let mint_key = ctx.accounts.pool.mint;
            let bump = ctx.accounts.pool.bump;
            let seeds: &[&[u8]] = &[b"swap_pool", mint_key.as_ref(), &[bump]];
            let signer: &[&[&[u8]]] = &[seeds];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.token_vault.to_account_info(),
                        to: ctx.accounts.authority_token.to_account_info(),
                        authority: ctx.accounts.pool.to_account_info(),
                    },
                    signer,
                ),
                token_amount,
            )?;
        }

        // SOL: pool PDA -> authority (direct lamport move — the pool is program-owned).
        if sol_amount > 0 {
            **ctx.accounts.pool.to_account_info().try_borrow_mut_lamports()? -= sol_amount;
            **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += sol_amount;
        }

        let pool = &mut ctx.accounts.pool;
        pool.token_reserve = pool.token_reserve.checked_sub(token_amount).ok_or(SwapError::Overflow)?;
        pool.sol_reserve = pool.sol_reserve.checked_sub(sol_amount).ok_or(SwapError::Overflow)?;
        Ok(())
    }

    /// Anyone. Swap `sol_in` lamports for PLSX. Fee taken on input; reverts if the
    /// computed PLSX out is below `min_token_out` (slippage guard).
    pub fn swap_sol_for_token(ctx: Context<SwapSolForToken>, sol_in: u64, min_token_out: u64) -> Result<()> {
        require!(sol_in > 0, SwapError::ZeroAmount);
        let (token_reserve, sol_reserve, fee_bps) = {
            let p = &ctx.accounts.pool;
            (p.token_reserve, p.sol_reserve, p.fee_bps as u64)
        };
        require!(token_reserve > 0 && sol_reserve > 0, SwapError::NoLiquidity);

        // token_out = token_reserve * in_after_fee / (sol_reserve + in_after_fee)
        let in_after_fee = (sol_in as u128)
            .checked_mul((FEE_DENOM - fee_bps) as u128).ok_or(SwapError::Overflow)?
            .checked_div(FEE_DENOM as u128).ok_or(SwapError::Overflow)?;
        require!(in_after_fee > 0, SwapError::ZeroAmount);
        let numerator = (token_reserve as u128).checked_mul(in_after_fee).ok_or(SwapError::Overflow)?;
        let denominator = (sol_reserve as u128).checked_add(in_after_fee).ok_or(SwapError::Overflow)?;
        let token_out = u64::try_from(numerator.checked_div(denominator).ok_or(SwapError::Overflow)?)
            .map_err(|_| SwapError::Overflow)?;
        require!(token_out > 0, SwapError::NoLiquidity);
        require!(token_out < token_reserve, SwapError::InsufficientReserve);
        require!(token_out >= min_token_out, SwapError::SlippageExceeded);

        // SOL in: user -> pool PDA (user signs).
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.pool.to_account_info(),
                },
            ),
            sol_in,
        )?;

        // PLSX out: vault -> user (pool PDA signs).
        let mint_key = ctx.accounts.pool.mint;
        let bump = ctx.accounts.pool.bump;
        let seeds: &[&[u8]] = &[b"swap_pool", mint_key.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.token_vault.to_account_info(),
                    to: ctx.accounts.user_token.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                signer,
            ),
            token_out,
        )?;

        // Full sol_in enters reserves (the fee stays as pool reserve → k grows).
        let pool = &mut ctx.accounts.pool;
        pool.sol_reserve = pool.sol_reserve.checked_add(sol_in).ok_or(SwapError::Overflow)?;
        pool.token_reserve = pool.token_reserve.checked_sub(token_out).ok_or(SwapError::Overflow)?;
        Ok(())
    }

    /// Anyone. Swap `token_in` PLSX for SOL. Fee taken on input; reverts if the computed
    /// SOL out is below `min_sol_out` (slippage guard).
    pub fn swap_token_for_sol(ctx: Context<SwapTokenForSol>, token_in: u64, min_sol_out: u64) -> Result<()> {
        require!(token_in > 0, SwapError::ZeroAmount);
        let (token_reserve, sol_reserve, fee_bps) = {
            let p = &ctx.accounts.pool;
            (p.token_reserve, p.sol_reserve, p.fee_bps as u64)
        };
        require!(token_reserve > 0 && sol_reserve > 0, SwapError::NoLiquidity);

        // sol_out = sol_reserve * in_after_fee / (token_reserve + in_after_fee)
        let in_after_fee = (token_in as u128)
            .checked_mul((FEE_DENOM - fee_bps) as u128).ok_or(SwapError::Overflow)?
            .checked_div(FEE_DENOM as u128).ok_or(SwapError::Overflow)?;
        require!(in_after_fee > 0, SwapError::ZeroAmount);
        let numerator = (sol_reserve as u128).checked_mul(in_after_fee).ok_or(SwapError::Overflow)?;
        let denominator = (token_reserve as u128).checked_add(in_after_fee).ok_or(SwapError::Overflow)?;
        let sol_out = u64::try_from(numerator.checked_div(denominator).ok_or(SwapError::Overflow)?)
            .map_err(|_| SwapError::Overflow)?;
        require!(sol_out > 0, SwapError::NoLiquidity);
        require!(sol_out < sol_reserve, SwapError::InsufficientReserve);
        require!(sol_out >= min_sol_out, SwapError::SlippageExceeded);

        // PLSX in: user -> vault (user signs).
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token.to_account_info(),
                    to: ctx.accounts.token_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            token_in,
        )?;

        // SOL out: pool PDA -> user (direct lamport move; sol_out < sol_reserve keeps rent-exempt).
        **ctx.accounts.pool.to_account_info().try_borrow_mut_lamports()? -= sol_out;
        **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += sol_out;

        let pool = &mut ctx.accounts.pool;
        pool.token_reserve = pool.token_reserve.checked_add(token_in).ok_or(SwapError::Overflow)?;
        pool.sol_reserve = pool.sol_reserve.checked_sub(sol_out).ok_or(SwapError::Overflow)?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        space = 8 + Pool::LEN,
        seeds = [b"swap_pool", mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,
    #[account(
        init,
        payer = authority,
        token::mint = mint,
        token::authority = pool,
        seeds = [b"token_vault", pool.key().as_ref()],
        bump
    )]
    pub token_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"swap_pool", pool.mint.as_ref()],
        bump = pool.bump,
        has_one = authority
    )]
    pub pool: Account<'info, Pool>,
}

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"swap_pool", pool.mint.as_ref()],
        bump = pool.bump,
        has_one = authority
    )]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [b"token_vault", pool.key().as_ref()], bump = pool.token_vault_bump)]
    pub token_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = authority_token.mint == pool.mint @ SwapError::WrongMint,
        constraint = authority_token.owner == authority.key() @ SwapError::WrongOwner
    )]
    pub authority_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveLiquidity<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"swap_pool", pool.mint.as_ref()],
        bump = pool.bump,
        has_one = authority
    )]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [b"token_vault", pool.key().as_ref()], bump = pool.token_vault_bump)]
    pub token_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = authority_token.mint == pool.mint @ SwapError::WrongMint,
        constraint = authority_token.owner == authority.key() @ SwapError::WrongOwner
    )]
    pub authority_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SwapSolForToken<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [b"swap_pool", pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [b"token_vault", pool.key().as_ref()], bump = pool.token_vault_bump)]
    pub token_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_token.mint == pool.mint @ SwapError::WrongMint,
        constraint = user_token.owner == user.key() @ SwapError::WrongOwner
    )]
    pub user_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SwapTokenForSol<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [b"swap_pool", pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [b"token_vault", pool.key().as_ref()], bump = pool.token_vault_bump)]
    pub token_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_token.mint == pool.mint @ SwapError::WrongMint,
        constraint = user_token.owner == user.key() @ SwapError::WrongOwner
    )]
    pub user_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Pool {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub fee_bps: u16,
    pub token_reserve: u64,
    pub sol_reserve: u64,
    pub bump: u8,
    pub token_vault_bump: u8,
}
impl Pool {
    pub const LEN: usize = 32 + 32 + 2 + 8 + 8 + 1 + 1;
}

#[error_code]
pub enum SwapError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Token account mint does not match the pool mint")]
    WrongMint,
    #[msg("Token account owner does not match the signer")]
    WrongOwner,
    #[msg("Pool has no liquidity")]
    NoLiquidity,
    #[msg("Output is below the minimum (slippage exceeded)")]
    SlippageExceeded,
    #[msg("Requested amount exceeds pool reserve")]
    InsufficientReserve,
    #[msg("Fee exceeds the maximum allowed")]
    FeeTooHigh,
}
