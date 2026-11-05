/**
 * @file `scoreBattleAdvice.ts`
 * @since 1.4.3
 */

/**
 * Broad bucket a move falls into, used to pick the scoring heuristic.
 *
 * @since 1.4.3
 */
export type AdvisorMoveKind =
  | 'attack'
  | 'setup'
  | 'recovery'
  | 'hazard'
  | 'status'
  | 'protect'
  | 'other';

/**
 * A move as seen by the advisor, already calculated against one specific target.
 *
 * @since 1.4.3
 */
export interface AdvisorMove {
  name: string;
  kind: AdvisorMoveKind;

  /**
   * Absolute damage rolls against the target (usually 16 of 'em).
   *
   * * Empty for status moves or when the calc couldn't run.
   * * All zeroes when the target is immune.
   */
  rolls: number[];

  /**
   * Hit chance between `0` & `1`.
   */
  accuracy: number;

  priority: number;

  /**
   * Whether the user leaves the field after using it (e.g., *U-turn*, *Volt Switch*, *Parting Shot*).
   */
  pivot?: boolean;

  /**
   * Fraction of the damage dealt that the user takes back as recoil.
   */
  recoil?: number;

  /**
   * Fraction of the damage dealt that the user heals.
   */
  drain?: number;

  /**
   * Fraction of the user's max HP healed (recovery moves only).
   */
  heal?: number;

  /**
   * Non-volatile status the move inflicts (status moves only), e.g., `'slp'`, `'par'`, `'brn'`, `'tox'`.
   */
  status?: string;

  /**
   * Hazard ID the move sets (hazard moves only), e.g., `'stealthrock'`.
   */
  hazard?: string;

  /**
   * Whether this move is a guess (i.e., the opponent hasn't revealed it yet).
   */
  guessed?: boolean;

  /**
   * Whether the move hits more than once (breaks *Focus Sash* & *Sturdy*).
   */
  multihit?: boolean;

  /**
   * Fraction of the user's max HP lost when the move connects, from the user's item or the target's ability/item
   * (e.g., *Life Orb*, *Rocky Helmet*, *Rough Skin*).
   */
  selfDamage?: number;

  /**
   * What causes `selfDamage`, for the reasons list (e.g., `'Life Orb'`).
   */
  selfDamageSource?: string;

  /**
   * Why you can't click this move right now (e.g., `'Taunted'`, `'Choice-locked into Earthquake'`), if you can't.
   */
  disabled?: string;

  /**
   * Overrides the user's `actChance` for this move (e.g., `1` for *Sleep Talk* while asleep, or a move that thaws
   * the user out).
   */
  actChance?: number;

  /**
   * Whether using it faints the user (*Explosion*, *Memento*, *Healing Wish*, *Final Gambit*, etc.).
   */
  selfKO?: boolean;

  /**
   * What a classic "last move" does for the team when you're going down anyway.
   */
  lastWish?: 'memento' | 'healingwish' | 'destinybond';

  /**
   * Extra score from things the adapter knows about (e.g., a Choice item locking you into a move their
   * team walls), with reasons.
   */
  adjust?: number;
  adjustReasons?: string[];
}

/**
 * @since 1.4.3
 */
export interface AdvisorMon {
  name: string;
  hp: number;
  maxHp: number;
  speed: number;

  /**
   * Current non-volatile status, if any.
   */
  status?: string;

  /**
   * Whether this Pokemon mostly attacks physically (used to value burns).
   */
  physical?: boolean;

  /**
   * Whether a single hit can't KO this Pokemon from full HP (*Focus Sash* or *Sturdy*).
   */
  sash?: boolean;

  /**
   * What gives `sash`, for the reasons list.
   */
  sashSource?: string;

  /**
   * Chance this Pokemon gets to act this turn at all, `0` to `1`
   * (asleep, frozen, fully paralyzed, hurting itself in confusion).
   *
   * @default 1
   */
  actChance?: number;

  /**
   * Why `actChance` is below `1`, e.g., `'asleep'`.
   */
  actNote?: string;
}

/**
 * One of your benched Pokemon you could switch into.
 *
 * @since 1.4.3
 */
export interface AdvisorSwitchOption {
  /**
   * Index of the Pokemon in your party, passed through to the result.
   */
  index: number;
  mon: AdvisorMon;

  /**
   * Absolute HP lost on entry from hazards on your side.
   */
  entryDamage: number;

  /**
   * This Pokemon's moves, calculated against the opponent's active Pokemon.
   */
  movesVsOpponent: AdvisorMove[];

  /**
   * The opponent's moves, calculated against this Pokemon.
   */
  opponentMovesVsIt: AdvisorMove[];

  /**
   * Extra score from things the adapter knows about (e.g., *Intimidate*), with reasons.
   */
  bonus?: number;
  bonusReasons?: string[];
}

/**
 * What the advisor expects if the opponent switches out this turn.
 *
 * @since 1.4.3
 */
export interface AdvisorOpponentSwitch {
  /**
   * Chance they switch, `0` to `1`.
   */
  chance: number;

  /**
   * Their most likely switch-in, with their side's hazard damage already taken off its HP.
   */
  target: AdvisorMon;

  /**
   * Your active Pokemon's moves, calculated against `target`.
   */
  myMovesVsTarget: AdvisorMove[];

  /**
   * Why they'd switch & why to that Pokemon.
   */
  reasons?: string[];
}

/**
 * What the advisor expects if the opponent Terastallizes this turn.
 *
 * @since 1.4.3
 */
export interface AdvisorOpponentTera {
  chance: number;
  type: string;

  /**
   * Their active Pokemon after Terastallizing.
   */
  opponent: AdvisorMon;

  /**
   * Your active Pokemon's moves, calculated against their Tera'd Pokemon.
   */
  myMovesVsTera: AdvisorMove[];

  /**
   * Their Tera'd Pokemon's moves, calculated against your active Pokemon.
   */
  opponentMovesVsMe: AdvisorMove[];
  reasons?: string[];
}

/**
 * @since 1.4.3
 */
export interface AdvisorInput {
  me: AdvisorMon;
  opponent: AdvisorMon;

  /**
   * Your active Pokemon's moves, calculated against the opponent's active Pokemon.
   */
  myMoves: AdvisorMove[];

  /**
   * The opponent's moves, calculated against your active Pokemon.
   */
  opponentMoves: AdvisorMove[];

  switches: AdvisorSwitchOption[];

  /**
   * Whether your active Pokemon fainted & you must pick a replacement (no hit taken on entry).
   */
  forcedSwitch?: boolean;

  trickRoom?: boolean;

