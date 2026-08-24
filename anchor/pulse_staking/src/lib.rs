// PULSE staking — a REAL on-chain staking program for the devnet PLSX SPL token.
//
// Model: stake PLSX -> earn PLSX from an authority-funded reward vault.
// Per-user "lazy accrual": on every stake / unstake / claim we first SETTLE the
// caller's pending rewards for the time elapsed since their last interaction,
// then mutate. Each staker earns in proportion to THEIR OWN stake at the
// authority-set `reward_rate` (APR-style, independent of other stakers).
//
// `claim` pays min(owed, reward_vault_balance) so a drained reward vault never
// panics — it simply pays what it can and leaves the remainder owed.
//
// SECURITY NOTES (why this is honest & safe):
//  * No admin secret lives anywhere on-chain or in the frontend. The "authority"
//    is just a normal wallet; admin actions (initialize/fund/set_rate) are plain
//    transactions signed by that wallet.
//  * Stake/unstake/claim move the USER's own tokens, signed by the USER's wallet.
//  * Vault token accounts are PDAs owned by the pool PDA; only this program,
//    signing with the pool seeds, can move tokens out of them.
//
// Deploy this with Solana Playground (beta.solpg.io) on DEVNET — see
// docs/STAKING_DEPLOY.md. Playground will assign the real program id on Build;
// the placeholder in declare_id!() below is updated automatically (accept the
// "update program id" prompt) or replace it by hand after deploy.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("11111111111111111111111111111111"); // PLACEHOLDER (valid 32-byte id) — Playground updates it on Build; accept the "update program id" prompt

// reward_rate is scaled: it is (reward base-units earned per 1 staked base-unit
// per second) * ACC_PRECISION. Example targets (PLSX has 9 decimals, so this
// scaling is decimals-agnostic — it is a pure ratio):
//   ~10% APR  -> reward_rate ≈ 0.10 / 31_536_000 * 1e12 ≈ 3171
//   ~25% APR  -> reward_rate ≈ 7927
// Set reward_rate = 0 to pause emissions without touching stakes.
const ACC_PRECISION: u128 = 1_000_000_000_000; // 1e12

#[program]
pub mod pulse_staking {
    use super::*;

    /// Authority-only. Creates the pool config PDA + the stake and reward vault
    /// token accounts (both owned by the pool PDA). One pool per mint.
    pub fn initialize_pool(ctx: Context<InitializePool>, reward_rate: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.mint = ctx.accounts.mint.key();
        pool.authority = ctx.accounts.authority.key();
        pool.reward_rate = reward_rate;
        pool.total_staked = 0;
        pool.bump = ctx.bumps.pool;
        pool.stake_vault_bump = ctx.bumps.stake_vault;
        pool.reward_vault_bump = ctx.bumps.reward_vault;
        Ok(())
    }

    /// Authority-only. Adjust the emission rate (0 pauses rewards).
    pub fn set_reward_rate(ctx: Context<AdminOnly>, new_rate: u64) -> Result<()> {
        ctx.accounts.pool.reward_rate = new_rate;
        Ok(())
    }

    /// Authority-only. Move reward PLSX from the authority's token account into
    /// the reward vault. (The authority, being the PLSX mint authority, may mint
    /// PLSX to their own account first — that funding is legitimate, real supply.)
    pub fn fund_rewards(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
        require!(amount > 0, StakeError::ZeroAmount);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.authority_token.to_account_info(),
                    to: ctx.accounts.reward_vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;
        Ok(())
    }

    /// User creates their own UserStake PDA — one-time, before their first stake.
    /// Kept as a separate instruction so the program needs NO `init_if_needed`
    /// cargo feature (which keeps the Solana Playground build simple/robust). The
    /// frontend sends this automatically the first time a wallet stakes.
    pub fn open_stake_account(ctx: Context<OpenStakeAccount>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let user = &mut ctx.accounts.user_stake;
        user.owner = ctx.accounts.owner.key();
        user.amount = 0;
        user.pending = 0;
        user.last_update = now;
        user.bump = ctx.bumps.user_stake;
        Ok(())
    }

    /// User stakes `amount` PLSX (moved from their token account into the stake vault).
    /// The caller's UserStake PDA must already exist (see `open_stake_account`).
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        require!(amount > 0, StakeError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;
        let reward_rate = ctx.accounts.pool.reward_rate;

        let user = &mut ctx.accounts.user_stake;
        settle(user, reward_rate, now)?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.owner_token.to_account_info(),
                    to: ctx.accounts.stake_vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;

        user.amount = user.amount.checked_add(amount).ok_or(StakeError::Overflow)?;
        let pool = &mut ctx.accounts.pool;
        pool.total_staked = pool.total_staked.checked_add(amount).ok_or(StakeError::Overflow)?;
        Ok(())
    }

