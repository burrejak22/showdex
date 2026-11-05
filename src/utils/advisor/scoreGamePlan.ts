/**
 * @file `scoreGamePlan.ts`
 * @since 1.4.3
 */

import {
  type AdvisorMon,
  type AdvisorMove,
  effectiveRolls,
  firstMoveProbability,
  meanDamage,
} from './scoreBattleAdvice';

/**
 * How a straight 1-on-1 between two Pokemon plays out if both just click their best attack.
 *
 * @since 1.4.3
 */
export interface AdvisorDuel {
  /**
   * `'win'` if your Pokemon KOs theirs first, `'loss'` if it's the other way around,
   * `'coin'` for a speed tie or if neither side can hurt the other.
   */
  outcome: 'win' | 'loss' | 'coin';

  /**
   * Turns your Pokemon needs to KO theirs (`Infinity` if it can't).
   */
  myTurns: number;

  /**
   * Turns their Pokemon needs to KO yours (`Infinity` if it can't).
   */
  theirTurns: number;

  myMove: string;
  theirMove: string;
}

/**
 * Turns `moves` need to KO `target` on average, and the move that does it fastest.
 *
 * * The first hit respects *Focus Sash* / *Sturdy*; later hits don't.
 * * Uses average damage times accuracy, so a 50% OHKO counts as a 2HKO (on purpose: it's a plan, not a gamble).
 *
 * @since 1.4.3
 */
export const turnsToKO = (
  moves: AdvisorMove[],
  target: Pick<AdvisorMon, 'hp' | 'maxHp' | 'sash'>,
  actChance = 1,
): { turns: number; move: AdvisorMove; } => {
  let best: { turns: number; move: AdvisorMove; } = { turns: Infinity, move: null };

  (moves || []).forEach((move) => {
    if (move?.kind !== 'attack' || !move.rolls?.length) {
      return;
    }

    // status that stops you moving (sleep, paralysis, ...) stretches out how long the KO takes on average
    const can = Math.max(0, Math.min(1, move.actChance ?? actChance));
    const first = can * move.accuracy * meanDamage(effectiveRolls(move, target), target.hp);
    const later = can * move.accuracy * meanDamage(move.rolls, target.hp);

    if (later <= 0) {
      return;
    }

    const turns = first >= target.hp
      ? 1
      : 1 + Math.ceil(Math.max(0, target.hp - first) / later);

    const better = turns < best.turns
      || (turns === best.turns && (move.priority || 0) > (best.move?.priority || 0));

    if (better) {
      best = { turns, move };
    }
  });

  return best;
};

/**
 * Plays out a 1-on-1 between `me` & `them`.
 *
 * @since 1.4.3
 */
export const simulateDuel = (
  me: AdvisorMon,
  myMoves: AdvisorMove[],
  them: AdvisorMon,
  theirMoves: AdvisorMove[],
  trickRoom?: boolean,
): AdvisorDuel => {
  const mine = turnsToKO(myMoves, them, me.actChance ?? 1);
  const theirs = turnsToKO(theirMoves, me, them.actChance ?? 1);

  let outcome: AdvisorDuel['outcome'] = 'coin';

  if (mine.turns < theirs.turns) {
    outcome = 'win';
  } else if (mine.turns > theirs.turns) {
    outcome = 'loss';
  } else if (Number.isFinite(mine.turns)) {
    const first = firstMoveProbability(mine.move?.priority, me.speed, theirs.move?.priority, them.speed, trickRoom);

    outcome = (first === 1 && 'win') || (first === 0 && 'loss') || 'coin';
  }

  return {
    outcome,
    myTurns: mine.turns,
    theirTurns: theirs.turns,
    myMove: mine.move?.name || null,
    theirMove: theirs.move?.name || null,
  };
};

/**
 * One side's Pokemon, as far as the game plan cares.
 *
 * @since 1.4.3
 */
export interface GamePlanMon {
  /**
   * Party index (yours) or a unique key (theirs).
   */
  index: number;
  name: string;

  /**
   * Remaining HP, `0` to `1`.
   */
  hpFraction: number;
}

/**
 * @since 1.4.3
 */
export interface GamePlanInput {
  mine: GamePlanMon[];
  theirs: GamePlanMon[];

  /**
   * `duels[myIndex][theirIndex]`
   */
  duels: Record<number, Record<number, AdvisorDuel>>;

  /**
   * Party index of your active Pokemon (`-1` if none).
   */
  myActiveIndex?: number;

  /**
   * Key of their active Pokemon (`-1` if none).
   */
  theirActiveIndex?: number;

  /**
   * Their Pokemon you haven't seen yet.
   */
  unseen?: number;
}

/**
 * Role a Pokemon of yours plays in the plan.
 *
 * * `'wincon'`: beats the most of what they've shown; keep it healthy.
 * * `'answer'`: the only thing that beats one of their Pokemon.
 * * `'fodder'`: doesn't win any matchup right now; fine to sack.
 *
 * @since 1.4.3
 */
export type GamePlanRole = 'wincon' | 'answer' | 'fodder' | 'neutral';

/**
 * @since 1.4.3
 */
export interface GamePlanThreat {
  name: string;
  index: number;

  /**
   * Your Pokemon it beats.
   */
  beats: string[];

  /**
   * Your Pokemon that beat it.
   */
  answers: string[];
}

/**
 * @since 1.4.3
 */
export interface GamePlan {
  winCondition: { name: string; index: number; beats: string[]; };
  threats: GamePlanThreat[];
  sackFodder: GamePlanMon[];
  roles: Record<number, GamePlanRole>;