  /**
   * Hazard IDs already on the opponent's side.
   */
  opponentHazards?: string[];

  /**
   * Opponent's Pokemon that haven't fainted yet, including the active one.
   */
  opponentRemaining?: number;

  /**
   * Move your active Pokemon is locked into (*Choice* items, *Gorilla Tactics*), if any.
   */
  lockedMove?: string;

  /**
   * What's locking you in, for the reasons list (e.g., `'Choice Scarf'`).
   */
  lockedSource?: string;

  /**
   * Whether you can't switch out (*Shadow Tag*, *Arena Trap*, *Mean Look*, partial trapping, etc.).
   */
  trapped?: boolean;

  /**
   * Score added to every switch for what your active Pokemon gains by leaving (e.g., *Regenerator*), with reasons.
   */
  switchOutBonus?: number;
  switchOutReasons?: string[];

  /**
   * How much losing your active Pokemon hurts the game plan, `0` (fodder) to `1` (win condition).
   *
   * @default 0.5
   */
  activeValue?: number;

  /**
   * Why `activeValue` is what it is, e.g., `'your win condition'`.
   */
  activeRole?: string;

  /**
   * Why your active Pokemon's job is done, if it is (e.g., `'its hazards are already up'`); makes it more expendable.
   */
  activeJobDone?: string;

  /**
   * A damaged teammate that *Healing Wish* / *Lunar Dance* would be worth spending on, if any.
   */
  benchNeedsHealing?: string;

  /**
   * Party index of your ace, which shouldn't be the "safe switch" that talks you out of a sack.
   */
  aceIndex?: number;

  /**
   * How much risk to take: when you're behind, a chance at a KO is worth gambling on;
   * when you're ahead, the safe play keeps the lead.
   *
   * @default 'even'
   */
  riskMode?: 'behind' | 'even' | 'ahead';

  /**
   * What happens if they switch out this turn, if the adapter thinks they might.
   */
  opponentSwitch?: AdvisorOpponentSwitch;

  /**
   * What happens if they Terastallize this turn, if the adapter thinks they might.
   */
  opponentTera?: AdvisorOpponentTera;

  /**
   * Your Tera, if you still have it: your active Pokemon Tera'd & everything recalculated around that.
   */
  myTera?: AdvisorMyTera;
}

/**
 * Your active Pokemon after Terastallizing, for weighing *Tera + move* options.
 *
 * @since 1.4.3
 */
export interface AdvisorMyTera {
  type: string;
  me: AdvisorMon;

  /**
   * Your moves while Tera'd, calculated against their active Pokemon.
   */
  myMoves: AdvisorMove[];

  /**
   * Their moves, calculated against your Tera'd Pokemon.
   */
  opponentMovesVsMe: AdvisorMove[];

  /**
   * Score cost of spending Tera now (it's once per battle), with the reason.
   */
  cost: number;
  costReason?: string;

  /**
   * Battle context for the Tera timing rules.
   */
  context?: {
    /**
     * Their Pokemon you haven't seen yet.
     */
    unseen?: number;

    /**
     * Your Pokemon left minus theirs (negative when behind).
     */
    lead?: number;

    /**
     * Whether your active is your ace or only answer to something.
     */
    key?: boolean;
  };
}

/**
 * A scored option, either a move or a switch.
 *
 * @since 1.4.3
 */
export interface AdvisorChoice {
  type: 'move' | 'switch';
  name: string;

  /**
   * Party index (switches only).
   */
  index?: number;

  score: number;

  /**
   * Short, human-readable reasons, most important first.
   */
  reasons: string[];

  /**
   * Chance that this option KOs the opponent this turn (moves) or next turn (switches), `0` to `1`.
   */
  koChance?: number;

  /**
   * Chance you get KO'd this turn (moves) or on the way in (switches), `0` to `1`.
   */
  riskChance?: number;

  /**
   * Whether this move is a sack: you'll likely faint, but your next Pokemon comes in for free.
   */
  sack?: boolean;

  /**
   * Who comes in after the sack.
   */
  sackInto?: string;

  /**
   * Tera type to Terastallize into before using this move, if this option includes your Tera.
   */
  tera?: string;

  /**
   * Switches only: HP the switch-in loses coming in (hazards + the hit), as a fraction of its max HP.
   */
  takenFraction?: number;

  /**
   * Moves only: a pivot that moves first, so your switch-in takes their hit instead of you.
   */
  pivotOut?: boolean;
}

/**
 * The opponent move the advisor expects you to face.
 *
 * @since 1.4.3
 */
export interface AdvisorThreat {
  name: string;

  /**
   * Max damage as a fraction of your active's current HP (can exceed `1`).
   */
  maxFraction: number;
  koChance: number;
  movesFirst: number;
  guessed?: boolean;
}

/**
 * @since 1.4.3
 */
export interface AdvisorResult {
  /**
   * Overall pick: the best move, or the best switch if it's clearly better.
   */
  verdict: AdvisorChoice;
  moves: AdvisorChoice[];
  switches: AdvisorChoice[];
  threat: AdvisorThreat;

  /**
   * Move you're locked into, if any (e.g., from a *Choice* item).
   */
  locked?: string;

  /**
   * Straight yes/no calls on the big one-off decisions this turn, with the reason.
   */
  decisions?: {
    tera?: { use: boolean; text: string; };
    sack?: { sack: boolean; text: string; };
  };

  /**
   * What the advisor thinks the opponent will do besides attacking.
   */
  prediction?: {
    switchChance: number;
    switchTo?: string;
    switchReasons?: string[];
    teraChance: number;
    teraType?: string;
    teraReasons?: string[];
  };

  notes: string[];
}

/**
 * How much better a switch has to score before it's recommended over attacking.
 *
 * * Switching gives up a turn of damage, so it has to clearly beat staying in.
 *
 * @since 1.4.3
 */
export const AdvisorSwitchMargin = 10;

const pct = (value: number): string => `${Math.round(Math.max(0, value) * 100)}%`;

const firstKoLabel = (chance: number): string => (
  chance >= 0.995 ? 'they KO you first' : `they may KO you first (${pct(chance)})`
);

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value || 0));

/**
 * Chance (`0` to `1`) that a roll from `rolls` deals at least `hp` damage.
 *
 * @since 1.4.3
 */
export const koProbability = (rolls: number[], hp: number): number => {
  if (!rolls?.length) {
    return 0;
  }

  if (hp <= 0) {
    return 1;
  }

  return rolls.filter((r) => r >= hp).length / rolls.length;
};

/**
 * Average damage from `rolls`, capped at `hp` since you can't deal more than what's left.
 *
 * @since 1.4.3
 */
