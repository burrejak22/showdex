/**
 * @file `scoreTeamGuide.ts`
 * @since 1.4.3
 */

import { type AdvisorDuel, type GamePlan } from './scoreGamePlan';

/**
 * What one of your Pokemon brings to the team, as far as the guide cares.
 *
 * @since 1.4.3
 */
export interface TeamGuideMon {
  index: number;
  name: string;

  /**
   * Remaining HP, `0` to `1`.
   */
  hpFraction: number;
  speed: number;

  /**
   * Whether it's been sent out yet this battle.
   */
  revealed?: boolean;

  setupMoves?: string[];
  priorityMoves?: string[];
  pivotMoves?: string[];
  hazardMoves?: string[];
  removalMoves?: string[];
  recoveryMoves?: string[];
  statusMoves?: string[];
}

/**
 * @since 1.4.3
 */
export interface TeamGuideInput {
  mine: TeamGuideMon[];
  theirs: { index: number; name: string; hpFraction: number; }[];

  /**
   * `duels[myIndex][theirIndex]`, from the game plan.
   */
  duels: Record<number, Record<number, AdvisorDuel>>;
  plan: GamePlan;

  /**
   * How many of theirs you've seen, out of how many they have.
   */
  seen: number;
  teamSize: number;

  riskMode?: 'behind' | 'even' | 'ahead';
}

/**
 * @since 1.4.3
 */
export interface TeamGuideRole {
  index: number;
  name: string;

  /**
   * Short label, e.g., `'Ace'`, `'Hazard setter'`, `'Pivot'`, `'Sack'`.
   */
  role: string;

  /**
   * One line on how to use it.
   */
  tip: string;
}

/**
 * @since 1.4.3
 */
export interface TeamGuide {
  ace: {
    index: number;
    name: string;

    /**
     * Why it's the ace, e.g., `'beats 4 of their 5 known, has Dragon Dance'`.
     */
    why: string;

    /**
     * Their Pokemon that beat your ace 1-on-1, and who on your team handles each (if anyone).
     */
    checks: { name: string; answers: string[]; }[];

    /**
     * Step-by-step plan for getting the ace a sweep.
     */
    steps: string[];
  };

  roles: TeamGuideRole[];
}

