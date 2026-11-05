import { describe, expect, it } from 'vitest';
import { readBattleLog } from './readBattleLog';

const log = [
  '|switch|p1a: Garchomp|Garchomp, L78, M|100/100',
  '|switch|p2a: Zoomer|Dragapult, L76, F|100/100',
  '|turn|1',
  '|move|p2a: Zoomer|Dragon Darts|p1a: Garchomp',
  '|-damage|p1a: Garchomp|40/100',
  '|move|p1a: Garchomp|Earthquake|p2a: Zoomer',
  '|turn|2',
  '|-activate|p1a: Garchomp|item: Quick Claw',
  '|move|p1a: Garchomp|Dragon Claw|p2a: Zoomer',
  '|move|p2a: Zoomer|Dragon Darts|p1a: Garchomp',
  '|turn|3',
  '|move|p1a: Garchomp|Sleep Talk|p1a: Garchomp',
  '|move|p1a: Garchomp|Outrage|p2a: Zoomer|[from]move: Sleep Talk',
  '|move|p2a: Zoomer|Shadow Ball|p1a: Garchomp',
  '|turn|4',
  '|switch|p2a: Iron Valiant|Iron Valiant, L79|100/100',
  '|move|p1a: Garchomp|Earthquake|p2a: Iron Valiant',
];

describe('readBattleLog()', () => {
  const result = readBattleLog(log);

  it('records who moved first each turn', () => {
    expect(result.orders.length).toBe(3);
    expect(result.orders[0].firstSide).toBe('p2');
    expect(result.orders[0].movers.p2.name).toBe('Zoomer');
    expect(result.orders[0].unreliable).toBe(false);
  });

  it('flags turns where Quick Claw & co. could have decided the order', () => {
    expect(result.orders[1].unreliable).toBe(true);
  });

  it('ignores moves called by other moves', () => {
    expect(result.orders[2].movers.p1.move).toBe('Sleep Talk');
  });

  it('tracks moves used since switching in', () => {
    expect(result.activeNames.p2).toBe('Iron Valiant');
    expect(result.movesSinceSwitchIn.p2.length).toBe(0);
    expect(result.movesSinceSwitchIn.p1.join()).toBe('Earthquake,Dragon Claw,Sleep Talk,Earthquake');
  });

  it('marks Trick Room turns as unreliable', () => {
    const tr = readBattleLog([
      '|switch|p1a: A|A|100/100',
      '|switch|p2a: B|B|100/100',
      '|turn|1',
      '|move|p2a: B|Trick Room|p2a: B',
      '|-fieldstart|move: Trick Room|[of] p2a: B',
      '|move|p1a: A|Tackle|p2a: B',
      '|turn|2',
      '|move|p1a: A|Tackle|p2a: B',
      '|move|p2a: B|Tackle|p1a: A',
    ]);

    expect(tr.orders.every((o) => o.unreliable)).toBe(true);
  });

  it('tracks the last turn each side had its speed change', () => {
    const speed = readBattleLog([
      '|switch|p1a: Garchomp|Garchomp|100/100',
      '|switch|p2a: Zoomer|Dragapult|100/100',
      '|turn|1',
      '|move|p2a: Zoomer|Dragon Darts|p1a: Garchomp',
      '|move|p1a: Garchomp|Earthquake|p2a: Zoomer',
      '|turn|2',
      '|move|p2a: Zoomer|Thunder Wave|p1a: Garchomp',
      '|-status|p1a: Garchomp|par',
      '|move|p1a: Garchomp|Earthquake|p2a: Zoomer',
      '|turn|3',
      '|move|p2a: Zoomer|Dragon Dance|p2a: Zoomer',
      '|-boost|p2a: Zoomer|atk|1',
      '|-boost|p2a: Zoomer|spe|1',
    ]);

    expect(speed.speedChangedTurn.p1).toBe(2);
    expect(speed.speedChangedTurn.p2).toBe(3);
  });
});