export const meanDamage = (rolls: number[], hp: number): number => {
  if (!rolls?.length || hp <= 0) {
    return 0;
  }

  return rolls.reduce((sum, r) => sum + Math.min(r, hp), 0) / rolls.length;
};

const maxRoll = (rolls: number[]): number => (rolls?.length ? Math.max(...rolls) : 0);

const isDamaging = (move: AdvisorMove): boolean => move?.kind === 'attack' && maxRoll(move.rolls) > 0;

type AdvisorTarget = Pick<AdvisorMon, 'hp'> & Partial<Pick<AdvisorMon, 'maxHp' | 'sash'>>;

/**
 * Damage rolls of `move` against `target`, after *Focus Sash* / *Sturdy* leave it at 1 HP from full.
 *
 * @since 1.4.3
 */
export const effectiveRolls = (move: AdvisorMove, target: AdvisorTarget): number[] => {
  const rolls = move?.rolls || [];
  const full = !!target?.maxHp && target.hp >= target.maxHp;

  if (!target?.sash || !full || move?.multihit || target.hp <= 1) {
    return rolls;
  }

  return rolls.map((r) => Math.min(r, target.hp - 1));
};

/**
 * Chance (`0`, `0.5` or `1`) that `a` moves before `b`.
 *
 * @since 1.4.3
 */
export const firstMoveProbability = (
  aPriority: number,
  aSpeed: number,
  bPriority: number,
  bSpeed: number,
  trickRoom?: boolean,
): number => {
  if ((aPriority || 0) !== (bPriority || 0)) {
    return (aPriority || 0) > (bPriority || 0) ? 1 : 0;
  }

  if (aSpeed === bSpeed) {
    return 0.5;
  }

  const faster = aSpeed > bSpeed;

  return (trickRoom ? !faster : faster) ? 1 : 0;
};

/**
 * Picks the move the `attacker` will most likely click against `target` (or a target with that much HP left).
 *
 * * Assumes the opponent goes for the KO if they have one, then for the most damage.
 *
 * @since 1.4.3
 */
export const pickThreat = (
  moves: AdvisorMove[],
  target: number | AdvisorTarget,
): AdvisorMove => {
  const attacks = (moves || []).filter(isDamaging);

  if (!attacks.length) {
    return null;
  }

  const t: AdvisorTarget = typeof target === 'number' ? { hp: target } : target;

  const value = (m: AdvisorMove) => {
    const rolls = effectiveRolls(m, t);

    return (m.accuracy * koProbability(rolls, t.hp) * 1000)
      + (m.accuracy * meanDamage(rolls, t.hp));
  };

  return attacks.reduce((best, m) => (value(m) > value(best) ? m : best));
};

/**
 * Outcome of one turn where `a` uses `aMove` and `b` uses `bMove`.
 *
 * @since 1.4.3
 */
export interface AdvisorExchange {
  aFirst: number;

  /**
   * Chance `a` KOs `b` this turn.
   */
  aKOs: number;

  /**
   * Chance `b` KOs `a` this turn.
   */
  bKOs: number;

  /**
   * Chance `a` gets to act at all (i.e., isn't KO'd first).
   */
  aActs: number;

  /**
   * Expected damage `a` deals, as a fraction of `b`'s current HP.
   */
  dealt: number;

  /**
   * Expected damage `a` deals in absolute HP.
   */
  dealtAbs: number;
}

/**
 * Simulates one turn between two Pokemon, accounting for move order, accuracy & who KOs whom first.
 *
 * @since 1.4.3
 */
export const simulateExchange = (
  a: AdvisorTarget & Pick<AdvisorMon, 'speed'> & Partial<Pick<AdvisorMon, 'actChance'>>,
  aMove: AdvisorMove,
  b: AdvisorTarget & Pick<AdvisorMon, 'speed'> & Partial<Pick<AdvisorMon, 'actChance'>>,
  bMove: AdvisorMove,
  trickRoom?: boolean,
): AdvisorExchange => {
  const aFirst = firstMoveProbability(aMove?.priority, a.speed, bMove?.priority, b.speed, trickRoom);
  const aRolls = effectiveRolls(aMove, b);
  const bRolls = effectiveRolls(bMove, a);

  // sleep, freeze, full paralysis & confusion can stop either side from moving at all
  const aCan = clamp01(aMove?.actChance ?? (a as AdvisorMon).actChance ?? 1);
  const bCan = clamp01(bMove?.actChance ?? (b as AdvisorMon).actChance ?? 1);
  const aHits = isDamaging(aMove) ? aCan * aMove.accuracy * koProbability(aRolls, b.hp) : 0;
  const bHits = isDamaging(bMove) ? bCan * bMove.accuracy * koProbability(bRolls, a.hp) : 0;

  // if a moves first: a KOs w/ aHits; else b gets a turn & might KO a
  // if b moves first: b KOs w/ bHits; a only acts if it survived
  const aKOs = (aFirst * aHits) + ((1 - aFirst) * (1 - bHits) * aHits);
  const bKOs = (aFirst * (1 - aHits) * bHits) + ((1 - aFirst) * bHits);
  const aActs = aCan * (aFirst + ((1 - aFirst) * (1 - bHits)));

  const dealtAbs = isDamaging(aMove)
    ? aActs * aMove.accuracy * meanDamage(aRolls, b.hp)
    : 0;

  return {
    aFirst,
    aKOs: clamp01(aKOs),
    bKOs: clamp01(bKOs),
    aActs: clamp01(aActs),
    dealt: b.hp > 0 ? clamp01(dealtAbs / b.hp) : 0,
    dealtAbs,
  };
};

const StatusValues: Record<string, number> = {
  slp: 50,
  par: 30,
  brn: 24,
  tox: 28,
  psn: 14,
};

const StatusLabels: Record<string, string> = {
  slp: 'Sleep',
  par: 'Paralysis',
  brn: 'Burn',
  tox: 'Toxic',
  psn: 'Poison',
};

/**
 * Scores one of `me`'s moves against `opponent`, assuming the opponent answers with `threat`.
 *
 * @since 1.4.3
 */