  /**
   * Plain-English takeaways, most important first.
   */
  ideas: string[];
}

/**
 * How much losing a Pokemon with this role hurts, `0` to `1`.
 *
 * @since 1.4.3
 */
export const GamePlanRoleValues: Record<GamePlanRole, number> = {
  wincon: 1,
  answer: 0.9,
  neutral: 0.5,
  fodder: 0.15,
};

const listNames = (names: string[], max = 3): string => {
  if (names.length <= max) {
    return names.join(', ');
  }

  return `${names.slice(0, max).join(', ')} +${names.length - max} more`;
};

/**
 * Turns a matrix of 1-on-1s into a game plan: win condition, threats & answers, and who's safe to sack.
 *
 * @since 1.4.3
 */
export const scoreGamePlan = (input: GamePlanInput): GamePlan => {
  const {
    mine = [],
    theirs = [],
    duels = {},
    myActiveIndex = -1,
    theirActiveIndex = -1,
    unseen = 0,
  } = input || {} as GamePlanInput;

  const plan: GamePlan = {
    winCondition: null,
    threats: [],
    sackFodder: [],
    roles: {},
    ideas: [],
  };

  const alive = mine.filter((m) => m.hpFraction > 0);
  const foes = theirs.filter((t) => t.hpFraction > 0);

  if (!alive.length || !foes.length) {
    return plan;
  }

  const outcome = (m: GamePlanMon, t: GamePlanMon) => duels[m.index]?.[t.index]?.outcome;

  const wins = new Map(alive.map((m) => [m.index, foes.filter((t) => outcome(m, t) === 'win')]));

  alive.forEach((m) => { plan.roles[m.index] = 'neutral'; });

  // win condition: beats the most, with healthier as the tiebreaker
  const [topMon] = [...alive].sort((a, b) => (
    (wins.get(b.index).length - wins.get(a.index).length) || (b.hpFraction - a.hpFraction)
  ));

  const topWins = wins.get(topMon.index);

  if (topWins.length >= Math.max(2, Math.ceil(foes.length / 2)) || (foes.length === 1 && topWins.length === 1)) {
    plan.winCondition = {
      name: topMon.name,
      index: topMon.index,
      beats: topWins.map((t) => t.name),
    };

    plan.roles[topMon.index] = 'wincon';
  }

  // threats: their Pokemon that beat a lot of yours, or that nothing of yours beats
  plan.threats = foes
    .map((t): GamePlanThreat => ({
      name: t.name,
      index: t.index,
      beats: alive.filter((m) => outcome(m, t) === 'loss').map((m) => m.name),
      answers: alive
        .filter((m) => outcome(m, t) === 'win')
        .sort((a, b) => (
          // prefer answers that win faster & stay healthier
          ((duels[a.index]?.[t.index]?.myTurns || 9) - (duels[b.index]?.[t.index]?.myTurns || 9))
            || (b.hpFraction - a.hpFraction)
        ))
        .map((m) => m.name),
    }))
    .filter((t) => t.beats.length >= 2 || !t.answers.length)
    .sort((a, b) => (b.beats.length - a.beats.length) || (a.answers.length - b.answers.length));

  plan.threats.forEach((t) => {
    if (t.answers.length !== 1) {
      return;
    }

    const answer = alive.find((m) => m.name === t.answers[0]);

    if (answer && plan.roles[answer.index] === 'neutral') {
      plan.roles[answer.index] = 'answer';
    }
  });

  plan.sackFodder = alive
    .filter((m) => !wins.get(m.index).length && plan.roles[m.index] === 'neutral')
    .sort((a, b) => a.hpFraction - b.hpFraction);

  plan.sackFodder.forEach((m) => { plan.roles[m.index] = 'fodder'; });

  // ideas, most actionable first
  const myActive = alive.find((m) => m.index === myActiveIndex);
  const theirActive = foes.find((t) => t.index === theirActiveIndex);

  if (myActive && theirActive && outcome(myActive, theirActive) === 'loss') {
    const better = alive
      .filter((m) => m !== myActive && outcome(m, theirActive) === 'win')
      .map((m) => m.name);

    plan.ideas.push(better.length
      ? `${myActive.name} loses to ${theirActive.name} 1-on-1; ${listNames(better, 2)} ${better.length > 1 ? 'win' : 'wins'} it.`
      : `${myActive.name} loses to ${theirActive.name}, and nothing else beats it cleanly either.`);
  }

  if (plan.winCondition) {
    plan.ideas.push(
      `Win condition: ${plan.winCondition.name} beats ${plan.winCondition.beats.length} of their ${foes.length} known `
        + `(${listNames(plan.winCondition.beats)}). Keep it healthy.`,
    );
  }

  plan.threats.slice(0, 2).forEach((t) => {
    if (!t.answers.length) {
      plan.ideas.push(`Nothing beats ${t.name} 1-on-1. Chip it with hazards or attacks, or sack into it for a free switch.`);

      return;
    }

    plan.ideas.push(
      `${t.name} beats ${t.beats.length} of yours. ${t.answers[0]} is your answer`
        + `${t.answers.length === 1 ? ', and your only one, so don\'t sack it' : ''}.`,
    );
  });

  if (plan.sackFodder.length) {
    const [fodder] = plan.sackFodder;

    plan.ideas.push(`${fodder.name} is your best sack: it doesn't win any matchup right now.`);
  }

  if (unseen > 0) {
    plan.ideas.push(`${unseen} of their Pokémon ${unseen === 1 ? 'hasn\'t' : 'haven\'t'} been revealed yet.`);
  }

  return plan;
};
