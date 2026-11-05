/**
 * @file `readBattleLog.ts`
 * @since 1.4.3
 */

/**
 * Who moved first on one turn, from the battle log.
 *
 * @since 1.4.3
 */
export interface AdvisorTurnOrder {
  turn: number;

  /**
   * Side that moved first (e.g., `'p1'`).
   */
  firstSide: string;

  /**
   * Pokemon & move for each side, keyed by side (e.g., `{ p1: { name: 'Garchomp', move: 'Earthquake' } }`).
   */
  movers: Record<string, { name: string; move: string; }>;

  /**
   * Whether something other than speed & priority may have decided the order
   * (Trick Room, Tailwind, Quick Claw, Custap Berry, Quick Draw, etc.), so the turn shouldn't be used to infer speed.
   */
  unreliable: boolean;
}

/**
 * What the battle log says about the Pokemon currently on the field.
 *
 * @since 1.4.3
 */
export interface AdvisorBattleLog {
  /**
   * Turn orders where both sides used a move, oldest first.
   */
  orders: AdvisorTurnOrder[];

  /**
   * Moves each side's active Pokemon used since it last switched in, in order, keyed by side.
   */
  movesSinceSwitchIn: Record<string, string[]>;

  /**
   * Name of each side's active Pokemon, as the log knows it (i.e., its nickname), keyed by side.
   */
  activeNames: Record<string, string>;

  /**
   * Last turn each side's active Pokemon switched in or had its speed change (stat stages, paralysis, item swaps,
   * forme changes), keyed by side.
   *
   * * Turn orders from before this can't be compared against current speeds.
   */
  speedChangedTurn: Record<string, number>;

  /**
   * Every Pokemon each side has sent out so far, keyed by side.
   */
  seenNames: Record<string, string[]>;
}

// `p2a: Garchomp` -> ['p2', 'Garchomp']
const parseIdent = (ident: string): [side: string, name: string] => {
  const match = /^(p\d)[a-z]?:\s*(.+)$/.exec(String(ident || '').trim());

  return match ? [match[1], match[2]] : [null, null];
};

// things that let a Pokemon move out of speed order (or flip it)
const OrderOverrides = [
  'item: Quick Claw',
  'Custap Berry',
  'ability: Quick Draw',
  'Quick Draw',
  'move: Quash',
  'move: After You',
  'move: Instruct',
];

/**
 * Reads turn order & move history out of a Showdown battle's `stepQueue` (the raw protocol lines).
 *
 * * Moves called by other moves (`[from]` tags, e.g., *Sleep Talk*, *Dancer*) are ignored, except *Outrage*-style
 *   lock-ins, which are the Pokemon's own move.
 * * Turns under *Trick Room* or *Tailwind*, or with *Quick Claw* & friends, are marked `unreliable`.
 *
 * @since 1.4.3
 */