export const scoreMove = (
  move: AdvisorMove,
  me: AdvisorMon,
  opponent: AdvisorMon,
  threat: AdvisorMove,
  context?: Pick<AdvisorInput, 'trickRoom' | 'opponentHazards' | 'opponentRemaining'>,
): AdvisorChoice => {
  const { trickRoom, opponentHazards, opponentRemaining = 6 } = context || {};
  const reasons: string[] = [];
  const ex = simulateExchange(me, move, opponent, threat, trickRoom);

  const output: AdvisorChoice = {
    type: 'move',
    name: move.name,
    score: 0,
    reasons,
    koChance: ex.aKOs,
    riskChance: ex.bKOs,
  };

  // how scary the opponent's answer is, regardless of what we click
  const threatMax = maxRoll(effectiveRolls(threat, me));
  // a sleeping / frozen opponent mostly can't punish you, so setting up is safer
  const theyCan = opponent.actChance ?? 1;
  const survivesTwo = !threat || (threatMax * 2) < me.hp || theyCan <= 0.4;
  const survivesOne = !threat || threatMax < me.hp || theyCan <= 0.7;

  if (move.kind === 'attack') {
    if (!move.rolls.length) {
      output.score = 0;
      reasons.push('Couldn\'t calculate damage');

      return output;
    }

    if (maxRoll(move.rolls) <= 0) {
      output.score = -50;
      reasons.push(`No effect on ${opponent.name}`);

      return output;
    }

    // chance of a 2HKO if we don't KO now (assumes a similar roll next turn); needs us to act, too
    const myCan = clamp01(move.actChance ?? me.actChance ?? 1);
    const twoHit = myCan * move.accuracy * koProbability(move.rolls.map((r) => r * 2), opponent.hp);

    output.score = (100 * ex.aKOs)
      + (45 * ex.dealt * (1 - ex.aKOs))
      + (12 * twoHit * (1 - ex.aKOs) * (1 - ex.bKOs))
      - (50 * ex.bKOs);

    if (move.recoil) {
      output.score -= 30 * Math.min(1, (move.recoil * ex.dealtAbs) / Math.max(1, me.hp));
    }

    if (move.drain) {
      output.score += 15 * Math.min(1, (move.drain * ex.dealtAbs) / Math.max(1, me.maxHp));
    }

    if (move.selfDamage) {
      const chip = (move.selfDamage * me.maxHp) / Math.max(1, me.hp);

      output.score -= 25 * Math.min(1, chip) * ex.aActs;

      if (chip >= 1) {
        reasons.push(`${move.selfDamageSource || 'Recoil'} would KO you`);
      } else if (chip >= 0.1) {
        reasons.push(`-${pct(move.selfDamage)} from ${move.selfDamageSource || 'recoil'}`);
      }
    }

    const sashBlocks = !!opponent.sash
      && opponent.hp >= opponent.maxHp
      && !move.multihit
      && koProbability(move.rolls, opponent.hp) > 0;

    // a pivot that moves first gets you out before their hit lands, so this one isn't going down
    if (move.pivot && ex.aFirst === 1 && ex.aActs >= 0.9) {
      output.score += (50 * ex.bKOs) + 8;
      output.riskChance = 0;
      output.pivotOut = true;

      if (ex.bKOs > 0.3) {
        reasons.push('pivots out before their hit lands');
      }
    } else if (move.pivot && ex.bKOs > 0.3) {
      output.score += 12;
      reasons.push('Pivots out of a bad matchup');
    }

    if (ex.aKOs >= 0.995) {
      reasons.push(`KOs ${opponent.name}`);
    } else if (sashBlocks) {
      reasons.push(`${opponent.sashSource || 'Focus Sash'} leaves it at 1 HP`);
    } else if (ex.aKOs > 0.01) {
      reasons.push(`${pct(ex.aKOs)} to KO`);
    } else {
      const [lo, hi] = [Math.min(...move.rolls), Math.max(...move.rolls)]
        .map((d) => Math.min(d, opponent.hp) / Math.max(1, opponent.maxHp));

      reasons.push(`${pct(lo)}-${pct(hi)} damage`);

      if (twoHit > 0.5) {
        reasons.push('2HKO');
      }
    }

    if (move.accuracy < 0.95) {
      reasons.push(`${pct(move.accuracy)} accurate`);
    }

    if (myCan < 0.95) {
      reasons.push(`only ${pct(myCan)} to act (${me.actNote || 'status'})`);
    } else if ((me.actChance ?? 1) < 0.95 && (move.actChance ?? 0) >= 0.95) {
      reasons.push(`works through ${me.actNote || 'your status'}`);
    }

    if (threat && ex.bKOs > 0.01 && ex.aFirst < 1) {
      reasons.push(firstKoLabel(ex.bKOs));
    } else if (threat && me.sash && me.hp >= me.maxHp && koProbability(threat.rolls, me.hp) > 0) {
      reasons.push(`your ${me.sashSource || 'Focus Sash'} survives ${threat.name}`);
    } else if (move.priority > 0 && ex.aFirst === 1 && threat) {
      reasons.push('priority: moves first');
    }

    return output;
  }

  // status-ish moves only matter if we actually get to use them
  const acts = ex.aActs;

  switch (move.kind) {
    case 'setup': {
      output.score = (survivesTwo && 55) || (survivesOne && 22) || 2;
      reasons.push((survivesTwo && 'Safe to set up') || (survivesOne && 'Can set up once') || 'Too risky to set up');

      break;
    }

    case 'recovery': {
      const missing = 1 - (me.hp / Math.max(1, me.maxHp));
      const healed = (move.heal || 0.5) * me.maxHp;
      const threatAvg = threat ? threat.accuracy * meanDamage(threat.rolls, me.hp + healed) : 0;

      if (missing < 0.25) {
        output.score = 2;
        reasons.push('Already healthy');
      } else if (threatAvg < healed) {
        output.score = 25 + (50 * missing);
        reasons.push(`Heals ${pct(Math.min(missing, move.heal || 0.5))}, outheals their hit`);
      } else {
        output.score = 8;
        reasons.push('Their hit outdamages the healing');
      }

      break;
    }

    case 'hazard': {
      const alreadySet = !!move.hazard
        && move.hazard !== 'spikes'
        && move.hazard !== 'toxicspikes'
        && opponentHazards?.includes(move.hazard);

      if (alreadySet) {
        output.score = 0;
        reasons.push('Already up');
      } else {
        const benched = Math.max(0, opponentRemaining - 1);

        output.score = ((benched >= 3 && 45) || (benched === 2 && 32) || (benched === 1 && 15) || 1) * acts;
        reasons.push(benched ? `${benched} of theirs left to switch in` : 'No switch-ins left');
      }

      break;
    }

    case 'status': {
      if (opponent.status) {
        output.score = 0;
        reasons.push(`${opponent.name} is already statused`);

        break;
      }

      let value = StatusValues[move.status] ?? 15;

      if (move.status === 'brn' && opponent.physical) {
        value += 18;
        reasons.push('Cripples a physical attacker');
      }

      if (move.status === 'par' && opponent.speed > me.speed) {
        value += 10;
        reasons.push('They outspeed you');
      }

      output.score = value * move.accuracy * acts;
      reasons.unshift(`${StatusLabels[move.status] || 'Status'}${move.accuracy < 0.95 ? ` (${pct(move.accuracy)} accurate)` : ''}`);

      break;
    }

    case 'protect': {
      output.score = 5;
      reasons.push('Scouts their move');

      break;
    }

    default: {
      output.score = 4;

      break;
    }
  }

  if (acts < 0.6 && threat) {
    reasons.push(firstKoLabel(1 - acts));
  }

  return output;
};