    /// User withdraws `amount` staked PLSX back to their token account.
    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        require!(amount > 0, StakeError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;
        let reward_rate = ctx.accounts.pool.reward_rate;

        let user = &mut ctx.accounts.user_stake;
        settle(user, reward_rate, now)?;
        require!(user.amount >= amount, StakeError::InsufficientStake);

        // Pool PDA signs the vault -> user transfer.
        let mint_key = ctx.accounts.pool.mint;
        let bump = ctx.accounts.pool.bump;
        let seeds: &[&[u8]] = &[b"pool", mint_key.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.stake_vault.to_account_info(),
                    to: ctx.accounts.owner_token.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        user.amount = user.amount.checked_sub(amount).ok_or(StakeError::Overflow)?;
        let pool = &mut ctx.accounts.pool;
        pool.total_staked = pool.total_staked.checked_sub(amount).ok_or(StakeError::Overflow)?;
        Ok(())
    }

    /// User harvests accrued reward PLSX. Pays min(owed, reward_vault_balance).
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let reward_rate = ctx.accounts.pool.reward_rate;

        let user = &mut ctx.accounts.user_stake;
        settle(user, reward_rate, now)?;

        let vault_balance = ctx.accounts.reward_vault.amount;
        let pay = user.pending.min(vault_balance);
        if pay > 0 {
            let mint_key = ctx.accounts.pool.mint;
            let bump = ctx.accounts.pool.bump;
            let seeds: &[&[u8]] = &[b"pool", mint_key.as_ref(), &[bump]];
            let signer: &[&[&[u8]]] = &[seeds];

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.reward_vault.to_account_info(),
                        to: ctx.accounts.owner_token.to_account_info(),
                        authority: ctx.accounts.pool.to_account_info(),
                    },
                    signer,
                ),
                pay,
            )?;
            user.pending = user.pending.checked_sub(pay).ok_or(StakeError::Overflow)?;
        }
        Ok(())
    }
}

/// Accrue rewards for the elapsed time, then stamp last_update = now.
/// MUST be called before any mutation of `amount` (settle-before-mutate).
fn settle(user: &mut Account<'_, UserStake>, reward_rate: u64, now: i64) -> Result<()> {
    let elapsed = now.saturating_sub(user.last_update);
    if elapsed > 0 && user.amount > 0 && reward_rate > 0 {
        let accrued = (user.amount as u128)
            .checked_mul(reward_rate as u128)
            .ok_or(StakeError::Overflow)?
            .checked_mul(elapsed as u128)
            .ok_or(StakeError::Overflow)?
            .checked_div(ACC_PRECISION)
            .ok_or(StakeError::Overflow)?;
        let accrued_u64 = u64::try_from(accrued).map_err(|_| StakeError::Overflow)?;
        user.pending = user.pending.checked_add(accrued_u64).ok_or(StakeError::Overflow)?;
    }
    user.last_update = now;
    Ok(())
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
        seeds = [b"pool", mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,
    #[account(
        init,
        payer = authority,
        token::mint = mint,
        token::authority = pool,
        seeds = [b"stake_vault", pool.key().as_ref()],
        bump
    )]
    pub stake_vault: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = authority,
        token::mint = mint,
        token::authority = pool,
        seeds = [b"reward_vault", pool.key().as_ref()],
        bump
    )]
    pub reward_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"pool", pool.mint.as_ref()],
        bump = pool.bump,
        has_one = authority
    )]
    pub pool: Account<'info, Pool>,
}

#[derive(Accounts)]
pub struct FundRewards<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"pool", pool.mint.as_ref()],
        bump = pool.bump,
        has_one = authority
    )]
    pub pool: Account<'info, Pool>,
    #[account(
        mut,
        seeds = [b"reward_vault", pool.key().as_ref()],
        bump = pool.reward_vault_bump
    )]
    pub reward_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = authority_token.mint == pool.mint @ StakeError::WrongMint,
        constraint = authority_token.owner == authority.key() @ StakeError::WrongOwner
    )]
    pub authority_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct OpenStakeAccount<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"pool", pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(
        init,
        payer = owner,
        space = 8 + UserStake::LEN,
        seeds = [b"user", pool.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub user_stake: Account<'info, UserStake>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"pool", pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(
        mut,
        seeds = [b"user", pool.key().as_ref(), owner.key().as_ref()],
        bump = user_stake.bump,
        has_one = owner
    )]
    pub user_stake: Account<'info, UserStake>,
    #[account(mut, seeds = [b"stake_vault", pool.key().as_ref()], bump = pool.stake_vault_bump)]
    pub stake_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = owner_token.mint == pool.mint @ StakeError::WrongMint,
        constraint = owner_token.owner == owner.key() @ StakeError::WrongOwner
    )]
    pub owner_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"pool", pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(
        mut,
        seeds = [b"user", pool.key().as_ref(), owner.key().as_ref()],
        bump = user_stake.bump,
        has_one = owner
    )]
    pub user_stake: Account<'info, UserStake>,
    #[account(mut, seeds = [b"stake_vault", pool.key().as_ref()], bump = pool.stake_vault_bump)]
    pub stake_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = owner_token.mint == pool.mint @ StakeError::WrongMint,
        constraint = owner_token.owner == owner.key() @ StakeError::WrongOwner
    )]
    pub owner_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"pool", pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(
        mut,
        seeds = [b"user", pool.key().as_ref(), owner.key().as_ref()],
        bump = user_stake.bump,
        has_one = owner
    )]
    pub user_stake: Account<'info, UserStake>,
    #[account(mut, seeds = [b"reward_vault", pool.key().as_ref()], bump = pool.reward_vault_bump)]
    pub reward_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = owner_token.mint == pool.mint @ StakeError::WrongMint,
        constraint = owner_token.owner == owner.key() @ StakeError::WrongOwner
    )]
    pub owner_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Pool {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub reward_rate: u64,
    pub total_staked: u64,
    pub bump: u8,
    pub stake_vault_bump: u8,
    pub reward_vault_bump: u8,
}
impl Pool {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 1 + 1 + 1;
}

#[account]
pub struct UserStake {
    pub owner: Pubkey,
    pub amount: u64,
    pub pending: u64,
    pub last_update: i64,
    pub bump: u8,
}
impl UserStake {
    pub const LEN: usize = 32 + 8 + 8 + 8 + 1;
}

#[error_code]
pub enum StakeError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Insufficient staked balance")]
    InsufficientStake,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Token account mint does not match the pool mint")]
    WrongMint,
    #[msg("Token account owner does not match the signer")]
    WrongOwner,
}
