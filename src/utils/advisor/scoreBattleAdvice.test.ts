import { describe, expect, it } from 'vitest';
import {
  type AdvisorMove,
  firstMoveProbability,
  koProbability,
  scoreBattleAdvice,
  simulateExchange,
} from './scoreBattleAdvice';

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

describe('koProbability()', () => {
  it('counts the rolls that reach the HP left', () => {
    expect(koProbability(rolls(80, 95), 100)).toBe(0);
    expect(koProbability(rolls(100, 115), 100)).toBe(1);
    expect(koProbability([90, 95, 100, 105], 100)).toBe(0.5);
    expect(koProbability([], 100)).toBe(0);
  });
});

describe('firstMoveProbability()', () => {
  it('uses priority before speed, and flips speed under Trick Room', () => {
    expect(firstMoveProbability(1, 50, 0, 400)).toBe(1);
    expect(firstMoveProbability(0, 300, 0, 200)).toBe(1);
    expect(firstMoveProbability(0, 300, 0, 200, true)).toBe(0);
    expect(firstMoveProbability(0, 250, 0, 250)).toBe(0.5);
  });
});

describe('simulateExchange()', () => {
  it('lets the faster side KO before the slower side acts', () => {
    const ex = simulateExchange(
      { hp: 100, speed: 300 },
      attack('Close Combat', rolls(120, 140)),
      { hp: 100, speed: 200 },
      attack('Flare Blitz', rolls(120, 140)),
    );

    expect(ex.aKOs).toBe(1);
    expect(ex.bKOs).toBe(0);
  });

  it("doesn't credit damage the slower side never gets to deal", () => {
    const ex = simulateExchange(
      { hp: 100, speed: 100 },
      attack('Earthquake', rolls(120, 140)),
      { hp: 100, speed: 200 },
      attack('Surf', rolls(120, 140)),
    );

    expect(ex.aActs).toBe(0);
    expect(ex.dealt).toBe(0);
  });
});

