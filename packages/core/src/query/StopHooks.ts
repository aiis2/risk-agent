import type { StopReason } from '../agents/base/types.js';
import type { TokenBudget } from './TokenBudget.js';

export interface StopContext {
  turn: number;
  maxTurns: number;
  correctionRound: number;
  maxCorrectionRounds: number;
  lastTurnDeltaTokens: number;
  diminishingThreshold: number;
  budget?: TokenBudget;
}

export interface StopHook {
  name: string;
  evaluate(ctx: StopContext): StopReason | null;
}

export const budgetExhaustedHook: StopHook = {
  name: 'budget_exceeded',
  evaluate(ctx) {
    return ctx.budget?.isExceeded() ? 'budget_exceeded' : null;
  }
};

export const maxTurnsHook: StopHook = {
  name: 'max_turns',
  evaluate(ctx) {
    return ctx.maxTurns > 0 && ctx.turn >= ctx.maxTurns ? 'max_turns' : null;
  }
};

export const diminishingReturnsHook: StopHook = {
  name: 'diminishing_returns',
  evaluate(ctx) {
    if (ctx.turn < 3) return null;
    return ctx.lastTurnDeltaTokens < ctx.diminishingThreshold ? 'diminishing_returns' : null;
  }
};

export const correctionExhaustedHook: StopHook = {
  name: 'correction_exhausted',
  evaluate(ctx) {
    return ctx.correctionRound >= ctx.maxCorrectionRounds ? 'correction_exhausted' : null;
  }
};

export const DEFAULT_STOP_HOOKS: StopHook[] = [
  budgetExhaustedHook,
  maxTurnsHook,
  diminishingReturnsHook,
  correctionExhaustedHook
];