export const readBattleLog = (lines: string[]): AdvisorBattleLog => {
  const output: AdvisorBattleLog = {
    orders: [],
    movesSinceSwitchIn: {},
    activeNames: {},
    speedChangedTurn: {},
    seenNames: {},
  };

  if (!Array.isArray(lines) || !lines.length) {
    return output;
  }

  let turn = 0;
  let trickRoom = false;
  const tailwind: Record<string, boolean> = {};

  let current: AdvisorTurnOrder = null;
  let firstMovers: string[] = [];

  const finishTurn = () => {
    if (current && firstMovers.length >= 2) {
      output.orders.push(current);
    }

    current = null;
    firstMovers = [];
  };

  lines.forEach((raw) => {
    if (typeof raw !== 'string' || !raw.startsWith('|')) {
      return;
    }

    const parts = raw.split('|');
    const cmd = parts[1];

    switch (cmd) {
      case 'turn': {
        finishTurn();
        turn = parseInt(parts[2], 10) || (turn + 1);

        current = {
          turn,
          firstSide: null,
          movers: {},
          unreliable: trickRoom || Object.values(tailwind).some(Boolean),
        };

        break;
      }

      case 'switch':
      case 'drag':
      case 'replace': {
        const [side, name] = parseIdent(parts[2]);

        if (side) {
          output.activeNames[side] = name;
          output.movesSinceSwitchIn[side] = [];
          output.speedChangedTurn[side] = turn;

          if (!(output.seenNames[side] = output.seenNames[side] || []).includes(name)) {
            output.seenNames[side].push(name);
          }
        }

        break;
      }

      case '-boost':
      case '-unboost':
      case '-setboost': {
        const [side] = parseIdent(parts[2]);

        if (side && parts[3] === 'spe') {
          output.speedChangedTurn[side] = turn;
        }

        break;
      }

      case '-clearboost':
      case '-clearnegativeboost':
      case '-invertboost':
      case '-copyboost':
      case '-swapboost':
      case '-status':
      case '-curestatus':
      case '-item':
      case '-enditem':
      case '-transform':
      case '-formechange':
      case 'detailschange': {
        const [side] = parseIdent(parts[2]);

        if (side && (cmd !== '-status' || parts[3] === 'par') && (cmd !== '-curestatus' || parts[3] === 'par')) {
          output.speedChangedTurn[side] = turn;
        }

        if (side && cmd === '-transform') {
          const [otherSide] = parseIdent(parts[3]);

          if (otherSide) {
            output.speedChangedTurn[otherSide] = turn;
          }
        }

        if (current && OrderOverrides.some((o) => raw.includes(o))) {
          current.unreliable = true;
        }

        break;
      }

      case '-clearallboost': {
        Object.keys(output.activeNames).forEach((side) => { output.speedChangedTurn[side] = turn; });

        break;
      }

      case 'move': {
        const [side, name] = parseIdent(parts[2]);
        const move = parts[3];
        const tags = parts.slice(4).join('|');

        if (!side || !move) {
          break;
        }

        const called = tags.includes('[from]') && !tags.includes('[from]lockedmove');

        if (called) {
          break;
        }

        output.activeNames[side] = name;
        (output.movesSinceSwitchIn[side] = output.movesSinceSwitchIn[side] || []).push(move);

        if (current && !firstMovers.includes(side)) {
          firstMovers.push(side);
          current.movers[side] = { name, move };

          if (!current.firstSide) {
            current.firstSide = side;
          }
        }

        break;
      }

      case '-fieldstart':
      case '-fieldend': {
        if (parts[2]?.includes('Trick Room')) {
          trickRoom = cmd === '-fieldstart';

          if (current) {
            current.unreliable = true;
          }
        }

        break;
      }

      case '-sidestart':
      case '-sideend': {
        if (parts[3]?.includes('Tailwind')) {
          const [side] = parseIdent(`${parts[2]?.split(':')[0]}a: x`);

          if (side) {
            tailwind[side] = cmd === '-sidestart';
          }

          if (current) {
            current.unreliable = true;
          }
        }

        break;
      }

      case '-activate':
      case '-ability': {
        if (current && OrderOverrides.some((o) => raw.includes(o))) {
          current.unreliable = true;
        }

        break;
      }

      default: {
        break;
      }
    }
  });

  finishTurn();

  return output;
};

/**
 * Finds the current Showdown battle's protocol lines & move request for `battleId`, if the page has them.
 *
 * * Works on both the classic & Preact clients; returns empty values anywhere else (e.g., the Honkdex).
 *
 * @since 1.4.3
 */
export const getLiveBattle = (battleId: string): {
  stepQueue: string[];
  request: AdvisorLiveRequest;
} => {
  const empty = { stepQueue: [] as string[], request: null as AdvisorLiveRequest };

  if (!battleId || typeof window === 'undefined') {
    return empty;
  }

  try {
    const host = window as unknown as {
      app?: { rooms?: Record<string, { battle?: { stepQueue?: string[]; }; request?: AdvisorLiveRequest; }>; };
      PS?: { rooms?: Record<string, { battle?: { stepQueue?: string[]; }; request?: AdvisorLiveRequest; }>; };
    };

    const room = host.app?.rooms?.[battleId] || host.PS?.rooms?.[battleId];

    return {
      stepQueue: room?.battle?.stepQueue || [],
      request: room?.request || null,
    };
  } catch {
    return empty;
  }
};

/**
 * The bits of Showdown's move request (`|request|`) the advisor reads.
 *
 * @since 1.4.3
 */
export interface AdvisorLiveRequest {
  rqid?: number;
  wait?: boolean;
  forceSwitch?: boolean[];
  active?: {
    moves?: { move?: string; id?: string; disabled?: boolean | string; }[];
    trapped?: boolean;
    maybeTrapped?: boolean;

    /**
     * Your Tera type, when you can still Terastallize this turn.
     */
    canTerastallize?: string;
  }[];
  side?: { id?: string; };
}
