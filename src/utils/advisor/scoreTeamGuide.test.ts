import { describe, expect, it } from 'vitest';
import { type AdvisorDuel, scoreGamePlan, scoreTeamGuide } from './index';

const duel = (outcome: AdvisorDuel['outcome']): AdvisorDuel => ({
  outcome,
  myTurns: 2,
  theirTurns: 2,
  myMove: null,
  theirMove: null,
});

describe('scoreTeamGuide()', () => {
  const mine = [
    { index: 0, name: 'Dragonite', hpFraction: 1, speed: 260, setupMoves: ['Dragon Dance'], priorityMoves: ['Extreme Speed'] },
    { index: 1, name: 'Corviknight', hpFraction: 0.9, speed: 170, recoveryMoves: ['Roost'], removalMoves: ['Defog'] },
    { index: 2, name: 'Ferrothorn', hpFraction: 1, speed: 40, hazardMoves: ['Spikes'] },
    { index: 3, name: 'Pikachu', hpFraction: 0.4, speed: 300 },
  ];

  const theirs = [
    { index: 0, name: 'Kingambit', hpFraction: 1 },
    { index: 1, name: 'Iron Valiant', hpFraction: 1 },
    { index: 2, name: 'Toxapex', hpFraction: 1 },
  ];

  const duels = {
    0: { 0: duel('win'), 1: duel('loss'), 2: duel('win') },
    1: { 0: duel('coin'), 1: duel('win'), 2: duel('coin') },
    2: { 0: duel('loss'), 1: duel('loss'), 2: duel('coin') },
    3: { 0: duel('loss'), 1: duel('loss'), 2: duel('loss') },
  };

  const plan = scoreGamePlan({
    mine: mine.map(({ index, name, hpFraction }) => ({ index, name, hpFraction })),
    theirs,
    duels,
  });

  const guide = scoreTeamGuide({ mine, theirs, duels, plan, seen: 3, teamSize: 6 });

  it('picks the ace & explains why', () => {
    expect(guide.ace?.name).toBe('Dragonite');
    expect(guide.ace?.why).toBe('beats 2 of their 3 known, has Dragon Dance, has Extreme Speed');
  });

  it('lists what stops the ace and who handles it', () => {
    expect(guide.ace?.checks.map((c) => c.name).join()).toBe('Iron Valiant');
    expect(guide.ace?.steps[0]).toBe('Iron Valiant stops Dragonite: take it out with Corviknight first.');
  });

  it('says to keep the ace hidden until more of their team is seen', () => {
    expect(guide.ace?.steps.some((s) => s.startsWith('Keep Dragonite hidden'))).toBe(true);
  });

  it('gives every teammate a job', () => {
    const roles = Object.fromEntries(guide.roles.map((r) => [r.name, r.role]));

    expect(roles.Dragonite).toBe('Ace');
    expect(roles.Corviknight).toBe('Answer');
    expect(roles.Ferrothorn).toBe('Hazard setter');
    expect(roles.Pikachu).toBe('Sack');
  });
});
