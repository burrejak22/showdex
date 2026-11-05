import { describe, expect, it } from 'vitest';
import { type AdvisorDuel, type AdvisorMove, scoreGamePlan, simulateDuel, turnsToKO } from './index';

const rolls = (min: number, max: number): number[] => Array.from(
  { length: 16 },
  (_, i) => Math.round(min + (((max - min) * i) / 15)),
);

const attack = (name: string, damage: number[], overrides?: Partial<AdvisorMove>): AdvisorMove => ({
  name,
  kind: 'attack',
  rolls: damage,
  accuracy: 1,
  priority: 0,
  ...overrides,
});

const duel = (outcome: AdvisorDuel['outcome'], myTurns = 2, theirTurns = 2): AdvisorDuel => ({
  outcome,
  myTurns,
  theirTurns,
  myMove: null,
  theirMove: null,
});

describe('turnsToKO()', () => {
  it('needs an extra hit through Focus Sash', () => {
    const target = { hp: 200, maxHp: 200, sash: true };

    expect(turnsToKO([attack('Earthquake', rolls(250, 300))], { ...target, sash: false }).turns).toBe(1);
    expect(turnsToKO([attack('Earthquake', rolls(250, 300))], target).turns).toBe(2);
  });

  it("returns Infinity when nothing can hurt the target", () => {
    expect(turnsToKO([attack('Close Combat', [0])], { hp: 200, maxHp: 200 }).turns).toBe(Infinity);
  });
});

describe('simulateDuel()', () => {
  it('gives speed ties on equal hits to the faster side', () => {
    const me = { name: 'Weavile', hp: 280, maxHp: 280, speed: 383 };
    const them = { name: 'Garchomp', hp: 357, maxHp: 357, speed: 333 };

    expect(simulateDuel(me, [attack('Triple Axel', rolls(360, 420))], them, [attack('Earthquake', rolls(300, 340))]).outcome).toBe('win');
    expect(simulateDuel(me, [attack('Knock Off', rolls(120, 140))], them, [attack('Earthquake', rolls(300, 340))]).outcome).toBe('loss');
  });
});

describe('scoreGamePlan()', () => {
  const mine = [
    { index: 0, name: 'Dragonite', hpFraction: 1 },
    { index: 1, name: 'Corviknight', hpFraction: 0.8 },
    { index: 2, name: 'Pikachu', hpFraction: 0.3 },
  ];

  const theirs = [
    { index: 0, name: 'Kingambit', hpFraction: 1 },
    { index: 1, name: 'Iron Valiant', hpFraction: 1 },
    { index: 2, name: 'Toxapex', hpFraction: 1 },
  ];

  const duels = {
    0: { 0: duel('loss'), 1: duel('win'), 2: duel('win') },
    1: { 0: duel('win'), 1: duel('loss'), 2: duel('coin') },
    2: { 0: duel('loss'), 1: duel('loss'), 2: duel('loss') },
  };

  const plan = scoreGamePlan({ mine, theirs, duels, myActiveIndex: 2, theirActiveIndex: 0, unseen: 3 });

  it('finds the win condition', () => {
    expect(plan.winCondition?.name).toBe('Dragonite');
    expect(plan.roles[0]).toBe('wincon');
  });

  it('marks the only answer to a threat & the sack fodder', () => {
    expect(plan.threats[0]?.name).toBe('Kingambit');
    expect(plan.threats[0]?.answers.join()).toBe('Corviknight');
    expect(plan.roles[1]).toBe('answer');
    expect(plan.sackFodder[0]?.name).toBe('Pikachu');
    expect(plan.roles[2]).toBe('fodder');
  });

  it('writes the current-matchup idea first', () => {
    expect(plan.ideas[0]).toBe('Pikachu loses to Kingambit 1-on-1; Corviknight wins it.');
  });
});