/**
 * Scores one of your moves if the opponent switches into `target` this turn (so you aren't hit back).
 *
 * @since 1.4.3
 */
export const scoreMoveVsSwitchIn = (
  move: AdvisorMove,
  moveVsTarget: AdvisorMove,
  base: AdvisorChoice,
  target: AdvisorMon,
): { score: number; reason: string; } => {
  if (move.kind === 'attack') {
    const rolls = effectiveRolls(moveVsTarget, target);

    if (!moveVsTarget || !rolls.length) {
      return { score: 0, reason: null };
    }

    if (maxRoll(rolls) <= 0) {
      return { score: -30, reason: `does nothing to ${target.name}` };
    }

    const ko = moveVsTarget.accuracy * koProbability(rolls, target.hp);
    const dealt = (moveVsTarget.accuracy * meanDamage(rolls, target.hp)) / Math.max(1, target.maxHp);

    return {
      score: (100 * ko) + (60 * dealt),
      reason: ko > 0.5
        ? `KOs ${target.name} if it switches in`
        : `${pct(dealt)} to ${target.name} if it switches in`,
    };
  }

  // a switch is a free turn for these
  switch (move.kind) {
    case 'setup': {
      return { score: 50, reason: 'free setup if they switch' };
    }

    case 'hazard': {
      return { score: base.score + 10, reason: null };
    }

    case 'protect': {
      return { score: 0, reason: null };
    }

    default: {
      return { score: base.score, reason: null };
    }
  }
};

/**
 * Scores switching into `option`, given the opponent was planning to hit your active Pokemon with `threat`.
 *
 * @since 1.4.3
 */
export const scoreSwitch = (
  option: AdvisorSwitchOption,
  opponent: AdvisorMon,
  threat: AdvisorMove,
  context?: Pick<
    AdvisorInput,
    'trickRoom' | 'opponentHazards' | 'opponentRemaining' | 'forcedSwitch' | 'switchOutBonus' | 'opponentSwitch'
  >,
): AdvisorChoice => {
  const { forcedSwitch } = context || {};
  const { mon, entryDamage = 0 } = option;
  const reasons: string[] = [];

  const output: AdvisorChoice = {
    type: 'switch',
    name: mon.name,
    index: option.index,
    score: 0,
    reasons,
  };

  const hpIn = mon.hp - entryDamage;

  if (hpIn <= 0) {
    output.score = -999;
    output.riskChance = 1;
    reasons.push('Faints to hazards');

    return output;
  }

  // on a hard switch, the incoming Pokemon eats whatever they were going to click (the same move, if they have it)
  const incoming = forcedSwitch
    ? null
    : option.opponentMovesVsIt.find((m) => m.name === threat?.name && m.kind === 'attack') || null;

  const entryTarget: AdvisorTarget = { hp: hpIn, maxHp: mon.maxHp, sash: mon.sash };
  const incomingRolls = incoming ? effectiveRolls(incoming, entryTarget) : [];
  // if they switch too, your switch-in doesn't get hit
  const attackChance = 1 - (context?.opponentSwitch?.chance || 0);
  const entryDie = incoming ? attackChance * incoming.accuracy * koProbability(incomingRolls, hpIn) : 0;
  const entryTaken = incoming ? attackChance * incoming.accuracy * meanDamage(incomingRolls, hpIn) : 0;
  const hpAfter = Math.max(1, hpIn - entryTaken);

  // next turn: our best move vs whatever they'd pick vs us now
  const settled: AdvisorMon = { ...mon, hp: hpAfter };
  const nextThreat = pickThreat(option.opponentMovesVsIt, settled);

  const nextMoves = option.movesVsOpponent
    .map((m) => scoreMove(m, settled, opponent, nextThreat, context))
    .sort((a, b) => b.score - a.score);

  const bestNext = nextMoves[0];

  output.riskChance = entryDie;
  output.takenFraction = (entryTaken + entryDamage) / Math.max(1, mon.maxHp);
  output.koChance = bestNext?.koChance || 0;
  output.score = (-110 * entryDie)
    - (45 * ((entryTaken + entryDamage) / Math.max(1, mon.maxHp)))
    + (0.75 * (bestNext?.score || 0) * (1 - entryDie))
    - (forcedSwitch ? 0 : 8)
    + (option.bonus || 0)
    + (forcedSwitch ? 0 : (context?.switchOutBonus || 0));

  reasons.push(...(option.bonusReasons || []));

  if (incoming) {
    const maxIn = maxRoll(incoming.rolls);

    if (maxIn <= 0) {
      output.score += 10;
      reasons.push(`Immune to ${incoming.name}`);
    } else if (entryDie > 0.01) {
      reasons.push(`${pct(entryDie)} to faint to ${incoming.name}`);
    } else {
      const lo = Math.min(...incoming.rolls) / Math.max(1, mon.maxHp);
      const hi = maxIn / Math.max(1, mon.maxHp);

      reasons.push(`Takes ${pct(lo)}-${pct(hi)} from ${incoming.name}`);
    }
  } else if (!forcedSwitch && threat) {
    output.score += 10;
    reasons.push(`Doesn't take ${threat.name}`);
  }

  if (entryDamage > 0) {
    reasons.push(`-${pct(entryDamage / Math.max(1, mon.maxHp))} from hazards`);
  }

  if (bestNext) {
    // pro tip: after a faint, the best pick is often the one that revenge-kills
    if (forcedSwitch && (bestNext.koChance || 0) >= 0.7 && (bestNext.riskChance || 0) < 0.3) {
      output.score += 10;
      reasons.unshift(`revenge-kills ${opponent.name} with ${bestNext.name}`);
    } else {
      reasons.push(`then ${bestNext.name}: ${bestNext.reasons[0] || 'best option'}`);
    }
  }

  if (nextThreat && bestNext?.riskChance > 0.5) {
    reasons.push(`but ${nextThreat.name} likely KOs it`);
  }

  return output;
};