const list = (names: string[], max = 3): string => (
  names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} +${names.length - max}`
);

/**
 * Coaches you on how to play your team: who your ace is, what has to go before it can sweep,
 * when to bring it in, and what each teammate is for.
 *
 * * Follows the usual Random Battles advice: keep the ace hidden & healthy, scout before committing,
 *   remove its checks first, bring it in on a free switch, and don't over-boost.
 *
 * @since 1.4.3
 */
export const scoreTeamGuide = (input: TeamGuideInput): TeamGuide => {
  const {
    mine = [],
    theirs = [],
    duels = {},
    plan,
    seen = 0,
    teamSize = 6,
    riskMode = 'even',
  } = input || {} as TeamGuideInput;

  const guide: TeamGuide = { ace: null, roles: [] };
  const alive = mine.filter((m) => m.hpFraction > 0);
  const foes = theirs.filter((t) => t.hpFraction > 0);

  if (!alive.length) {
    return guide;
  }

  const outcome = (m: TeamGuideMon, t: { index: number; }) => duels[m.index]?.[t.index]?.outcome;
  const winsOf = (m: TeamGuideMon) => foes.filter((t) => outcome(m, t) === 'win');
  const fastest = Math.max(...alive.map((m) => m.speed || 0), 1);

  // ace: the plan's win condition if it has one, otherwise the best sweeper-shaped Pokemon
  const aceScore = (m: TeamGuideMon) => (
    (winsOf(m).length * 10)
      + (m.setupMoves?.length ? 12 : 0)
      + (m.priorityMoves?.length ? 5 : 0)
      + (8 * ((m.speed || 0) / fastest))
      + (6 * m.hpFraction)
  );

  const ace = alive.find((m) => m.index === plan?.winCondition?.index)
    || [...alive].sort((a, b) => aceScore(b) - aceScore(a))[0];

  const aceWins = winsOf(ace).map((t) => t.name);

  const why = [
    aceWins.length ? `beats ${aceWins.length} of their ${foes.length} known` : null,
    ace.setupMoves?.length ? `has ${ace.setupMoves[0]}` : null,
    ace.priorityMoves?.length ? `has ${ace.priorityMoves[0]}` : null,
    ace.speed === fastest && alive.length > 1 ? 'your fastest' : null,
  ].filter(Boolean).join(', ') || 'your best shot at a sweep';

  const checks = foes
    .filter((t) => outcome(ace, t) === 'loss' || outcome(ace, t) === 'coin')
    .map((t) => ({
      name: t.name,
      answers: alive.filter((m) => m !== ace && outcome(m, t) === 'win').map((m) => m.name),
    }));

  const steps: string[] = [];
  const unseen = Math.max(0, teamSize - seen);
  const endgame = foes.length + unseen <= 2;

  if (checks.length) {
    checks.forEach((c) => {
      steps.push(c.answers.length
        ? `${c.name} stops ${ace.name}: take it out with ${list(c.answers, 2)} first.`
        : `${c.name} stops ${ace.name} and nothing beats it 1-on-1: chip it, status it, or stack hazards.`);
    });
  } else if (foes.length) {
    steps.push(`Nothing they've shown beats ${ace.name} 1-on-1.`);
  }

  if (!ace.revealed && unseen >= 2 && !(riskMode === 'ahead' && endgame)) {
    steps.push(`Keep ${ace.name} hidden: they've shown ${seen} of ${teamSize}, so wait until you've seen at least ${Math.min(teamSize, 4)}.`);
  } else if (riskMode === 'ahead' || endgame) {
    steps.push(`You're close: bring ${ace.name} in to close the game out if it beats what's left.`);
  }

  steps.push(`Bring ${ace.name} in on a free switch (after a KO, or by sacking something) so it doesn't take a hit coming in.`);

  if (ace.setupMoves?.length) {
    steps.push(`Use ${ace.setupMoves[0]} when their active can't hurt it much; +2 is usually enough, then attack.`);
  }

  if (ace.priorityMoves?.length) {
    steps.push(`${ace.priorityMoves[0]} picks off anything faster once it's weakened.`);
  }

  if (ace.hpFraction < 0.5) {
    steps.push(`${ace.name} is at ${Math.round(ace.hpFraction * 100)}%: avoid trading hits with it.`);
  }

  guide.ace = {
    index: ace.index,
    name: ace.name,
    why,
    checks,
    steps,
  };

  // a job for everyone else
  alive.forEach((m) => {
    if (m === ace) {
      guide.roles.push({ index: m.index, name: m.name, role: 'Ace', tip: 'Win condition: keep it healthy and hidden.' });

      return;
    }

    const role = plan?.roles?.[m.index];
    const answersTo = (plan?.threats || []).filter((t) => t.answers.length === 1 && t.answers[0] === m.name);
    const clearsForAce = checks.filter((c) => c.answers.includes(m.name)).map((c) => c.name);

    if (answersTo.length) {
      guide.roles.push({
        index: m.index,
        name: m.name,
        role: 'Answer',
        tip: `Your only answer to ${list(answersTo.map((t) => t.name), 2)}; don't sack it.`,
      });
    } else if (clearsForAce.length) {
      guide.roles.push({
        index: m.index,
        name: m.name,
        role: 'Ace support',
        tip: `Removes ${list(clearsForAce, 2)}, which stops ${ace.name}.`,
      });
    } else if (m.hazardMoves?.length) {
      guide.roles.push({
        index: m.index,
        name: m.name,
        role: 'Hazard setter',
        tip: `Get ${m.hazardMoves[0]} up early; Spikes especially add up since there's no team preview.`,
      });
    } else if (m.pivotMoves?.length) {
      guide.roles.push({
        index: m.index,
        name: m.name,
        role: 'Pivot',
        tip: `Use ${m.pivotMoves[0]} to scout their switch-ins and bring ${ace.name} in safely.`,
      });
    } else if (m.removalMoves?.length) {
      guide.roles.push({
        index: m.index,
        name: m.name,
        role: 'Hazard removal',
        tip: `Save ${m.removalMoves[0]} for when hazards are hurting your team (especially ${ace.name}).`,
      });
    } else if (m.statusMoves?.length) {
      guide.roles.push({
        index: m.index,
        name: m.name,
        role: 'Status spreader',
        tip: `Spread ${m.statusMoves[0]} on their bulky Pokémon and ${checks.length ? `on ${checks[0].name}` : 'setup threats'}.`,
      });
    } else if (m.recoveryMoves?.length && winsOf(m).length) {
      guide.roles.push({
        index: m.index,
        name: m.name,
        role: 'Wall',
        tip: `Switch it into ${list(winsOf(m).map((t) => t.name), 2)}; ${m.recoveryMoves[0]} keeps it going.`,
      });
    } else if (role === 'fodder' || !winsOf(m).length) {
      guide.roles.push({
        index: m.index,
        name: m.name,
        role: 'Sack',
        tip: 'Expendable: chip with it, then sack it for a free switch into your ace or a check.',
      });
    } else {
      guide.roles.push({
        index: m.index,
        name: m.name,
        role: 'Attacker',
        tip: `Good into ${list(winsOf(m).map((t) => t.name), 2)}.`,
      });
    }
  });

  return guide;
};