describe('scoreBattleAdvice()', () => {
  it('takes a guaranteed KO when you move first', () => {
    const result = scoreBattleAdvice({
      me: { name: 'Garchomp', hp: 340, maxHp: 357, speed: 333 },
      opponent: { name: 'Heatran', hp: 300, maxHp: 322, speed: 253 },
      myMoves: [
        attack('Earthquake', rolls(330, 390)),
        attack('Dragon Claw', rolls(70, 85)),
        { name: 'Swords Dance', kind: 'setup', rolls: [], accuracy: 1, priority: 0 },
      ],
      opponentMoves: [attack('Earth Power', rolls(110, 130))],
      switches: [],
    });

    expect(result.verdict?.type).toBe('move');
    expect(result.verdict?.name).toBe('Earthquake');
  });

  it('switches out of a matchup where you get KOd first', () => {
    const result = scoreBattleAdvice({
      me: { name: 'Gengar', hp: 261, maxHp: 261, speed: 200 },
      opponent: { name: 'Kingambit', hp: 341, maxHp: 341, speed: 210, physical: true },
      myMoves: [
        attack('Focus Blast', rolls(260, 310), { accuracy: 0.7 }),
        attack('Shadow Ball', rolls(40, 50)),
      ],
      opponentMoves: [attack('Kowtow Cleave', rolls(400, 470))],
      switches: [{
        index: 2,
        mon: { name: 'Corviknight', hp: 399, maxHp: 399, speed: 170 },
        entryDamage: 25,
        movesVsOpponent: [attack('Body Press', rolls(150, 180))],
        opponentMovesVsIt: [attack('Kowtow Cleave', rolls(60, 72))],
      }],
    });

    expect(result.verdict?.type).toBe('switch');
    expect(result.verdict?.index).toBe(2);
  });

  it('never suggests a move the target is immune to', () => {
    const result = scoreBattleAdvice({
      me: { name: 'Lucario', hp: 280, maxHp: 280, speed: 300 },
      opponent: { name: 'Gengar', hp: 261, maxHp: 261, speed: 350 },
      myMoves: [attack('Close Combat', [0]), attack('Crunch', rolls(200, 240))],
      opponentMoves: [],
      switches: [],
    });

    expect(result.verdict?.name).toBe('Crunch');
    expect(result.moves.at(-1)?.name).toBe('Close Combat');
  });

  it('only suggests switches after a faint', () => {
    const result = scoreBattleAdvice({
      me: { name: 'Gengar', hp: 0, maxHp: 1, speed: 0 },
      opponent: { name: 'Dragapult', hp: 250, maxHp: 318, speed: 421 },
      myMoves: [],
      opponentMoves: [],
      forcedSwitch: true,
      switches: [
        {
          index: 1,
          mon: { name: 'Tyranitar', hp: 341, maxHp: 341, speed: 200 },
          entryDamage: 0,
          movesVsOpponent: [attack('Crunch', rolls(240, 290))],
          opponentMovesVsIt: [attack('Shadow Ball', rolls(60, 72))],
        },
        {
          index: 4,
          mon: { name: 'Alakazam', hp: 251, maxHp: 251, speed: 372 },
          entryDamage: 0,
          movesVsOpponent: [attack('Psychic', rolls(90, 110))],
          opponentMovesVsIt: [attack('Shadow Ball', rolls(260, 310))],
        },
      ],
    });

    expect(result.moves).toHaveLength(0);
    expect(result.verdict?.name).toBe('Tyranitar');
  });

  it("drops switch-ins that faint to hazards", () => {
    const result = scoreBattleAdvice({
      me: { name: 'Gengar', hp: 0, maxHp: 1, speed: 0 },
      opponent: { name: 'Dragapult', hp: 250, maxHp: 318, speed: 421 },
      forcedSwitch: true,
      myMoves: [],
      opponentMoves: [],
      switches: [{
        index: 3,
        mon: { name: 'Charizard', hp: 40, maxHp: 297, speed: 300 },
        entryDamage: 148,
        movesVsOpponent: [],
        opponentMovesVsIt: [],
      }],
    });

    expect(result.switches).toHaveLength(0);
  });

  it("knows a full-HP Focus Sash can't be OHKO'd, but multi-hit moves break it", () => {
    const sashed = { name: 'Azelf', hp: 260, maxHp: 260, speed: 300, sash: true, sashSource: 'Focus Sash' };
    const me = { name: 'Garchomp', hp: 357, maxHp: 357, speed: 333 };

    const single = scoreBattleAdvice({
      me,
      opponent: sashed,
      myMoves: [attack('Earthquake', rolls(300, 350))],
      opponentMoves: [],
      switches: [],
    });

    const multi = scoreBattleAdvice({
      me,
      opponent: sashed,
      myMoves: [attack('Scale Shot', rolls(300, 350), { multihit: true })],
      opponentMoves: [],
      switches: [],
    });

    expect(single.moves[0].koChance).toBe(0);
    expect(single.moves[0].reasons[0]).toBe('Focus Sash leaves it at 1 HP');
    expect(multi.moves[0].koChance).toBe(1);
  });

  it('only lets you click the move a Choice item locked you into', () => {
    const result = scoreBattleAdvice({
      me: { name: 'Weavile', hp: 281, maxHp: 281, speed: 383 },
      opponent: { name: 'Toxapex', hp: 304, maxHp: 304, speed: 106 },
      myMoves: [attack('Ice Shard', rolls(20, 25), { priority: 1 }), attack('Knock Off', rolls(90, 110))],
      opponentMoves: [],
      lockedMove: 'Ice Shard',
      lockedSource: 'Choice Band',
      switches: [],
    });

    expect(result.locked).toBe('Ice Shard');
    expect(result.verdict?.name).toBe('Ice Shard');
  });

  it('counts Life Orb & Rocky Helmet chip against the attacker', () => {
    const base = {
      me: { name: 'Dragapult', hp: 60, maxHp: 318, speed: 421 },
      opponent: { name: 'Ferrothorn', hp: 352, maxHp: 352, speed: 40 },
      opponentMoves: [],
      switches: [],
    };

    const clean = scoreBattleAdvice({ ...base, myMoves: [attack('Dragon Darts', rolls(40, 50))] });
    const chipped = scoreBattleAdvice({
      ...base,
      myMoves: [attack('Dragon Darts', rolls(40, 50), { selfDamage: 0.1 + (1 / 6), selfDamageSource: 'Life Orb + Rocky Helmet' })],
    });

    expect(chipped.moves[0].score < clean.moves[0].score).toBe(true);
    expect(chipped.moves[0].reasons.includes('Life Orb + Rocky Helmet would KO you')).toBe(true);
  });

  it('adds what your active gains for leaving to every switch', () => {
    const input = {
      me: { name: 'Slowbro', hp: 150, maxHp: 394, speed: 100 },
      opponent: { name: 'Gholdengo', hp: 315, maxHp: 315, speed: 293 },
      myMoves: [attack('Surf', rolls(70, 85))],
      opponentMoves: [attack('Shadow Ball', rolls(120, 145))],
      switches: [{
        index: 1,
        mon: { name: 'Kingambit', hp: 341, maxHp: 341, speed: 210 },
        entryDamage: 0,
        movesVsOpponent: [attack('Kowtow Cleave', rolls(200, 240))],
        opponentMovesVsIt: [attack('Shadow Ball', rolls(50, 60))],
      }],
    };

    const without = scoreBattleAdvice(input);
    const withRegen = scoreBattleAdvice({ ...input, switchOutBonus: 13, switchOutReasons: ['Regenerator heals Slowbro 33% if you switch.'] });

    expect(withRegen.switches[0].score - without.switches[0].score).toBe(13);
    expect(withRegen.notes.includes('Regenerator heals Slowbro 33% if you switch.')).toBe(true);
  });

  describe('sacking', () => {
    const base = {
      me: { name: 'Gengar', hp: 120, maxHp: 261, speed: 200 },
      opponent: { name: 'Kingambit', hp: 341, maxHp: 341, speed: 210, physical: true },
      myMoves: [attack('Focus Blast', rolls(200, 240), { accuracy: 0.7 })],
      opponentMoves: [attack('Kowtow Cleave', rolls(300, 350))],
      // the only good answer takes a big hit coming in, but walls it on a free switch
      switches: [{
        index: 2,
        mon: { name: 'Great Tusk', hp: 360, maxHp: 360, speed: 307 },
        entryDamage: 45,
        movesVsOpponent: [attack('Headlong Rush', rolls(330, 390))],
        opponentMovesVsIt: [attack('Kowtow Cleave', rolls(150, 180))],
      }],
    };

    it('sacks low-value Pokemon for a free switch', () => {
      const result = scoreBattleAdvice({ ...base, activeValue: 0.15 });

      expect(result.verdict?.type).toBe('move');
      expect(result.verdict?.sack).toBe(true);
      expect(result.verdict?.sackInto).toBe('Great Tusk');
    });

    it("doesn't sack your win condition when a switch is reasonable", () => {
      const result = scoreBattleAdvice({ ...base, activeValue: 1, activeRole: 'your win condition' });

      expect(result.verdict?.type).toBe('switch');
    });
  });

  describe('locked by Gorilla Tactics / Choice items', () => {
    const base = {
      me: { name: 'Darmanitan', hp: 320, maxHp: 320, speed: 280 },
      opponent: { name: 'Skeledirge', hp: 380, maxHp: 380, speed: 150 },
      // Flare Blitz would be great, but we're locked into a resisted Rock Slide
      myMoves: [
        attack('Rock Slide', rolls(40, 50)),
        attack('Flare Blitz', rolls(330, 390)),
        attack('U-turn', rolls(60, 70), { pivot: true }),
      ],
      opponentMoves: [attack('Torch Song', rolls(150, 180))],
      lockedMove: 'Rock Slide',
      lockedSource: 'Gorilla Tactics',
    };

    it('only ever suggests the locked move or a switch', () => {
      const stay = scoreBattleAdvice({ ...base, switches: [] });

      expect(stay.verdict?.name).toBe('Rock Slide');
      expect(stay.moves.filter((m) => m.score > -200).length).toBe(1);

      const withSwitch = scoreBattleAdvice({
        ...base,
        switches: [{
          index: 3,
          mon: { name: 'Dondozo', hp: 450, maxHp: 450, speed: 100 },
          entryDamage: 0,
          movesVsOpponent: [attack('Wave Crash', rolls(260, 310))],
          opponentMovesVsIt: [attack('Torch Song', rolls(40, 50))],
        }],
      });

      expect(['Rock Slide', 'Dondozo']).toContain(withSwitch.verdict?.name);
      expect(withSwitch.verdict?.name).toBe('Dondozo');
    });

    it("doesn't let switch or Tera predictions unlock other moves", () => {
      const result = scoreBattleAdvice({
        ...base,
        switches: [],
        opponentSwitch: {
          chance: 0.6,
          target: { name: 'Gholdengo', hp: 315, maxHp: 315, speed: 293 },
          myMovesVsTarget: [attack('Rock Slide', rolls(60, 70)), attack('Flare Blitz', rolls(330, 380))],
        },
      });

      expect(result.verdict?.name).toBe('Rock Slide');
    });
  });

  describe('predicting their switch & Tera', () => {
    const me = { name: 'Garchomp', hp: 357, maxHp: 357, speed: 333 };
    const opponent = { name: 'Heatran', hp: 322, maxHp: 322, speed: 253 };
    const myMoves = [attack('Earthquake', rolls(330, 390)), attack('Fire Fang', rolls(10, 14))];
    const opponentMoves = [attack('Magma Storm', rolls(100, 120), { accuracy: 0.75 })];

    it('favors the move that also hits their likely switch-in', () => {
      const result = scoreBattleAdvice({
        me,
        opponent,
        myMoves: [attack('Earthquake', rolls(330, 390)), attack('Stone Edge', rolls(120, 140), { accuracy: 0.8 })],
        opponentMoves,
        switches: [],
        opponentSwitch: {
          chance: 0.7,
          target: { name: 'Corviknight', hp: 399, maxHp: 399, speed: 170 },
          myMovesVsTarget: [attack('Earthquake', [0]), attack('Stone Edge', rolls(150, 180), { accuracy: 0.8 })],
        },
      });

      expect(result.prediction?.switchTo).toBe('Corviknight');

      const eq = result.moves.find((m) => m.name === 'Earthquake');

      expect(eq?.reasons.includes('does nothing to Corviknight')).toBe(true);
    });

    it('notes when a Tera would let them survive', () => {
      const result = scoreBattleAdvice({
        me,
        opponent,
        myMoves,
        opponentMoves,
        switches: [],
        opponentTera: {
          chance: 0.5,
          type: 'Flying',
          opponent: { ...opponent },
          myMovesVsTera: [attack('Earthquake', [0]), attack('Fire Fang', rolls(20, 28))],
          opponentMovesVsMe: opponentMoves,
        },
      });

      const eq = result.moves.find((m) => m.name === 'Earthquake');

      expect(result.prediction?.teraType).toBe('Flying');
      expect(eq?.reasons.includes('useless if they Tera Flying')).toBe(true);
      expect((eq?.koChance || 0) < 0.6).toBe(true);
    });
  });

  describe('your Tera', () => {
    const me = { name: 'Dragonite', hp: 380, maxHp: 386, speed: 260 };
    const opponent = { name: 'Baxcalibur', hp: 361, maxHp: 361, speed: 285 };

    const base = {
      me,
      opponent,
      myMoves: [attack('Extreme Speed', rolls(150, 180), { priority: 2 })],
      // Icicle Crash OHKOs Dragonite unless it Teras Normal
      opponentMoves: [attack('Icicle Crash', rolls(400, 470))],
      switches: [],
    };

    const myTera = {
      type: 'Normal',
      me: { ...me },
      myMoves: [attack('Extreme Speed', rolls(225, 265), { priority: 2 })],
      opponentMoves: [],
      opponentMovesVsMe: [attack('Icicle Crash', rolls(100, 120))],
      cost: 15,
    };

    it('suggests Tera when it turns a loss around', () => {
      const result = scoreBattleAdvice({ ...base, myTera });

      expect(result.verdict?.tera).toBe('Normal');
      expect(result.verdict?.name).toBe('Extreme Speed');
    });

    it("doesn't waste Tera when it costs more than it gains", () => {
      const result = scoreBattleAdvice({ ...base, myTera: { ...myTera, cost: 500 } });

      expect(result.verdict?.tera).toBe(undefined);
    });
  });

  describe('yes/no calls', () => {
    it('says to use Tera when it wins the turn, and to save it otherwise', () => {
      const me = { name: 'Dragonite', hp: 380, maxHp: 386, speed: 260 };
      const opponent = { name: 'Baxcalibur', hp: 361, maxHp: 361, speed: 285 };
      const input = {
        me,
        opponent,
        myMoves: [attack('Extreme Speed', rolls(150, 180), { priority: 2 })],
        opponentMoves: [attack('Icicle Crash', rolls(400, 470))],
        switches: [],
        myTera: {
          type: 'Normal',
          me: { ...me },
          myMoves: [attack('Extreme Speed', rolls(225, 265), { priority: 2 })],
          opponentMovesVsMe: [attack('Icicle Crash', rolls(100, 120))],
          cost: 15,
        },
      };

      expect(scoreBattleAdvice(input).decisions?.tera?.use).toBe(true);

      const pointless = scoreBattleAdvice({
        ...input,
        opponentMoves: [attack('Icicle Crash', rolls(50, 60))],
        myTera: { ...input.myTera, myMoves: input.myMoves, opponentMovesVsMe: [attack('Icicle Crash', rolls(50, 60))] },
      });

      expect(pointless.decisions?.tera?.use).toBe(false);
      expect(pointless.decisions?.tera?.text).toBe("Save Tera Normal: it doesn't change this turn much.");
    });

    it('says whether to sack, and why not when it matters', () => {
      const base = {
        me: { name: 'Gengar', hp: 120, maxHp: 261, speed: 200 },
        opponent: { name: 'Kingambit', hp: 341, maxHp: 341, speed: 210, physical: true },
        myMoves: [attack('Focus Blast', rolls(200, 240), { accuracy: 0.7 })],
        opponentMoves: [attack('Kowtow Cleave', rolls(300, 350))],
        switches: [{
          index: 2,
          mon: { name: 'Great Tusk', hp: 360, maxHp: 360, speed: 307 },
          entryDamage: 45,
          movesVsOpponent: [attack('Headlong Rush', rolls(330, 390))],
          opponentMovesVsIt: [attack('Kowtow Cleave', rolls(150, 180))],
        }],
      };

      const sack = scoreBattleAdvice({ ...base, activeValue: 0.15 });

      expect(sack.decisions?.sack?.sack).toBe(true);

      const keep = scoreBattleAdvice({ ...base, activeValue: 1, activeRole: 'your win condition' });

      expect(keep.decisions?.sack?.sack).toBe(false);
      expect(keep.decisions?.sack?.text).toBe("Don't sack Gengar: it's your win condition. Switch to Great Tusk.");
    });
  });

  describe('status', () => {
    const opponent = { name: 'Kingambit', hp: 341, maxHp: 341, speed: 210, physical: true };
    const opponentMoves = [attack('Kowtow Cleave', rolls(150, 180))];

    it("knows you mostly can't act while asleep, unless the move works through it", () => {
      const asleep = { name: 'Great Tusk', hp: 360, maxHp: 360, speed: 307, status: 'slp', actChance: 0, actNote: 'asleep' };

      const result = scoreBattleAdvice({
        me: asleep,
        opponent,
        myMoves: [
          attack('Headlong Rush', rolls(330, 390)),
          attack('Close Combat', rolls(340, 400)),
          { name: 'Sleep Talk', kind: 'other', rolls: [], accuracy: 1, priority: 0, actChance: 1 },
        ],
        opponentMoves,
        switches: [],
      });

      expect(result.verdict?.name).toBe('Sleep Talk');
      expect(result.moves.find((m) => m.name === 'Headlong Rush')?.koChance).toBe(0);
    });

    it('treats a thawing move as usable while frozen', () => {
      const frozen = { name: 'Arcanine', hp: 300, maxHp: 300, speed: 300, status: 'frz', actChance: 0.2, actNote: 'frozen' };

      const result = scoreBattleAdvice({
        me: frozen,
        opponent,
        myMoves: [attack('Close Combat', rolls(340, 400)), attack('Flare Blitz', rolls(170, 200), { actChance: 1 })],
        opponentMoves,
        switches: [],
      });

      expect(result.verdict?.name).toBe('Flare Blitz');
      expect(result.verdict?.reasons.includes('works through frozen')).toBe(true);
    });

    it('sets up on a sleeping opponent', () => {
      const result = scoreBattleAdvice({
        me: { name: 'Dragonite', hp: 300, maxHp: 386, speed: 260 },
        opponent: { ...opponent, status: 'slp', actChance: 0, actNote: 'asleep' },
        myMoves: [
          { name: 'Dragon Dance', kind: 'setup', rolls: [], accuracy: 1, priority: 0 },
          attack('Earthquake', rolls(120, 140)),
        ],
        // it'd threaten a 2HKO if it were awake
        opponentMoves: [attack('Kowtow Cleave', rolls(160, 190))],
        switches: [],
      });

      expect(result.verdict?.name).toBe('Dragon Dance');
    });
  });

  it("never calls a move that KOs first a sack", () => {
    const result = scoreBattleAdvice({
      me: { name: 'Weavile', hp: 100, maxHp: 281, speed: 383 },
      opponent: { name: 'Garchomp', hp: 300, maxHp: 357, speed: 333 },
      myMoves: [attack('Triple Axel', rolls(310, 380))],
      opponentMoves: [attack('Earthquake', rolls(300, 340))],
      activeValue: 0.15,
      switches: [{
        index: 1,
        mon: { name: 'Corviknight', hp: 399, maxHp: 399, speed: 170 },
        entryDamage: 0,
        movesVsOpponent: [attack('Body Press', rolls(150, 180))],
        opponentMovesVsIt: [attack('Earthquake', [0])],
      }],
    });

    expect(result.verdict?.name).toBe('Triple Axel');
    expect(result.verdict?.sack).toBe(undefined);
  });

  describe('pro tips', () => {
    const base = {
      me: { name: 'Garchomp', hp: 357, maxHp: 357, speed: 333 },
      opponent: { name: 'Gholdengo', hp: 315, maxHp: 315, speed: 293 },
      // Stone Edge: likely KO but 80% accurate; Earthquake: safe 2HKO
      myMoves: [attack('Stone Edge', rolls(300, 360), { accuracy: 0.8 }), attack('Earthquake', rolls(200, 240))],
      opponentMoves: [attack('Make It Rain', rolls(90, 110))],
      switches: [],
    };

    it('gambles on the KO when behind, plays safe when ahead', () => {
      const behind = scoreBattleAdvice({ ...base, riskMode: 'behind' });
      const ahead = scoreBattleAdvice({ ...base, riskMode: 'ahead' });

      const edgeBehind = behind.moves.find((m) => m.name === 'Stone Edge')?.score || 0;
      const edgeAhead = ahead.moves.find((m) => m.name === 'Stone Edge')?.score || 0;

      expect(edgeBehind > edgeAhead).toBe(true);
      expect(behind.verdict?.name).toBe('Stone Edge');
    });

    it('labels the revenge kill after a faint', () => {
      const result = scoreBattleAdvice({
        me: { name: 'Gengar', hp: 0, maxHp: 1, speed: 0 },
        opponent: { name: 'Dragonite', hp: 200, maxHp: 386, speed: 260 },
        myMoves: [],
        opponentMoves: [],
        forcedSwitch: true,
        switches: [{
          index: 2,
          mon: { name: 'Weavile', hp: 281, maxHp: 281, speed: 383 },
          entryDamage: 0,
          movesVsOpponent: [attack('Ice Shard', rolls(220, 260), { priority: 1 })],
          opponentMovesVsIt: [attack('Extreme Speed', rolls(150, 180), { priority: 2 })],
        }],
      });

      expect(result.verdict?.reasons[0]).toBe('revenge-kills Dragonite with Ice Shard');
    });
  });

  describe('sacking like the pros', () => {
    const me = { name: 'Gengar', hp: 120, maxHp: 261, speed: 200 };
    const opponent = { name: 'Kingambit', hp: 341, maxHp: 341, speed: 210, physical: true };
    const opponentMoves = [attack('Kowtow Cleave', rolls(300, 350))];
    const greatTusk = {
      index: 2,
      mon: { name: 'Great Tusk', hp: 360, maxHp: 360, speed: 307 },
      entryDamage: 45,
      movesVsOpponent: [attack('Headlong Rush', rolls(330, 390))],
      opponentMovesVsIt: [attack('Kowtow Cleave', rolls(150, 180))],
    };

    it("doesn't sack when a switch-in takes the hit comfortably", () => {
      const result = scoreBattleAdvice({
        me,
        opponent,
        myMoves: [attack('Focus Blast', rolls(200, 240), { accuracy: 0.7 })],
        opponentMoves,
        activeValue: 0.15,
        switches: [{
          index: 3,
          mon: { name: 'Corviknight', hp: 399, maxHp: 399, speed: 170 },
          entryDamage: 0,
          movesVsOpponent: [attack('Body Press', rolls(150, 180))],
          opponentMovesVsIt: [attack('Kowtow Cleave', rolls(40, 50))],
        }],
      });

      expect(result.verdict?.type).toBe('switch');
      expect(result.verdict?.name).toBe('Corviknight');
      expect(result.decisions?.sack?.sack).toBe(false);
    });

    it('goes out with Destiny Bond when it moves first', () => {
      const result = scoreBattleAdvice({
        me: { ...me, speed: 300 },
        opponent,
        myMoves: [
          attack('Shadow Ball', rolls(60, 70)),
          { name: 'Destiny Bond', kind: 'other', rolls: [], accuracy: 1, priority: 0, lastWish: 'destinybond' },
        ],
        opponentMoves,
        activeValue: 0.15,
        switches: [greatTusk],
      });

      expect(result.verdict?.name).toBe('Destiny Bond');
      expect(result.verdict?.reasons[0]).toBe('takes Kingambit down with it');
      expect(result.decisions?.sack?.text.startsWith('Good sack')).toBe(true);
    });

    it("won't Explode when it would otherwise survive", () => {
      const result = scoreBattleAdvice({
        me: { name: 'Glimmora', hp: 300, maxHp: 300, speed: 280 },
        opponent: { ...opponent },
        myMoves: [attack('Explosion', rolls(200, 240), { selfKO: true }), attack('Earth Power', rolls(150, 180))],
        opponentMoves: [attack('Kowtow Cleave', rolls(60, 70))],
        switches: [],
      });

      expect(result.verdict?.name).toBe('Earth Power');
    });

    it('U-turns into a sturdy switch-in instead of dying or hard-switching', () => {
      const result = scoreBattleAdvice({
        me: { name: 'Meowscarada', hp: 150, maxHp: 280, speed: 380 },
        opponent: { ...opponent },
        myMoves: [attack('Flower Trick', rolls(60, 70)), attack('U-turn', rolls(80, 95), { pivot: true })],
        opponentMoves,
        activeValue: 0.15,
        switches: [greatTusk, {
          index: 3,
          mon: { name: 'Corviknight', hp: 399, maxHp: 399, speed: 170 },
          entryDamage: 0,
          movesVsOpponent: [attack('Body Press', rolls(150, 180))],
          opponentMovesVsIt: [attack('Kowtow Cleave', rolls(40, 50))],
        }],
      });

      expect(result.verdict?.name).toBe('U-turn');
      expect(result.verdict?.sack).toBe(undefined);
      expect(result.verdict?.reasons.includes('pivots out before their hit lands')).toBe(true);
    });
  });

  describe('Tera timing', () => {
    const me = { name: 'Garchomp', hp: 357, maxHp: 357, speed: 333 };
    const opponent = { name: 'Toxapex', hp: 304, maxHp: 304, speed: 106 };
    const base = {
      me,
      opponent,
      // Tera Steel makes Iron Head hit harder, but it already 2HKOs & nothing threatens Garchomp
      myMoves: [attack('Iron Head', rolls(120, 140))],
      opponentMoves: [attack('Surf', rolls(60, 70))],
      switches: [],
    };
    const myTera = {
      type: 'Steel',
      me: { ...me },
      myMoves: [attack('Iron Head', rolls(180, 210))],
      opponentMovesVsMe: [attack('Surf', rolls(60, 70))],
      cost: 15,
    };

    it("holds Tera early when it isn't needed to survive", () => {
      const early = scoreBattleAdvice({ ...base, myTera: { ...myTera, context: { unseen: 4, lead: 0 } } });

      expect(early.verdict?.tera).toBe(undefined);
      expect(early.decisions?.tera?.use).toBe(false);
    });

    it('Teras defensively to save a key Pokémon', () => {
      const result = scoreBattleAdvice({
        ...base,
        opponentMoves: [attack('Ice Beam', rolls(360, 420))],
        myTera: {
          ...myTera,
          opponentMovesVsMe: [attack('Ice Beam', rolls(90, 105))],
          context: { unseen: 4, lead: 0, key: true },
        },
      });

      expect(result.verdict?.tera).toBe('Steel');
      expect(result.verdict?.reasons.includes('saves a key Pokémon')).toBe(true);
    });
  });
});