/**
 * Ranks every move & switch available to you this turn.
 *
 * * Looks one turn ahead: who moves first, who KOs whom, and (for switches) what happens the turn after.
 * * The opponent is assumed to click their strongest move against your active Pokemon.
 *
 * @since 1.4.3
 */
export const scoreBattleAdvice = (input: AdvisorInput): AdvisorResult => {
  const {
    me,
    opponent,
    myMoves = [],
    opponentMoves = [],
    switches = [],
    forcedSwitch,
    trickRoom,
  } = input || {} as AdvisorInput;

  const notes: string[] = [];

  const output: AdvisorResult = {
    verdict: null,
    moves: [],
    switches: [],
    threat: null,
    notes,
  };

  if (!me || !opponent) {
    return output;
  }

  const threat = pickThreat(opponentMoves, me);

  if (threat) {
    const threatRolls = effectiveRolls(threat, me);

    output.threat = {
      name: threat.name,
      maxFraction: maxRoll(threatRolls) / Math.max(1, me.hp),
      koChance: threat.accuracy * koProbability(threatRolls, me.hp),
      movesFirst: 1 - firstMoveProbability(0, me.speed, threat.priority, opponent.speed, trickRoom),
      guessed: threat.guessed,
    };
  } else if (!opponentMoves.length) {
    notes.push(`${opponent.name}'s moves are unknown, so incoming damage isn't accounted for.`);
  }

  if (opponentMoves.some((m) => m.guessed)) {
    notes.push(`Some of ${opponent.name}'s moves are guessed from its likely set.`);
  }

  const normalize = (name: string) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const { opponentSwitch, opponentTera } = input;
  const switchChance = clamp01(opponentSwitch?.target ? opponentSwitch.chance : 0);
  const teraChance = Math.min(clamp01(opponentTera?.opponent ? opponentTera.chance : 0), 1 - switchChance);
  const teraThreat = teraChance > 0 ? pickThreat(opponentTera.opponentMovesVsMe, me) : null;

  if (switchChance > 0 || teraChance > 0) {
    output.prediction = {
      switchChance,
      switchTo: switchChance > 0 ? opponentSwitch.target.name : null,
      switchReasons: opponentSwitch?.reasons || [],
      teraChance,
      teraType: teraChance > 0 ? opponentTera.type : null,
      teraReasons: opponentTera?.reasons || [],
    };
  }

  let teraEval: { gain: number; cost: number; type: string; timing?: string[]; } = null;
  let sackCheck: { expendable: boolean; safeSwitch: string; jobDone: string; } = null;

  if (!forcedSwitch) {
    const locked = input.lockedMove
      ? myMoves.find((m) => normalize(m.name) === normalize(input.lockedMove))
      : null;

    // Sleep Talk: while asleep, it's worth the average of the moves it can call (scored as if awake)
    const scoreSleepTalk = (m: AdvisorMove): AdvisorChoice => {
      const awake: AdvisorMon = { ...me, actChance: 1 };
      const callable = myMoves.filter((x) => (
        normalize(x.name) !== 'sleeptalk'
          && !['rest', 'snore', 'solarbeam', 'skyattack', 'meteorbeam', 'electroshot', 'futuresight'].includes(normalize(x.name))
      ));

      const scores = callable.map((x) => scoreMove(x, awake, opponent, threat, input));
      const avg = scores.length ? scores.reduce((sum, c) => sum + c.score, 0) / scores.length : 0;
      const choice = scoreMove(m, me, opponent, threat, input);

      choice.score = avg;
      choice.koChance = scores.length ? scores.reduce((sum, c) => sum + (c.koChance || 0), 0) / scores.length : 0;
      choice.reasons = [`calls one of ${callable.map((x) => x.name).join(', ') || 'your moves'} at random`];

      return choice;
    };

    const finalize = (
      m: AdvisorMove,
      choice: AdvisorChoice,
      allowTeraBlend: boolean,
    ): AdvisorChoice => {
        // blend what happens if they stay in, switch out, or Tera
        // (before the lock & disabled overrides below, which always win)
        const theirTera = allowTeraBlend ? teraChance : 0;

        if (switchChance > 0 || theirTera > 0) {
          const stay = 1 - switchChance - theirTera;
          const base = { ...choice };
          let blended = stay * base.score;
          let ko = stay * (base.koChance || 0);
          let risk = stay * (base.riskChance || 0);

          if (switchChance > 0) {
            const vsTarget = opponentSwitch.myMovesVsTarget.find((x) => normalize(x.name) === normalize(m.name));
            const vsSwitch = scoreMoveVsSwitchIn(m, vsTarget, base, opponentSwitch.target);

            blended += switchChance * vsSwitch.score;

            if (vsSwitch.reason && switchChance >= 0.3) {
              choice.reasons.push(vsSwitch.reason);
            }
          }

          if (theirTera > 0) {
            const vsTeraMove = opponentTera.myMovesVsTera.find((x) => normalize(x.name) === normalize(m.name)) || m;
            const vsTera = scoreMove(vsTeraMove, me, opponentTera.opponent, teraThreat, input);

            blended += theirTera * vsTera.score;
            ko += theirTera * (vsTera.koChance || 0);
            risk += theirTera * (vsTera.riskChance || 0);

            if (theirTera >= 0.25 && m.kind === 'attack') {
              const dropped = (base.koChance || 0) - (vsTera.koChance || 0);

              if (maxRoll(vsTeraMove.rolls) <= 0 && maxRoll(m.rolls) > 0) {
                choice.reasons.push(`useless if they Tera ${opponentTera.type}`);
              } else if (dropped > 0.3) {
                choice.reasons.push(`Tera ${opponentTera.type} would survive it`);
              } else if ((base.koChance || 0) > 0.5 && (vsTera.koChance || 0) > 0.5) {
                choice.reasons.push(`KOs even through Tera ${opponentTera.type}`);
              }
            }
          }

          choice.score = blended;
          choice.koChance = ko;
          choice.riskChance = risk;
        }

        if (m.adjust) {
          choice.score += m.adjust;
        }

        // Explosion, Memento & co. throw away a Pokemon you'd otherwise keep; only worth it when it's going down anyway
        if (m.selfKO && (choice.riskChance || 0) < 0.7) {
          const value = input.activeValue ?? 0.5;

          choice.score -= 40 + (60 * value);
          choice.reasons.push(`faints ${me.name}, which would otherwise survive`);
        }

        // pro tip: behind -> gamble on KOs; ahead -> don't hand them chances
        if (m.kind === 'attack' && input.riskMode === 'behind' && (choice.koChance || 0) > 0.2) {
          choice.score += 15 * (choice.koChance || 0);

          if (m.accuracy < 0.95 && (choice.koChance || 0) > 0.4) {
            choice.reasons.push("you're behind, so the miss chance is worth it");
          }
        } else if (input.riskMode === 'ahead') {
          choice.score -= (20 * (choice.riskChance || 0)) + (m.kind === 'attack' ? 12 * (1 - m.accuracy) : 0);

          if (m.kind === 'attack' && m.accuracy < 0.9) {
            choice.reasons.push("you're ahead: a miss could cost the lead");
          }
        }

        if (m.adjustReasons?.length) {
          choice.reasons.push(...m.adjustReasons);
        }

        if (m.disabled) {
          choice.score = -300;
          choice.reasons.unshift(m.disabled);
        } else if (locked && normalize(m.name) !== normalize(locked.name)) {
          choice.score = -200;
          choice.reasons.unshift(`Locked into ${locked.name}`);
        }

        return choice;
    };

    const asleep = me.status === 'slp';

    // Sucker Punch & Thunderclap fail if you don't attack, so status moves face their next-best move instead
    const suckerIds = ['suckerpunch', 'thunderclap'];
    const threatVsStatus = threat && suckerIds.includes(normalize(threat.name))
      ? pickThreat(opponentMoves.filter((m) => !suckerIds.includes(normalize(m.name))), me)
      : threat;

    output.moves = myMoves
      .map((m) => finalize(
        m,
        asleep && normalize(m.name) === 'sleeptalk'
          ? scoreSleepTalk(m)
          : scoreMove(m, me, opponent, m.kind === 'attack' ? threat : threatVsStatus, input),
        true,
      ))
      .sort((a, b) => b.score - a.score);

    // Tera + move options: only kept when they beat the same move without Tera, after Tera's cost
    const { myTera } = input;

    if (myTera?.me && myTera.myMoves?.length) {
      const teraThreatVsMe = pickThreat(myTera.opponentMovesVsMe, myTera.me);

      teraEval = { gain: -Infinity, cost: myTera.cost || 0, type: myTera.type, timing: [] };

      const teraChoices = myTera.myMoves
        .map((tm) => {
          const original = myMoves.find((m) => normalize(m.name) === normalize(tm.name));
          const plain = output.moves.find((c) => normalize(c.name) === normalize(tm.name) && !c.tera);

          if (!original || original.disabled || !plain || plain.score <= -200) {
            return null;
          }

          const raw = scoreMove(tm, myTera.me, opponent, teraThreatVsMe, input);
          const choice = finalize({ ...tm, disabled: original.disabled }, raw, false);

          // how much Tera adds before its cost, for the yes/no call later
          teraEval.gain = Math.max(teraEval.gain, choice.score - plain.score);

          // Tera timing rules: defensive Tera on a key Pokemon is cheap; offensive Tera closes games;
          // don't Tera blind early, don't burn it when far behind, and keep it when you're cruising
          const { unseen = 0, lead = 0, key = false } = myTera.context || {};
          const defensiveSave = (plain.riskChance || 0) - (raw.riskChance || 0) > 0.4;
          const offensiveKO = (raw.koChance || 0) - (plain.koChance || 0) > 0.4;
          const timing: string[] = [];
          let cost = myTera.cost || 0;

          if (defensiveSave && key) {
            cost -= 8;
            timing.push('saves a key Pokémon');
          }

          if (unseen >= 3 && !defensiveSave) {
            cost += 10;
            timing.push(`early: ${unseen} of theirs are still unrevealed`);
          }

          if (lead >= 2 && !defensiveSave) {
            cost += 15;
            timing.push("you're cruising; holding Tera keeps them guessing");
          } else if (lead >= 1 && offensiveKO) {
            cost -= 5;
            timing.push('helps close the game out');
          }

          if (lead <= -2 && !offensiveKO && !defensiveSave) {
            cost += 10;
            timing.push('Tera rarely turns a game this far behind');
          }

          teraEval.cost = Math.max(teraEval.cost ?? 0, cost);
          teraEval.timing = timing;
          choice.score -= cost;
          choice.tera = myTera.type;

          const reasons: string[] = [];

          if ((choice.koChance || 0) - (plain.koChance || 0) > 0.25) {
            reasons.push(`Tera ${myTera.type} powers it up to ${pct(choice.koChance)} to KO`);
          }

          if ((plain.riskChance || 0) - (choice.riskChance || 0) > 0.25) {
            reasons.push(`Tera ${myTera.type} lets you survive ${threat?.name || 'their hit'}`);
          }

          if (myTera.costReason) {
            reasons.push(myTera.costReason);
          }

          reasons.push(...timing);

          choice.reasons = [...reasons, ...choice.reasons];

          return choice.score > plain.score ? choice : null;
        })
        .filter(Boolean);

      if (teraChoices.length) {
        output.moves = [...output.moves, ...teraChoices].sort((a, b) => b.score - a.score);
      }
    }

    if (locked) {
      output.locked = locked.name;
      notes.push(`You're locked into ${locked.name} by ${input.lockedSource || 'your Choice item'}; switching resets it.`);
    }
  }

  output.switches = input.trapped && !forcedSwitch ? [] : switches
    .map((s) => scoreSwitch(s, opponent, threat, input))
    .filter((s) => s.score > -999)
    .sort((a, b) => b.score - a.score);

  if (input.trapped && !forcedSwitch) {
    notes.push(`${me.name} is trapped and can't switch out.`);
  }

  if (!forcedSwitch && output.switches.length && input.switchOutReasons?.length) {
    notes.push(...input.switchOutReasons);
  }

  // a pivot that moves first is chip damage + a switch into your best switch-in (which then takes their hit)
  if (!forcedSwitch && output.switches.length) {
    const bestHard = output.switches[0];

    output.moves.forEach((choice) => {
      if (!choice.pivotOut || choice.score <= -200) {
        return;
      }

      choice.score += 0.8 * Math.max(0, bestHard.score);
      choice.reasons.push(`then ${bestHard.name} comes in`);
    });

    output.moves.sort((a, b) => b.score - a.score);
  }

  // sacking: if you're likely to faint anyway, staying in buys a free switch into your best answer,
  // which can beat hard-switching that answer in & eating a hit. costs whatever the active is worth to the plan.
  if (!forcedSwitch && switches.length && output.moves.length) {
    const freeSwitches = switches
      .map((s) => scoreSwitch(s, opponent, null, { ...input, forcedSwitch: true }))
      .filter((s) => s.score > -999)
      .sort((a, b) => b.score - a.score);

    const bestFree = freeSwitches[0];
    const bestHard = output.switches[0];
    const hpLeft = me.hp / Math.max(1, me.maxHp);

    // a finished job (e.g., hazards already up) makes a Pokemon more expendable
    const value = (input.activeValue ?? 0.5) * (input.activeJobDone ? 0.5 : 1);

    // pro rules: only sack what you can spare, and never when a switch-in takes the hit comfortably
    const expendable = value <= 0.5 || hpLeft < 0.3;
    const safeSwitch = output.switches.find((sw) => (
      (sw.riskChance || 0) < 0.1
        && (sw.takenFraction ?? 1) < 0.25
        && sw.index !== input.aceIndex
        && sw.score > -10
    ));

    sackCheck = {
      expendable,
      safeSwitch: safeSwitch?.name || null,
      jobDone: input.activeJobDone || null,
    };

    void bestHard;

    if (bestFree && expendable && !safeSwitch) {
      const theirThreat = threat;

      output.moves.forEach((choice) => {
        const faint = choice.riskChance || 0;

        // a move that's likely to KO them first isn't a sack, it's just winning the turn
        if (faint < 0.5 || choice.score <= -200 || (choice.koChance || 0) >= 0.5) {
          return;
        }

        // scoreMove() already docked 50 * faint for getting KO'd; swap that generic cost for what *this*
        // Pokemon is worth (role & remaining HP), then credit the free switch into your best answer
        const cost = 100 * value * (0.4 + (0.6 * hpLeft));

        choice.score += faint * (50 - cost + (0.75 * Math.max(0, bestFree.score)));

        if (faint < 0.7) {
          return;
        }

        choice.sack = true;
        choice.sackInto = bestFree.name;

        // get the most out of it on the way down
        const move = myMoves.find((m) => normalize(m.name) === normalize(choice.name));
        const lastMove: string[] = [];

        if (move?.lastWish === 'memento') {
          choice.score += 25;
          lastMove.push(`Memento cripples them for ${bestFree.name}`);
        } else if (move?.lastWish === 'healingwish' && input.benchNeedsHealing) {
          choice.score += 30;
          lastMove.push(`fully heals ${input.benchNeedsHealing} on the way out`);
        } else if (move?.lastWish === 'destinybond') {
          const first = firstMoveProbability(move.priority, me.speed, theirThreat?.priority, opponent.speed, trickRoom);

          if (first === 1) {
            choice.score += 60;
            lastMove.push(`takes ${opponent.name} down with it`);
          }
        }

        const actsFirst = firstMoveProbability(move?.priority, me.speed, theirThreat?.priority, opponent.speed, trickRoom);

        if (actsFirst === 0 && (me.actChance ?? 1) > 0 && !lastMove.length) {
          lastMove.push(`it may not get to move, but ${choice.name} is the best pick if it does`);
        }

        choice.reasons = [
          ...lastMove,
          ...choice.reasons,
          `then ${bestFree.name} comes in for free`,
        ];
      });

      output.moves.sort((a, b) => b.score - a.score);

      if (value >= 0.9 && output.moves[0]?.riskChance >= 0.7) {
        notes.push(`${me.name} is ${input.activeRole || 'important to your plan'}; think twice before sacking it.`);
      }
    }
  }

  const bestMove = output.moves[0] || null;
  const bestSwitch = output.switches[0] || null;

  if (forcedSwitch || !bestMove) {
    output.verdict = bestSwitch;
  } else if (bestSwitch && bestSwitch.score > bestMove.score + AdvisorSwitchMargin) {
    output.verdict = bestSwitch;
  } else {
    output.verdict = bestMove;
  }

  // --- yes/no calls on Tera & sacking ---

  const verdict = output.verdict;
  const decisions: AdvisorResult['decisions'] = {};

  if (verdict && !forcedSwitch && teraEval) {
    const { gain, cost, type } = teraEval;

    if (verdict.tera) {
      decisions.tera = {
        use: true,
        text: `Use Tera ${type} now: ${verdict.reasons[0] || 'it wins the turn'}.`,
      };
    } else if (!Number.isFinite(gain) || gain <= 5) {
      decisions.tera = { use: false, text: `Save Tera ${type}: it doesn't change this turn much.` };
    } else if (input.myTera?.costReason && gain <= cost) {
      decisions.tera = { use: false, text: `Save Tera ${type}: it ${input.myTera.costReason}.` };
    } else if (teraEval.timing?.length && gain <= cost) {
      decisions.tera = { use: false, text: `Save Tera ${type}: ${teraEval.timing[teraEval.timing.length - 1]}.` };
    } else if (verdict.type === 'switch') {
      decisions.tera = { use: false, text: `Save Tera ${type}: switching beats Tera-ing here.` };
    } else {
      decisions.tera = { use: false, text: `Save Tera ${type}: it helps a little now, but it's worth more later.` };
    }
  }

  const stayChoice = output.moves.find((c) => !c.tera && c.score > -200);
  const stayRisk = stayChoice?.riskChance || 0;

  if (verdict && !forcedSwitch && stayChoice && stayRisk >= 0.6 && switches.length) {
    const value = input.activeValue ?? 0.5;
    const hpLeft = me.hp / Math.max(1, me.maxHp);

    if (verdict.sack) {
      const why = (input.activeJobDone && `${me.name} has done its job (${input.activeJobDone})`)
        || (value <= 0.2 && `${me.name} isn't doing much for your plan`)
        || (hpLeft < 0.35 && `${me.name} is low anyway`)
        || `${me.name} is going down regardless`;

      decisions.sack = {
        sack: true,
        text: `Good sack: ${why}. Go out with ${verdict.name} (${verdict.reasons[0]}), then bring in ${verdict.sackInto} for free.`,
      };
    } else if (sackCheck?.safeSwitch && verdict.type === 'switch') {
      decisions.sack = {
        sack: false,
        text: `Don't sack ${me.name}: ${sackCheck.safeSwitch} takes the hit comfortably, so keep both.`,
      };
    } else if (verdict.type === 'switch') {
      decisions.sack = {
        sack: false,
        text: value >= 0.9
          ? `Don't sack ${me.name}: it's ${input.activeRole || 'important to your plan'}. Switch to ${verdict.name}.`
          : `Don't sack ${me.name}: switching to ${verdict.name} saves it for later.`,
      };
    } else {
      decisions.sack = {
        sack: true,
        text: `${me.name} will likely faint this turn; ${verdict.name} gets the most out of it before it goes.`,
      };
    }
  }

  if (decisions.tera || decisions.sack) {
    output.decisions = decisions;
  }

  return output;
};
