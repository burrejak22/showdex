/**
 * @file `buildBattleAdvice.ts`
 * @since 1.4.3
 */

import { type MoveName, type Result as SmogonResult, toID } from '@smogon/calc';
import { type ShowdexSettings } from '@showdex/interfaces/app';
import {
  type CalcdexBattleState,
  type CalcdexPlayer,
  type CalcdexPlayerKey,
  type CalcdexPokemon,
  CalcdexPlayerKeys as AllPlayerKeys,
} from '@showdex/interfaces/calc';
import {
  type CalcdexMatchupResult,
  calcPokemonCurrentHp,
  calcPokemonFinalStats,
  calcPokemonHpPercentage,
  calcPokemonMaxHp,
  calcSmogonMatchup,
} from '@showdex/utils/calc';
import { formatId } from '@showdex/utils/core';
import { detectGroundedness, getDexForFormat, getTypesDex } from '@showdex/utils/dex';
import { flattenAlts } from '@showdex/utils/presets';
import {
  type AdvisorInput,
  type AdvisorMon,
  type AdvisorMove,
  type AdvisorMoveKind,
  type AdvisorResult,
  type AdvisorSwitchOption,
  effectiveRolls,
  firstMoveProbability,
  meanDamage,
  pickThreat,
  scoreBattleAdvice,
  simulateExchange,
} from './scoreBattleAdvice';
import { getLiveBattle, readBattleLog } from './readBattleLog';
import { type TeamGuide, type TeamGuideMon, scoreTeamGuide } from './scoreTeamGuide';
import {
  type GamePlan,
  type GamePlanInput,
  GamePlanRoleValues,
  scoreGamePlan,
  simulateDuel,
} from './scoreGamePlan';

/**
 * Subset of a raw `BattleMovedex` entry the advisor reads.
 *
 * * The client's `Move` class drops these, but they're still present in the raw `BattleMovedex` data.
 *
 * @since 1.4.3
 */
interface RawMoveData {
  boosts?: Record<string, number>;
  self?: { boosts?: Record<string, number>; };
  selfBoost?: { boosts?: Record<string, number>; };
  target?: string;
  sideCondition?: string;
  selfSwitch?: boolean | string;
  drain?: [number, number];
  heal?: [number, number];
  status?: string;
  volatileStatus?: string;
  stallingMove?: boolean;
}

const HazardIds = ['stealthrock', 'spikes', 'toxicspikes', 'stickyweb'];

// fallbacks in case the raw move data isn't available
const SetupMoveIds = [
  'swordsdance', 'dragondance', 'calmmind', 'nastyplot', 'bulkup', 'quiverdance', 'shellsmash', 'irondefense',
  'agility', 'rockpolish', 'coil', 'shiftgear', 'tailglow', 'geomancy', 'victorydance', 'tidyup', 'bellydrum',
  'curse', 'growth', 'workup', 'honeclaws', 'cosmicpower', 'amnesia', 'acidarmor', 'clangoroussoul', 'filletaway',
  'noretreat', 'trailblaze',
];

const RecoveryMoveIds = [
  'recover', 'roost', 'slackoff', 'softboiled', 'milkdrink', 'moonlight', 'morningsun', 'synthesis', 'shoreup',
  'strengthsap', 'healorder', 'junglehealing', 'lunarblessing', 'rest', 'wish',
];

const ProtectMoveIds = [
  'protect', 'detect', 'kingsshield', 'spikyshield', 'banefulbunker', 'silktrap', 'burningbulwark', 'obstruct',
];

const PivotMoveIds = [
  'uturn', 'voltswitch', 'flipturn', 'partingshot', 'teleport', 'chillyreception', 'shedtail', 'batonpass',
];

const StatusMoveMap: Record<string, string> = {
  spore: 'slp',
  sleeppowder: 'slp',
  hypnosis: 'slp',
  sing: 'slp',
  lovelykiss: 'slp',
  darkvoid: 'slp',
  yawn: 'slp',
  thunderwave: 'par',
  stunspore: 'par',
  glare: 'par',
  nuzzle: 'par',
  willowisp: 'brn',
  toxic: 'tox',
  poisonpowder: 'psn',
  toxicthread: 'psn',
};

const ChoiceItems: Record<string, string> = {
  choiceband: 'Choice Band',
  choicespecs: 'Choice Specs',
  choicescarf: 'Choice Scarf',
};

// abilities that ignore or punish Intimidate
const IntimidateImmuneAbilities = [
  'clearbody', 'whitesmoke', 'fullmetalbody', 'hypercutter', 'innerfocus', 'oblivious', 'owntempo', 'scrappy',
  'guarddog', 'mirrorarmor',
];

const IntimidatePunishAbilities: Record<string, string> = {
  defiant: 'Defiant',
  competitive: 'Competitive',
  rattled: 'Rattled',
};

// moves that faint the user, and the "last moves" worth going out on
const SelfKOMoveIds = [
  'explosion', 'selfdestruct', 'mistyexplosion', 'memento', 'healingwish', 'lunardance', 'finalgambit',
];

const LastWishMoves: Record<string, AdvisorMove['lastWish']> = {
  memento: 'memento',
  healingwish: 'healingwish',
  lunardance: 'healingwish',
  destinybond: 'destinybond',
};

// moves that thaw the user out before it moves
const ThawMoveIds = [
  'flamewheel', 'sacredfire', 'flareblitz', 'fusionflare', 'scald', 'steameruption', 'burnup', 'pyroball',
  'scorchingsands', 'matchagotcha',
];

/**
 * Chance `pokemon` gets to act this turn, given its status & confusion, and why.
 *
 * * Sleep (Gen 5+) lasts 1-3 turns at random, so after `k` turns asleep the odds of waking this turn are
 *   0, 1/3, 1/2, then certain.
 * * Freeze thaws 20% of the time; full paralysis hits 25% of the time; confusion self-hits 33% of the time.
 *
 * @since 1.4.3
 */
export const detectActChance = (pokemon: CalcdexPokemon): { chance: number; note: string; } => {
  const status = pokemon?.dirtyStatus === 'ok' ? null : (pokemon?.dirtyStatus || pokemon?.status);
  const ability = currentAbility(pokemon);
  const volatiles = (pokemon?.volatiles || {}) as Record<string, unknown>;
  const notes: string[] = [];
  let chance = 1;

  if (status === 'slp' && ability !== 'comatose') {
    const slept = pokemon.sleepCounter || 0;
    let wake = (slept <= 0 && 0) || (slept === 1 && 1 / 3) || (slept === 2 && 0.5) || 1;

    if (ability === 'earlybird') {
      wake = slept <= 0 ? 1 / 3 : 1;
    }

    chance *= wake;
    notes.push(wake > 0 ? `asleep, ${Math.round(wake * 100)}% to wake` : 'asleep');
  }

  if (status === 'frz') {
    chance *= 0.2;
    notes.push('frozen');
  }

  if (status === 'par') {
    chance *= 0.75;
    notes.push('paralyzed');
  }

  if ('confusion' in volatiles && ability !== 'owntempo') {
    chance *= 2 / 3;
    notes.push('confused');
  }

  return { chance, note: notes.join(', ') || null };
};

/**
 * Whether `pokemon` survives one hit from full HP, and why.
 *
 * @since 1.4.3
 */
const detectSash = (pokemon: CalcdexPokemon): string => {
  if (currentItem(pokemon) === 'focussash') {
    return 'Focus Sash';
  }

  if (currentAbility(pokemon) === 'sturdy') {
    return 'Sturdy';
  }

  return null;
};

const getRawMove = (id: string): RawMoveData => {
  try {
    const dex = (globalThis as unknown as { BattleMovedex?: Record<string, RawMoveData>; }).BattleMovedex;

    return dex?.[id] || null;
  } catch {
    return null;
  }
};

/**
 * Flattens the `damage` of a `@smogon/calc` result into one list of total-damage rolls.
 *
 * * Multi-hit moves come back as one roll list per hit, which are summed roll-by-roll.
 *
 * @since 1.4.3
 */
export const extractDamageRolls = (result: SmogonResult): number[] => {
  const damage = result?.damage as number | number[] | number[][];

  if (typeof damage === 'number') {
    return [damage];
  }

  if (!Array.isArray(damage) || !damage.length) {
    return [];
  }

  if (typeof damage[0] === 'number') {
    const rolls = damage as number[];

    // fixed multi-hit damage (e.g., [40, 40]) has fewer than 16 entries; it's one total
    return rolls.length < 16 ? [rolls.reduce((sum, d) => sum + d, 0)] : [...rolls];
  }

  const hits = damage as number[][];
  const count = Math.max(...hits.map((h) => h?.length || 0));

  return Array.from({ length: count }, (_, i) => hits.reduce((sum, h) => (
    sum + (h?.[Math.min(i, (h?.length || 1) - 1)] || 0)
  ), 0));
};

const currentStatus = (pokemon: CalcdexPokemon): string => {
  const status = pokemon?.dirtyStatus === 'ok' ? null : (pokemon?.dirtyStatus || pokemon?.status);

  return status ? String(status) : null;
};

const currentAbility = (pokemon: CalcdexPokemon): string => formatId(pokemon?.dirtyAbility || pokemon?.ability);

const currentItem = (pokemon: CalcdexPokemon): string => formatId(pokemon?.dirtyItem ?? pokemon?.item);

/**
 * Converts one calculated matchup into an `AdvisorMove`.
 *
 * @since 1.4.3
 */
const toAdvisorMove = (
  format: string,
  moveName: MoveName,
  matchup: CalcdexMatchupResult,
  attacker: CalcdexPokemon,
  defender: CalcdexPokemon,
  terrain: string,
  guessed?: boolean,
): AdvisorMove => {
  const dex = getDexForFormat(format);
  const dexMove = dex?.moves.get(moveName);

  if (!dexMove?.exists) {
    return null;
  }

  const raw = getRawMove(dexMove.id);
  const id = dexMove.id as string;
  const ability = currentAbility(attacker);
  const hpFull = calcPokemonCurrentHp(attacker) >= calcPokemonMaxHp(attacker);

  let kind: AdvisorMoveKind = 'other';
  let heal: number = null;
  let status: string = null;
  let hazard: string = null;

  if (dexMove.category !== 'Status') {
    kind = 'attack';

    // variable-damage moves the calc can't model (Counter, Metal Burst, etc.) come back as 0
    if (!dexMove.basePower && !dexMove.damage && !dexMove.ohko) {
      kind = 'other';
    }
  } else if (HazardIds.includes(formatId(raw?.sideCondition)) || HazardIds.includes(id)) {
    kind = 'hazard';
    hazard = formatId(raw?.sideCondition) || id;
  } else if (raw?.stallingMove || ProtectMoveIds.includes(id)) {
    kind = 'protect';
  } else if (dexMove.heal || raw?.heal || RecoveryMoveIds.includes(id)) {
    kind = 'recovery';

    const [num, den] = (dexMove.heal || raw?.heal || [1, 2]) as number[];

    heal = id === 'rest' ? 1 : (num / (den || 1));
  } else if (dexMove.status || raw?.status || StatusMoveMap[id]) {
    kind = 'status';
    status = String(dexMove.status || raw?.status || StatusMoveMap[id]);
  } else if (
    (raw?.target === 'self' && raw?.boosts && Object.values(raw.boosts).some((v) => v > 0))
      || SetupMoveIds.includes(id)
  ) {
    kind = 'setup';
  }

  let priority = dexMove.priority || 0;

  if (ability === 'prankster' && dexMove.category === 'Status') {
    priority += 1;
  }

  if (ability === 'galewings' && dexMove.type === 'Flying' && hpFull) {
    priority += 1;
  }

  if (ability === 'triage' && (kind === 'recovery' || !!raw?.drain)) {
    priority += 3;
  }

  if (id === 'grassyglide' && formatId(terrain) === 'grassy') {
    priority += 1;
  }

  const [recoilNum, recoilDen] = dexMove.recoil || [];
  const [drainNum, drainDen] = raw?.drain || [];

  // moves that work through sleep / freeze
  const attackerStatus = currentStatus(attacker);
  let actChance: number;

  if (attackerStatus === 'slp' && ['sleeptalk', 'snore'].includes(id)) {
    actChance = 1;
  } else if (attackerStatus === 'frz' && ThawMoveIds.includes(id)) {
    actChance = 1;
  }

  // chip the attacker takes for connecting: Life Orb, plus Rocky Helmet / Rough Skin / Iron Barbs on contact
  let selfDamage = 0;
  const selfDamageSources: string[] = [];

  if (kind === 'attack' && ability !== 'magicguard') {
    const contact = !!dexMove.flags?.contact
      && ability !== 'longreach'
      && currentItem(attacker) !== 'protectivepads';

    const defenderItem = currentItem(defender);
    const defenderAbility = currentAbility(defender);

    if (currentItem(attacker) === 'lifeorb') {
      selfDamage += 0.1;
      selfDamageSources.push('Life Orb');
    }

    if (contact && defenderItem === 'rockyhelmet') {
      selfDamage += 1 / 6;
      selfDamageSources.push('Rocky Helmet');
    }

    if (contact && (defenderAbility === 'roughskin' || defenderAbility === 'ironbarbs')) {
      selfDamage += 1 / 8;
      selfDamageSources.push(defenderAbility === 'roughskin' ? 'Rough Skin' : 'Iron Barbs');
    }
  }

  return {
    name: dexMove.name,
    kind,
    rolls: kind === 'attack' ? extractDamageRolls(matchup?.result) : [],
    accuracy: dexMove.accuracy === true ? 1 : Math.min(1, (dexMove.accuracy || 100) / 100),
    priority,
    pivot: !!raw?.selfSwitch || PivotMoveIds.includes(id),
    recoil: recoilNum && ability !== 'rockhead' && ability !== 'magicguard' ? recoilNum / (recoilDen || 1) : 0,
    drain: drainNum ? drainNum / (drainDen || 1) : 0,
    heal,
    status,
    hazard,
    guessed,
    multihit: !!dexMove.multihit,
    actChance,
    selfKO: SelfKOMoveIds.includes(id),
    lastWish: LastWishMoves[id],
    selfDamage,
    selfDamageSource: selfDamageSources.join(' + ') || null,
  };
};

/**
 * Absolute HP `pokemon` loses switching into `player`'s side (Stealth Rock + Spikes).
 *
 * @since 1.4.3
 */
const calcEntryDamage = (
  format: string,
  gen: number,
  pokemon: CalcdexPokemon,
  player: CalcdexPlayer,
  state: CalcdexBattleState,
): number => {
  const side = player?.side;
  const maxHp = calcPokemonMaxHp(pokemon);

  if (!side || !maxHp || currentItem(pokemon) === 'heavydutyboots' || currentAbility(pokemon) === 'magicguard') {
    return 0;
  }

  let fraction = 0;

  if (side.isSR) {
    try {
      const rock = getTypesDex(gen as Parameters<typeof getTypesDex>[0]).get(toID('Rock'));
      const types = (pokemon.dirtyTypes?.length ? pokemon.dirtyTypes : pokemon.types) || [];
      const effectiveness = types.reduce((mult, type) => (
        mult * ((rock?.effectiveness as Record<string, number>)?.[type] ?? 1)
      ), 1);

      fraction += 0.125 * effectiveness;
    } catch {
      fraction += 0.125;
    }
  }

  const spikes = side.spikes || 0;

  if (spikes > 0 && detectGroundedness(pokemon, state?.field) !== false) {
    fraction += [0, 1 / 8, 1 / 6, 1 / 4][Math.min(3, spikes)];
  }

  return Math.floor(maxHp * fraction);
};

// moves that lock the user in for 2-3 turns, then confuse it
const RampageMoveIds = ['outrage', 'petaldance', 'thrash', 'ragingfury'];

/**
 * Everything the advisor works out for one turn.
 *
 * @since 1.4.3
 */
export interface BattleAdviceBundle {
  /**
   * Best move / switch this turn (`null` if there's nothing to pick, e.g., while recharging).
   */
  advice: AdvisorResult;

  /**
   * Win condition, threats & answers, and sack fodder across both teams.
   */
  plan: GamePlan;

  /**
   * Things the advisor figured out from the battle itself (e.g., an inferred Choice Scarf), newest first.
   */
  insights: string[];

  /**
   * Speed check between the two active Pokemon.
   */
  speed?: {
    mine: number;
    theirs: number;

    /**
     * Chance you move first with same-priority moves (`0`, `0.5` or `1`).
     */
    first: number;

    /**
     * Why their speed is what it is, if it's not just their stats (e.g., a guessed or inferred Choice Scarf).
     */
    note?: string;

    /**
     * Their speed with a Choice Scarf, when that would flip who moves first & they could be holding one.
     */
    ifScarfed?: number;
  };

  /**
   * How to play your team: your ace, what stops it, and a job for every teammate.
   */
  guide?: TeamGuide;

  /**
   * Pokemon left & total HP (as a fraction of each side's team), counting unrevealed Pokemon of theirs at full HP.
   */
  tally?: {
    mine: { left: number; hp: number; };
    theirs: { left: number; hp: number; };
  };
}

const PlaceholderKey = {};

// results cached per immutable state object, so unchanged matchups aren't recalculated every render.
// Redux hands us new objects whenever something changes, which is exactly when a calc needs redoing.
let calcCache = new WeakMap<object, unknown>();
let calcCacheFormat: string = null;

const cachedCalc = (
  keys: unknown[],
  moveName: string,
  run: () => CalcdexMatchupResult,
): CalcdexMatchupResult => {
  let node = calcCache as WeakMap<object, unknown>;

  for (const key of keys) {
    const k = (key && typeof key === 'object') ? key : PlaceholderKey;
    let next = node.get(k) as WeakMap<object, unknown>;

    if (!next) {
      next = new WeakMap();
      node.set(k, next);
    }

    node = next;
  }

  const leaf = (node as unknown as WeakMap<object, Map<string, CalcdexMatchupResult>>);
  let results = leaf.get(PlaceholderKey);

  if (!results) {
    results = new Map();
    leaf.set(PlaceholderKey, results);
  }

  if (!results.has(moveName)) {
    results.set(moveName, run());
  }

  return results.get(moveName);
};

// Tera'd copies of a Pokemon & of the state holding it, memoized so their identity (and thus the calc cache) is
// stable for as long as the originals are
const teraPokemonMemo = new WeakMap<CalcdexPokemon, Map<string, CalcdexPokemon>>();
const teraStateMemo = new WeakMap<CalcdexBattleState, Map<string, CalcdexBattleState>>();

const teraVariant = (
  state: CalcdexBattleState,
  key: CalcdexPlayerKey,
  index: number,
  type: string,
): CalcdexBattleState => {
  const pokemon = state?.[key]?.pokemon?.[index];

  if (!pokemon?.speciesForme || !type) {
    return null;
  }

  let pokemonVariants = teraPokemonMemo.get(pokemon);

  if (!pokemonVariants) {
    pokemonVariants = new Map();
    teraPokemonMemo.set(pokemon, pokemonVariants);
  }

  if (!pokemonVariants.has(type)) {
    pokemonVariants.set(type, {
      ...pokemon,
      terastallized: true,
      dirtyTeraType: type as Showdown.TypeName,
    });
  }

  const teraPokemon = pokemonVariants.get(type);
  const stateKey = `${key}:${index}:${type}`;
  let stateVariants = teraStateMemo.get(state);

  if (!stateVariants) {
    stateVariants = new Map();
    teraStateMemo.set(state, stateVariants);
  }

  if (!stateVariants.has(stateKey)) {
    const player = state[key];

    stateVariants.set(stateKey, {
      ...state,
      [key]: {
        ...player,
        pokemon: player.pokemon.map((p, i) => (i === index ? teraPokemon : p)),
      },
    });
  }

  return stateVariants.get(stateKey);
};

/**
 * Builds the battle advisor's suggestions & game plan from the current Calcdex `state`.
 *
 * * Only runs for the logged-in player in singles battles; returns `null` otherwise (e.g., spectating).
 * * Pass the live battle (`getLiveBattle()`) to unlock what the Calcdex state alone can't tell:
 *   disabled moves & trapping (from the move request), and turn order & move history (from the battle log),
 *   which are used to catch things like a hidden *Choice Scarf*.
 * * Calcs are cached per state object, so re-running this on every render only redoes what changed.
 *
 * @since 1.4.3
 */
export const buildBattleAdvice = (
  state: CalcdexBattleState,
  settings?: ShowdexSettings,
  live?: ReturnType<typeof getLiveBattle>,
): BattleAdviceBundle => {
  const {
    operatingMode,
    format,
    gen,
    gameType,
    authPlayerKey,
    playerKey: topKey,
    opponentKey: bottomKey,
    field,
  } = state || {};

  if (operatingMode !== 'battle' || gameType !== 'Singles' || !authPlayerKey || !format) {
    return null;
  }

  const myKey: CalcdexPlayerKey = authPlayerKey;
  const oppKey: CalcdexPlayerKey = myKey === topKey ? bottomKey : topKey;
  const me = state[myKey];
  const opp = state[oppKey];

  const myIndex = me?.activeIndices?.[0] ?? -1;
  const oppIndex = opp?.activeIndices?.[0] ?? -1;
  const myActive = me?.pokemon?.[myIndex];
  const oppActive = opp?.pokemon?.[oppIndex];

  if (!oppActive?.speciesForme || !me?.pokemon?.length) {
    return null;
  }

  if (calcCacheFormat !== `${format}:${gameType}`) {
    calcCache = new WeakMap();
    calcCacheFormat = `${format}:${gameType}`;
  }

  const dex = getDexForFormat(format);
  const allPlayers = AllPlayerKeys.filter((k) => state[k]?.active).map((k) => state[k]);
  const terrain = field?.dirtyTerrain ?? field?.terrain;
  const log = readBattleLog(live?.stepQueue);
  const insights: string[] = [];

  const nameOf = (pokemon: CalcdexPokemon) => pokemon?.name || pokemon?.speciesForme;
  const alive = (pokemon: CalcdexPokemon) => !!pokemon?.speciesForme && !pokemon.fainted && calcPokemonCurrentHp(pokemon) > 0;

  const calc = (
    attackerKey: CalcdexPlayerKey,
    attackerIndex: number,
    defenderKey: CalcdexPlayerKey,
    defenderIndex: number,
    moveName: MoveName,
    calcState: CalcdexBattleState = state,
  ) => cachedCalc(
    [
      settings,
      field,
      calcState[attackerKey]?.side,
      calcState[defenderKey]?.side,
      calcState[attackerKey]?.pokemon?.[attackerIndex],
      calcState[defenderKey]?.pokemon?.[defenderIndex],
    ],
    moveName,
    () => calcSmogonMatchup(calcState, moveName, {
      playerKey: attackerKey,
      playerSelectionIndex: attackerIndex,
      opponentKey: defenderKey,
      opponentSelectionIndex: defenderIndex,
      settings,
      silent: true,
    }),
  );

  const speedOf = (
    pokemon: CalcdexPokemon,
    target: CalcdexPokemon,
    owner: CalcdexPlayer,
    other: CalcdexPlayer,
  ) => calcPokemonFinalStats(format, pokemon, target, owner, other, field, allPlayers)?.stats?.spe || 0;

  // --- their speed, corrected by what the battle log shows ---

  let oppSpeedFactor = 1;
  let oppScarf = ChoiceItems[currentItem(oppActive)] === 'Choice Scarf';
  let oppScarfInferred = false;

  // only turns from both actives' current stints, with no speed changes since, can be compared to speeds now
  // (an older turn might've been under Sticky Web, paralysis, a boost, etc.)
  const speedSince = Math.max(log.speedChangedTurn[myKey] ?? 0, log.speedChangedTurn[oppKey] ?? 0);

  const order = [...log.orders].reverse().find((o) => (
    !o.unreliable
      && o.turn > speedSince
      && o.movers[oppKey]?.name === nameOf(oppActive)
      && o.movers[myKey]?.name === nameOf(myActive)
  ));

  if (order) {
    const myMon = me.pokemon.find((p) => nameOf(p) === order.movers[myKey].name);
    const myMove = dex?.moves.get(order.movers[myKey].move);
    const oppMove = dex?.moves.get(order.movers[oppKey].move);

    // only clean comparisons: same priority, no status moves (Prankster & co. muddy those)
    const comparable = !!myMon
      && !!myMove?.exists
      && !!oppMove?.exists
      && myMove.category !== 'Status'
      && oppMove.category !== 'Status'
      && (myMove.priority || 0) === (oppMove.priority || 0);

    if (comparable) {
      const mySpe = speedOf(myMon, oppActive, me, opp);
      const oppSpe = speedOf(oppActive, myMon, opp, me);
      const oppName = nameOf(oppActive);

      if (order.firstSide === oppKey && oppSpe > 0 && oppSpe < mySpe) {
        if (!oppScarf && oppSpe * 1.5 > mySpe) {
          oppScarf = true;
          oppScarfInferred = true;
          oppSpeedFactor = Math.max(1.5, (mySpe + 1) / oppSpe);
          insights.push(`Likely Choice Scarf: ${oppName} outsped your ${nameOf(myMon)} on turn ${order.turn}.`);
        } else {
          oppSpeedFactor = (mySpe + 1) / oppSpe;
          insights.push(`${oppName} is faster than expected: it outsped your ${nameOf(myMon)} on turn ${order.turn}.`);
        }
      } else if (order.firstSide === myKey && oppSpe > mySpe) {
        if (oppScarf) {
          oppScarf = false;
          oppSpeedFactor = Math.min(1 / 1.5, (mySpe - 1) / oppSpe);
          insights.push(`Probably not Choice Scarf: your ${nameOf(myMon)} outsped ${oppName} on turn ${order.turn}.`);
        } else {
          oppSpeedFactor = Math.max(0.1, (mySpe - 1) / oppSpe);
          insights.push(`${oppName} is slower than expected: your ${nameOf(myMon)} outsped it on turn ${order.turn}.`);
        }
      }
    }
  }

  const toMon = (
    pokemon: CalcdexPokemon,
    target: CalcdexPokemon,
    owner: CalcdexPlayer,
    other: CalcdexPlayer,
  ): AdvisorMon => ({
    name: nameOf(pokemon),
    hp: calcPokemonCurrentHp(pokemon),
    maxHp: calcPokemonMaxHp(pokemon),
    speed: Math.round(speedOf(pokemon, target, owner, other) * (pokemon === oppActive ? oppSpeedFactor : 1)),
    status: currentStatus(pokemon),
    sash: !!detectSash(pokemon),
    sashSource: detectSash(pokemon),
    ...(() => {
      const { chance, note } = detectActChance(pokemon);

      return chance < 1 ? { actChance: chance, actNote: note } : {};
    })(),
  });

  // --- their move lock (Choice items, known or inferred, & Outrage-style rampages) ---

  const oppUsed = log.activeNames[oppKey] === nameOf(oppActive)
    ? (log.movesSinceSwitchIn[oppKey] || [])
    : (formatId(oppActive.lastMove) && formatId(oppActive.lastMove) !== 'switchin' ? [oppActive.lastMove as string] : []);

  const oppDistinct = [...new Set(oppUsed.map(formatId))];
  let oppChoice = (oppScarf && 'Choice Scarf')
    || ChoiceItems[currentItem(oppActive)]
    || (currentAbility(oppActive) === 'gorillatactics' ? 'Gorilla Tactics' : null);

  if (oppChoice && oppDistinct.length >= 2) {
    insights.push(`${nameOf(oppActive)} isn't holding a Choice item: it used ${oppUsed.slice(-2).join(' and ')} without switching.`);
    oppChoice = null;

    if (oppScarfInferred) {
      insights.splice(insights.findIndex((i) => i.startsWith('Likely Choice Scarf')), 1);
      insights.push(`${nameOf(oppActive)} is faster than expected (a speed boost or Tailwind, not Scarf).`);
    }
  }

  const oppLast = oppUsed[oppUsed.length - 1];
  const oppRampageRun = oppLast && RampageMoveIds.includes(formatId(oppLast))
    ? oppUsed.slice().reverse().findIndex((m) => formatId(m) !== formatId(oppLast))
    : -2;

  let oppMoveNames = (oppActive.moves || []).filter(Boolean);
  let oppLockedMove: string = null;

  if (oppChoice && oppLast) {
    oppLockedMove = oppLast;
    insights.unshift(`${nameOf(oppActive)} is locked into ${oppLast} (${oppChoice}) unless it switches.`);
  } else if (oppRampageRun === 1 || (oppRampageRun === -1 && oppUsed.length === 1)) {
    oppLockedMove = oppLast;
    insights.unshift(`${nameOf(oppActive)} is locked into ${oppLast} for at least one more turn.`);
  }

  if (oppLockedMove) {
    const lockedName = oppMoveNames.find((m) => formatId(m) === formatId(oppLockedMove))
      || (dex?.moves.get(oppLockedMove)?.name as MoveName);

    oppMoveNames = lockedName ? [lockedName] : oppMoveNames;
  }

  // Fake Out & First Impression only work on a Pokemon's first turn out
  const FirstTurnMoveIds = ['fakeout', 'firstimpression'];

  if (oppUsed.length) {
    oppMoveNames = oppMoveNames.filter((m) => !FirstTurnMoveIds.includes(formatId(m)));
  }

  const myUsed = log.activeNames[myKey] === nameOf(myActive) ? (log.movesSinceSwitchIn[myKey] || []) : [];

  const movesFor = (
    attacker: CalcdexPokemon,
    attackerKey: CalcdexPlayerKey,
    attackerIndex: number,
    defenderKey: CalcdexPlayerKey,
    defenderIndex: number,
    names: MoveName[],
    markGuesses?: boolean,
    calcState: CalcdexBattleState = state,
  ): AdvisorMove[] => names
    .map((name) => toAdvisorMove(
      format,
      name,
      calc(attackerKey, attackerIndex, defenderKey, defenderIndex, name, calcState),
      attacker,
      calcState[defenderKey]?.pokemon?.[defenderIndex],
      terrain,
      markGuesses ? !(attacker.revealedMoves || []).map(formatId).includes(formatId(name)) : false,
    ))
    .filter(Boolean);

  const movesOf = (pokemon: CalcdexPokemon): MoveName[] => (
    pokemon === oppActive ? oppMoveNames : (pokemon.moves || []).filter(Boolean)
  );

  // --- game plan: every one of yours vs every one of theirs you've seen ---

  const mine = me.pokemon
    .map((pokemon, index) => ({ pokemon, index }))
    .filter(({ pokemon }) => alive(pokemon));

  const foes = (opp.pokemon || [])
    .map((pokemon, index) => ({ pokemon, index }))
    .filter(({ pokemon }) => alive(pokemon));

  const duels: GamePlanInput['duels'] = {};

  // my moves vs each foe (& theirs vs mine), kept around for the checks & predictions below
  const myMovesVsFoe: Record<number, Record<number, AdvisorMove[]>> = {};
  const foeMovesVsMine: Record<number, Record<number, AdvisorMove[]>> = {};

  mine.forEach(({ pokemon, index }) => {
    duels[index] = {};
    myMovesVsFoe[index] = {};

    foes.forEach(({ pokemon: foe, index: foeIndex }) => {
      const myMoves = movesFor(pokemon, myKey, index, oppKey, foeIndex, movesOf(pokemon));
      const theirMoves = movesFor(foe, oppKey, foeIndex, myKey, index, movesOf(foe), true);

      myMovesVsFoe[index][foeIndex] = myMoves;
      foeMovesVsMine[foeIndex] = foeMovesVsMine[foeIndex] || {};
      foeMovesVsMine[foeIndex][index] = theirMoves;
      duels[index][foeIndex] = simulateDuel(
        toMon(pokemon, foe, me, opp),
        myMoves,
        toMon(foe, pokemon, opp, me),
        theirMoves,
      );
    });
  });

  const plan = scoreGamePlan({
    mine: mine.map(({ pokemon, index }) => ({ index, name: nameOf(pokemon), hpFraction: calcPokemonHpPercentage(pokemon) })),
    theirs: foes.map(({ pokemon, index }) => ({ index, name: nameOf(pokemon), hpFraction: calcPokemonHpPercentage(pokemon) })),
    duels,
    myActiveIndex: myIndex,
    theirActiveIndex: oppIndex,
    unseen: Math.max(0, (opp.maxPokemon || 6) - (opp.pokemon || []).filter((p) => p?.speciesForme).length),
  });

  // --- this turn ---

  const forcedSwitch = !alive(myActive);
  const opponent = toMon(oppActive, myActive, opp, me);

  // used to value burns: does their (likely) set mostly hit physically?
  const oppCategories = (oppActive.moves || [])
    .map((m) => dex?.moves.get(m)?.category)
    .filter((c) => c && c !== 'Status');

  opponent.physical = oppCategories.length > 0
    && oppCategories.filter((c) => c === 'Physical').length >= (oppCategories.length / 2);

  // status on either side: who can actually move this turn?
  if (currentStatus(oppActive) === 'slp' && oppMoveNames.some((m) => formatId(m) === 'sleeptalk')) {
    opponent.actChance = Math.max(opponent.actChance ?? 1, 0.75);
    opponent.actNote = 'asleep, but has Sleep Talk';
  }

  if ((opponent.actChance ?? 1) <= 0.5) {
    insights.push(`${opponent.name} is ${opponent.actNote}: it probably can't hit you this turn.`);
  }

  if (!forcedSwitch) {
    const { chance, note } = detectActChance(myActive);
    const hasSleepTalk = (myActive.moves || []).some((m) => formatId(m) === 'sleeptalk');

    if (chance < 1) {
      insights.unshift(
        `${nameOf(myActive)} is ${note}: ${Math.round(chance * 100)}% to act this turn`
          + `${currentStatus(myActive) === 'slp' && hasSleepTalk ? ', but Sleep Talk works while asleep' : ''}.`,
      );
    }
  }

  const role = plan.roles[myIndex] || 'neutral';

  const input: AdvisorInput = {
    me: forcedSwitch
      ? { name: nameOf(myActive) || '--', hp: 0, maxHp: 1, speed: 0 }
      : toMon(myActive, oppActive, me, opp),
    opponent,
    myMoves: forcedSwitch ? [] : movesFor(myActive, myKey, myIndex, oppKey, oppIndex, movesOf(myActive)),
    opponentMoves: forcedSwitch ? [] : movesFor(oppActive, oppKey, oppIndex, myKey, myIndex, oppMoveNames, true),
    switches: [],
    forcedSwitch,
    opponentHazards: [
      opp?.side?.isSR && 'stealthrock',
      (opp?.side?.spikes || 0) > 0 && 'spikes',
      ...Object.keys(opp?.side?.conditions || {}).map(formatId),
    ].filter(Boolean) as string[],
    opponentRemaining: Math.max(
      1,
      (opp?.maxPokemon || 6) - (opp?.pokemon || []).filter((p) => p?.speciesForme && !alive(p)).length,
    ),
    activeValue: GamePlanRoleValues[role],
    activeRole: (role === 'wincon' && 'your win condition')
      || (role === 'answer' && 'your only answer to one of their threats')
      || null,
  };

  // --- your locks: the live request is the source of truth; lastMove is the fallback ---

  const request = live?.request;
  const requestActive = !request?.wait && (!request?.side?.id || request.side.id === myKey)
    ? request?.active?.[0]
    : null;

  if (!forcedSwitch && requestActive?.moves?.length) {
    const requested = requestActive.moves.map((m) => ({ id: formatId(m.id || m.move), move: m.move, disabled: !!m.disabled }));

    if (requested.length === 1 && ['recharge', 'struggle'].includes(requested[0].id)) {
      insights.unshift(requested[0].id === 'recharge'
        ? `${nameOf(myActive)} must recharge this turn.`
        : `${nameOf(myActive)} can only Struggle.`);

      return { advice: null, plan, insights };
    }

    const usable = requested.filter((m) => !m.disabled);
    const lockSource = ChoiceItems[currentItem(myActive)]
      || (currentAbility(myActive) === 'gorillatactics' ? 'Gorilla Tactics' : null);

    const volatiles = (myActive.volatiles || {}) as Record<string, unknown>;

    input.myMoves = input.myMoves.map((m) => {
      const id = formatId(m.name);
      const entry = requested.find((r) => r.id === id);
      const onlyOne = usable.length === 1 && usable[0].id !== id;

      // a move the request doesn't list (shouldn't happen) is left alone unless you're locked into another
      if ((entry && !entry.disabled && !onlyOne) || (!entry && usable.length > 1)) {
        return m;
      }

      let why = 'Disabled';

      if (usable.length === 1) {
        why = `Locked into ${usable[0].move}`
          + ((lockSource && ` (${lockSource})`) || ('encore' in volatiles && ' (Encore)') || '');
      } else if ('taunt' in volatiles && m.kind !== 'attack') {
        why = 'Taunted';
      } else if (currentItem(myActive) === 'assaultvest' && m.kind !== 'attack') {
        why = 'Assault Vest blocks status moves';
      } else if ('encore' in volatiles) {
        why = 'Encored';
      }

      return { ...m, disabled: why };
    });

    if (usable.length === 1) {
      input.lockedMove = usable[0].move;
      input.lockedSource = lockSource || ('encore' in volatiles ? 'Encore' : 'the move lock');
    }

    input.trapped = !!requestActive.trapped;

    if (requestActive.maybeTrapped && !requestActive.trapped) {
      insights.push(`${nameOf(myActive)} might be trapped (Shadow Tag / Arena Trap / Magnet Pull on their side).`);
    }
  } else if (!forcedSwitch) {
    const lockSource = ChoiceItems[currentItem(myActive)]
      || (currentAbility(myActive) === 'gorillatactics' ? 'Gorilla Tactics' : null);

    const lastMove = formatId(myActive.lastMove);
    const lockedName = lockSource && lastMove && lastMove !== 'switchin'
      ? (myActive.moves || []).find((m) => formatId(m) === lastMove)
      : null;

    if (lockedName) {
      input.lockedMove = input.myMoves.find((m) => formatId(m.name) === lastMove)?.name || lockedName;
      input.lockedSource = lockSource;
    }
  }

  // --- committing to a move: Choice items & rampage moves lock you in, so check who walls it ---

  if (!forcedSwitch && !input.lockedMove) {
    const choiceSource = ChoiceItems[currentItem(myActive)]
      || (currentAbility(myActive) === 'gorillatactics' ? 'Gorilla Tactics' : null);

    const benchFoes = foes.filter(({ index }) => index !== oppIndex);

    input.myMoves = input.myMoves.map((m) => {
      const rampage = RampageMoveIds.includes(formatId(m.name));

      if (m.kind !== 'attack' || (!choiceSource && !rampage) || !benchFoes.length) {
        return m;
      }

      const walledBy = benchFoes
        .filter(({ pokemon, index }) => {
          const vsFoe = myMovesVsFoe[myIndex]?.[index]?.find((x) => x.name === m.name);
          const maxHp = calcPokemonMaxHp(pokemon) || 1;

          return !!vsFoe && Math.max(0, ...vsFoe.rolls) < maxHp * 0.2;
        })
        .map(({ pokemon }) => nameOf(pokemon));

      const lockLabel = rampage ? 'locks you in for 2-3 turns, then confusion' : `${choiceSource} locks you in`;

      if (!walledBy.length) {
        return { ...m, adjustReasons: [...(m.adjustReasons || []), lockLabel] };
      }

      return {
        ...m,
        adjust: (m.adjust || 0) - Math.min(18, 6 * walledBy.length),
        adjustReasons: [
          ...(m.adjustReasons || []),
          `${lockLabel}; ${walledBy.slice(0, 2).join(' & ')} ${walledBy.length > 1 ? 'wall' : 'walls'} it`,
        ],
      };
    });
  }

  // --- predictions: will they switch (and to what), will they Tera, should you? ---

  if (!forcedSwitch) {
    const usableMoves = input.myMoves.filter((m) => !m.disabled);
    const myBest = pickThreat(usableMoves, opponent);
    const theirBest = pickThreat(input.opponentMoves, input.me);
    const now = simulateExchange(input.me, myBest, opponent, theirBest);
    const theirDamage = theirBest
      ? (theirBest.accuracy * meanDamage(effectiveRolls(theirBest, input.me), input.me.hp)) / Math.max(1, input.me.hp)
      : 0;

    // their switch-in: whoever takes your best move best & hits you back hardest
    const benchFoes = foes.filter(({ index }) => index !== oppIndex);
    const unseen = Math.max(0, (opp.maxPokemon || 6) - (opp.pokemon || []).filter((p) => p?.speciesForme).length);
    const ragingLocked = oppLockedMove && RampageMoveIds.includes(formatId(oppLockedMove)) && !oppChoice;

    const candidates = benchFoes
      .map(({ pokemon, index }) => {
        const target = toMon(pokemon, myActive, opp, me);
        const hazards = calcEntryDamage(format, gen, pokemon, opp, state);

        target.hp = Math.max(1, target.hp - hazards);

        const myVsIt = myMovesVsFoe[myIndex]?.[index] || [];
        const bestVsIt = myBest ? myVsIt.find((m) => m.name === myBest.name) : null;
        const taken = bestVsIt
          ? (bestVsIt.accuracy * meanDamage(effectiveRolls(bestVsIt, target), target.hp)) / Math.max(1, target.maxHp)
          : 0;

        const itsMoves = foeMovesVsMine[index]?.[myIndex] || [];
        const itsBest = pickThreat(itsMoves, input.me);
        const itsDamage = itsBest
          ? (itsBest.accuracy * meanDamage(effectiveRolls(itsBest, input.me), input.me.hp)) / Math.max(1, input.me.hp)
          : 0;

        const rollsVsIt = bestVsIt ? effectiveRolls(bestVsIt, target) : [];
        const faints = !!rollsVsIt.length && target.hp <= Math.min(...rollsVsIt);

        return {
          pokemon,
          index,
          target,
          myVsIt,
          taken,
          itsBest,
          score: faints ? -200 : ((-100 * Math.min(1, taken)) + (40 * itsDamage) - (30 * (hazards / Math.max(1, target.maxHp)))),
        };
      })
      .sort((a, b) => b.score - a.score);

    const pick = candidates[0];

    let switchChance = 0.08
      + (0.45 * now.aKOs)
      + (0.25 * now.dealt * (1 - now.aKOs))
      + (theirDamage < 0.25 ? 0.2 : 0)
      - (0.45 * now.bKOs);

    if (calcPokemonHpPercentage(oppActive) < 0.3) {
      switchChance *= 0.4; // low HP: usually stays in to get something off, or gets sacked
    }

    if (oppLockedMove && theirDamage < 0.25) {
      switchChance += 0.2; // locked into something that isn't doing much
    }

    if (ragingLocked || !pick || pick.score <= -200) {
      switchChance = 0;
    }

    switchChance = Math.max(0, Math.min(0.8, switchChance));

    if (switchChance >= 0.1 && pick) {
      const reasons: string[] = [];

      if (now.aKOs > 0.5) {
        reasons.push(`your ${myBest?.name} threatens a KO`);
      } else if (theirDamage < 0.25) {
        reasons.push(`${nameOf(oppActive)} can't hurt you much`);
      }

      reasons.push(pick.taken < 0.01
        ? `${pick.target.name} is immune to ${myBest?.name}`
        : `${pick.target.name} takes ~${Math.round(pick.taken * 100)}% from ${myBest?.name}`);

      if (pick.itsBest) {
        reasons.push(`and threatens you with ${pick.itsBest.name}`);
      }

      input.opponentSwitch = {
        chance: switchChance,
        target: pick.target,
        myMovesVsTarget: pick.myVsIt,
        reasons,
      };

      if (unseen > 0 && pick.taken > 0.5) {
        insights.push(`They might switch to something you haven't seen: none of their revealed Pokémon takes ${myBest?.name} well.`);
      }

      // double switch: one of yours beats what they're bringing in
      if (switchChance >= 0.4) {
        const counter = mine.find(({ index }) => index !== myIndex && duels[index]?.[pick.index]?.outcome === 'win');

        if (counter) {
          insights.push(`If they go to ${pick.target.name}, your ${nameOf(counter.pokemon)} beats it (double-switch option).`);
        }
      }
    }

    const isGen9 = gen === 9 && !format.includes('champions');

    // their Tera: the type that best flips the matchup for them
    if (isGen9 && !opp.usedTera && !oppActive.terastallized) {
      const teraTypes = [
        ...new Set([
          oppActive.dirtyTeraType || oppActive.teraType,
          ...flattenAlts(oppActive.altTeraTypes || []),
        ].filter((t) => !!t && t !== '???')),
      ].slice(0, 3) as string[];

      const options = teraTypes
        .map((type) => {
          const teraState = teraVariant(state, oppKey, oppIndex, type);

          if (!teraState) {
            return null;
          }

          const teraOpp = teraState[oppKey].pokemon[oppIndex];
          const teraMon: AdvisorMon = { ...toMon(teraOpp, myActive, opp, me), speed: opponent.speed };
          const myVsTera = movesFor(myActive, myKey, myIndex, oppKey, oppIndex, movesOf(myActive), false, teraState)
            .map((m) => ({ ...m, disabled: input.myMoves.find((x) => x.name === m.name)?.disabled }));
          const theirsVsMe = movesFor(teraOpp, oppKey, oppIndex, myKey, myIndex, oppMoveNames, true, teraState);

          const after = simulateExchange(
            input.me,
            pickThreat(myVsTera.filter((m) => !m.disabled), teraMon),
            teraMon,
            pickThreat(theirsVsMe, input.me),
          );

          const defense = Math.max(0, now.aKOs - after.aKOs) + (0.5 * Math.max(0, now.dealt - after.dealt));
          const offense = Math.max(0, after.bKOs - now.bKOs);

          return {
            type,
            teraMon,
            myVsTera,
            theirsVsMe,
            defense,
            offense,
            gain: defense + offense,
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.gain - a.gain);

      const best = options[0];

      if (best && best.gain > 0.15) {
        const reasons: string[] = [];

        if (best.defense > 0.3) {
          reasons.push(`it would survive your ${myBest?.name}`);
        }

        if (best.offense > 0.3) {
          reasons.push('it would KO you');
        }

        input.opponentTera = {
          chance: Math.min(0.7, 0.1 + (0.6 * best.gain)),
          type: best.type,
          opponent: best.teraMon,
          myMovesVsTera: best.myVsTera,
          opponentMovesVsMe: best.theirsVsMe,
          reasons,
        };

        insights.push(`They might Tera ${best.type}${reasons.length ? `: ${reasons.join(' and ')}` : ''}.`);
      }
    }

    // your Tera: the request says when you can (& into what); otherwise go by the team & usedTera
    const myTeraType = requestActive?.canTerastallize
      || (isGen9 && !me.usedTera && !myActive.terastallized ? (myActive.dirtyTeraType || myActive.teraType) : null);

    if (myTeraType && (!requestActive || requestActive.canTerastallize)) {
      const teraState = teraVariant(state, myKey, myIndex, myTeraType);

      if (teraState) {
        const teraMe = teraState[myKey].pokemon[myIndex];
        const teraMon: AdvisorMon = { ...toMon(teraMe, oppActive, me, opp), speed: input.me.speed };

        // Tera is once a battle: cheaper on your win condition, pricier when it should be saved for it
        const winIndex = plan.winCondition?.index;
        const saveForWincon = typeof winIndex === 'number' && winIndex !== myIndex;

        input.myTera = {
          type: myTeraType,
          me: teraMon,
          myMoves: movesFor(teraMe, myKey, myIndex, oppKey, oppIndex, movesOf(myActive), false, teraState),
          opponentMovesVsMe: movesFor(oppActive, oppKey, oppIndex, myKey, myIndex, oppMoveNames, true, teraState),
          cost: (saveForWincon && 30) || (role === 'wincon' && 8) || 15,
          costReason: saveForWincon ? `uses the Tera you might want for ${plan.winCondition.name}` : null,
          context: {
            unseen,
            lead: mine.length - (foes.length + unseen),
            key: role === 'wincon' || role === 'answer',
          },
        };
      }
    }
  }

  // --- what your active gets for leaving ---

  if (!forcedSwitch) {
    const missing = 1 - (input.me.hp / Math.max(1, input.me.maxHp));
    const activeAbility = currentAbility(myActive);

    input.switchOutBonus = 0;
    input.switchOutReasons = [];

    if (activeAbility === 'regenerator' && missing > 0.05) {
      input.switchOutBonus += 40 * Math.min(1 / 3, missing);
      input.switchOutReasons.push(
        `Regenerator heals ${input.me.name} ${Math.round(Math.min(1 / 3, missing) * 100)}% if you switch.`,
      );
    }

    if (activeAbility === 'naturalcure' && input.me.status) {
      input.switchOutBonus += 8;
      input.switchOutReasons.push(`Natural Cure clears ${input.me.name}'s status if you switch.`);
    }

    // status & conditions that switching gets rid of (or that make staying in costly)
    const volatiles = (myActive.volatiles || {}) as Record<string, unknown>;
    const name = input.me.name;

    if (input.me.status === 'tox' && !['poisonheal', 'magicguard'].includes(activeAbility)) {
      const turns = Math.max(1, myActive.toxicCounter || 1);

      input.switchOutBonus += Math.min(25, 4 * turns);
      input.switchOutReasons.push(`Toxic is doing ${turns}/16 a turn to ${name}; switching resets it.`);
    }

    if ('yawn' in volatiles && !input.me.status) {
      input.switchOutBonus += 20;
      input.switchOutReasons.push(`Yawn puts ${name} to sleep at the end of next turn unless it switches.`);
    }

    if ('perish1' in volatiles) {
      input.switchOutBonus += 300;
      insights.unshift(`Perish Song KOs ${name} at the end of this turn. Switch!`);
    } else if ('perish2' in volatiles) {
      input.switchOutBonus += 15;
      input.switchOutReasons.push(`Perish Song KOs ${name} at the end of next turn.`);
    }

    if ('leechseed' in volatiles && activeAbility !== 'magicguard') {
      input.switchOutBonus += 8;
      input.switchOutReasons.push(`Switching removes Leech Seed from ${name}.`);
    }

    if ('curse' in volatiles && activeAbility !== 'magicguard') {
      input.switchOutBonus += 20;
      input.switchOutReasons.push(`Curse drains 25% a turn from ${name}; switching ends it.`);
    }

    if ('saltcure' in volatiles && activeAbility !== 'magicguard') {
      input.switchOutBonus += 12;
      input.switchOutReasons.push(`Salt Cure keeps chipping ${name}; switching ends it.`);
    }

    if ('confusion' in volatiles) {
      input.switchOutBonus += 8;
      input.switchOutReasons.push(`Switching cures ${name}'s confusion.`);
    }
  }

  // hazard removal is worth however much hazard damage it saves your team
  const RemovalMoveIds = ['rapidspin', 'defog', 'mortalspin', 'tidyup', 'courtchange'];
  const mySideConditions = Object.keys(me?.side?.conditions || {}).map(formatId);
  const myHazardsUp = !!me?.side?.isSR
    || (me?.side?.spikes || 0) > 0
    || mySideConditions.some((c) => ['toxicspikes', 'stickyweb'].includes(c));

  if (!forcedSwitch && myHazardsUp) {
    const bench = me.pokemon.filter((p, i) => i !== myIndex && alive(p));
    const saved = bench.reduce((sum, p) => (
      sum + (calcEntryDamage(format, gen, p, me, state) / Math.max(1, calcPokemonMaxHp(p)))
    ), 0) + (mySideConditions.includes('stickyweb') ? 0.15 : 0) + (mySideConditions.includes('toxicspikes') ? 0.15 : 0);

    input.myMoves = input.myMoves.map((m) => {
      const id = formatId(m.name);

      if (!RemovalMoveIds.includes(id) || m.disabled) {
        return m;
      }

      // Rapid Spin & Mortal Spin don't clear anything if they don't connect (e.g., into a Ghost)
      if (m.kind === 'attack' && m.rolls.length && Math.max(...m.rolls) <= 0) {
        return { ...m, adjustReasons: [...(m.adjustReasons || []), "can't clear hazards: it doesn't connect"] };
      }

      const theirHazards = input.opponentHazards?.length && id === 'defog';
      const bonus = Math.min(50, 60 * saved) - (theirHazards ? 10 : 0);

      return {
        ...m,
        adjust: (m.adjust || 0) + bonus,
        adjustReasons: [
          ...(m.adjustReasons || []),
          `clears hazards worth ~${Math.round(saved * 100)}% HP across your team`
            + (theirHazards ? ', but also clears yours on their side' : ''),
        ],
      };
    });
  }

  // --- sacking context: has the active done its job? who'd a Healing Wish be for? who's the ace? ---

  if (!forcedSwitch) {
    const hazardIds = input.myMoves.filter((m) => m.kind === 'hazard').map((m) => m.hazard || formatId(m.name));
    const otherJobs = input.myMoves.some((m) => (
      m.kind === 'setup' || m.kind === 'recovery' || m.pivot || (m.kind === 'status' && !!m.status)
    ));

    if (hazardIds.length && hazardIds.every((h) => input.opponentHazards?.includes(h)) && !otherJobs) {
      input.activeJobDone = 'its hazards are already up';
    }

    const hurt = mine
      .filter(({ index, pokemon }) => index !== myIndex && calcPokemonHpPercentage(pokemon) < 0.6)
      .sort((a, b) => (
        (Number(plan.roles[b.index] === 'wincon') - Number(plan.roles[a.index] === 'wincon'))
          || (calcPokemonHpPercentage(a.pokemon) - calcPokemonHpPercentage(b.pokemon))
      ))[0];

    if (hurt) {
      input.benchNeedsHealing = nameOf(hurt.pokemon);
    }

    input.aceIndex = plan.winCondition?.index;
  }

  // --- pro tips (Smogon's Random Battles guides) ---

  const teamSizeOf = (player: CalcdexPlayer) => Math.max(player?.maxPokemon || 6, (player?.pokemon || []).length, 1);
  const theirUnseen = Math.max(0, teamSizeOf(opp) - (opp.pokemon || []).filter((p) => p?.speciesForme).length);

  const earlyTally = {
    myLeft: mine.length,
    myHp: mine.reduce((sum, { pokemon }) => sum + calcPokemonHpPercentage(pokemon), 0) / teamSizeOf(me),
    theirLeft: foes.length + theirUnseen,
    theirHp: (foes.reduce((sum, { pokemon }) => sum + calcPokemonHpPercentage(pokemon), 0) + theirUnseen) / teamSizeOf(opp),
  };

  // behind -> take risks for KOs; ahead -> play safe
  input.riskMode = (
    (earlyTally.myLeft < earlyTally.theirLeft || (earlyTally.myLeft === earlyTally.theirLeft && earlyTally.myHp < earlyTally.theirHp - 0.15))
      && 'behind'
  ) || (
    (earlyTally.myLeft > earlyTally.theirLeft || (earlyTally.myLeft === earlyTally.theirLeft && earlyTally.myHp > earlyTally.theirHp + 0.15))
      && 'ahead'
  ) || 'even';

  const isSetupMove = (name: string) => {
    const id = formatId(name);
    const raw = getRawMove(id);

    return SetupMoveIds.includes(id)
      || (raw?.target === 'self' && !!raw?.boosts && Object.values(raw.boosts).some((v) => v > 0));
  };

  const oppBoosts = (oppActive.dirtyBoosts || oppActive.boosts || {}) as Record<string, number>;
  const oppBoosted = ['atk', 'spa', 'spe'].reduce((sum, stat) => sum + Math.max(0, oppBoosts[stat] || 0), 0);
  const oppSetupThreat = oppMoveNames.some(isSetupMove);
  const oppJustSetUp = !!oppLast && isSetupMove(oppLast);

  const threatVsMe = !forcedSwitch ? pickThreat(input.opponentMoves, input.me) : null;
  const threatFraction = threatVsMe
    ? (threatVsMe.accuracy * meanDamage(effectiveRolls(threatVsMe, input.me), input.me.hp)) / Math.max(1, input.me.maxHp)
    : 0;

  const PhazeMoveIds = ['roar', 'whirlwind', 'dragontail', 'circlethrow', 'haze', 'clearsmog'];

  const myBoostsNow = (myActive?.dirtyBoosts || myActive?.boosts || {}) as Record<string, number>;
  const myBoostPeak = Math.max(0, myBoostsNow.atk || 0, myBoostsNow.spa || 0);
  const oppConditions = (opp?.side?.conditions || {}) as Record<string, unknown[]>;
  const oppTSpikes = Number(oppConditions.toxicspikes?.[1]) || 0;
  const oppSpikes = opp?.side?.spikes || 0;
  const oppBoots = foes.filter(({ pokemon }) => formatId(pokemon.item) === 'heavydutyboots').length;
  const oppHasRecovery = oppMoveNames.some((m) => {
    const id = formatId(m);

    return RecoveryMoveIds.includes(id) || !!dex?.moves.get(m)?.heal;
  });

  if (!forcedSwitch) {
    input.myMoves = input.myMoves.map((m) => {
      if (m.disabled) {
        return m;
      }

      const id = formatId(m.name);
      let adjust = 0;
      const why: string[] = [];

      // stop a setup sweeper: force out / erase boosts once they're up, Encore the setup turn, else Taunt or status
      if (oppBoosted > 0) {
        if (PhazeMoveIds.includes(id)) {
          adjust += 35;
          why.push(`wipes ${opponent.name}'s +${oppBoosted} boosts`);
        }

        if (id === 'encore' && oppJustSetUp) {
          adjust += 40;
          why.push(`locks ${opponent.name} into ${oppLast}`);
        }
      } else if (oppSetupThreat) {
        if (id === 'taunt') {
          adjust += 20;
          why.push(`stops ${opponent.name} setting up`);
        }

        if (m.kind === 'status' && m.status) {
          adjust += 10;
          why.push('cripples a setup threat');
        }
      }

      // don't set up until you've seen most of their team (unless they can't touch you)
      if (m.kind === 'setup' && theirUnseen >= 2 && threatFraction > 0.25) {
        adjust -= theirUnseen >= 3 ? 12 : 5;
        why.push(`${theirUnseen} of theirs still unrevealed; set up later`);
      }

      // don't over-boost: +2 is usually enough, more just invites crits, phazing & Haze
      if (m.kind === 'setup' && myBoostPeak >= 2) {
        adjust -= 25;
        why.push(`already +${myBoostPeak}: attack now`);
      }

      // hazard layering
      if (m.kind === 'hazard') {
        if (id === 'toxicspikes') {
          const absorber = foes.find(({ pokemon }) => (
            (pokemon.dirtyTypes?.length ? pokemon.dirtyTypes : pokemon.types || []).includes('Poison' as Showdown.TypeName)
              && detectGroundedness(pokemon, field) !== false
          ));

          if (absorber) {
            adjust -= 40;
            why.push(`their ${nameOf(absorber.pokemon)} absorbs Toxic Spikes`);
          } else if (oppTSpikes >= 2) {
            adjust -= 45;
            why.push('Toxic Spikes are already maxed');
          } else if (oppTSpikes === 1) {
            adjust -= 10;
            why.push('a second layer only matters vs bulky teams');
          }
        }

        if (id === 'spikes') {
          if (oppSpikes >= 3) {
            adjust -= 45;
            why.push('Spikes are already maxed');
          } else if (opp?.side?.isSR && oppSpikes >= 1) {
            adjust -= 8;
            why.push('Rocks + 1 layer of Spikes is usually enough');
          } else {
            adjust += 6;
            why.push('Spikes hit hard with no team preview');
          }
        }

        if (id === 'stealthrock' && oppBoots >= Math.max(2, Math.ceil(foes.length / 2))) {
          adjust -= 10;
          why.push(`${oppBoots} of theirs wear Heavy-Duty Boots`);
        }
      }

      // Toxic wears down bulky Pokemon that would otherwise outlast you
      if (m.kind === 'status' && m.status === 'tox' && oppHasRecovery) {
        adjust += 10;
        why.push('wears down a bulky Pokémon with recovery');
      }

      // pivot early to scout their team
      if (m.pivot && m.kind === 'attack' && theirUnseen >= 3) {
        adjust += 8;
        why.push('scouts their switch-in');
      }

      return adjust || why.length
        ? { ...m, adjust: (m.adjust || 0) + adjust, adjustReasons: [...(m.adjustReasons || []), ...why] }
        : m;
    });
  }

  // --- moves that just won't work on their active: immunities, Magic Bounce, Good as Gold, Unaware, etc. ---

  if (!forcedSwitch) {
    const targetTypes = (
      oppActive.terastallized && (oppActive.dirtyTeraType || oppActive.teraType)
        ? [oppActive.dirtyTeraType || oppActive.teraType]
        : (oppActive.dirtyTypes?.length ? oppActive.dirtyTypes : oppActive.types) || []
    ) as string[];

    const targetAbility = currentAbility(oppActive);
    const targetItem = currentItem(oppActive);
    const targetVolatiles = (oppActive.volatiles || {}) as Record<string, unknown>;
    const grounded = detectGroundedness(oppActive, field) !== false;
    const terrainId = formatId(terrain);
    const myAbility = currentAbility(myActive);
    const oppName = nameOf(oppActive);

    const blockedReason = (m: AdvisorMove): string => {
      const dexMove = dex?.moves.get(m.name);
      const id = formatId(m.name);
      const targetsThem = !['self', 'allySide', 'allyTeam', 'adjacentAllyOrSelf'].includes(String(dexMove?.target || 'normal'));

      if (FirstTurnMoveIds.includes(id) && myUsed.length) {
        return 'only works on its first turn out';
      }

      if (m.kind === 'attack' || !targetsThem) {
        return null;
      }

      if (targetAbility === 'magicbounce' && (dexMove?.flags as Record<string, unknown>)?.reflectable) {
        return `${oppName}'s Magic Bounce sends it back at you`;
      }

      if (m.kind === 'hazard') {
        return null;
      }

      if (targetAbility === 'goodasgold') {
        return `${oppName}'s Good as Gold blocks status moves`;
      }

      if ('substitute' in targetVolatiles) {
        return `${oppName}'s Substitute blocks it`;
      }

      if (m.kind !== 'status' || !m.status) {
        return null;
      }

      const st = m.status;

      if (targetAbility === 'purifyingsalt' || targetAbility === 'comatose') {
        return `${oppName} can't be statused`;
      }

      if (terrainId === 'misty' && grounded) {
        return 'Misty Terrain blocks status';
      }

      if (dexMove?.flags?.powder && (targetTypes.includes('Grass') || targetAbility === 'overcoat' || targetItem === 'safetygoggles')) {
        return `${oppName} is immune to powder moves`;
      }

      if (st === 'slp' && (['insomnia', 'vitalspirit', 'sweetveil'].includes(targetAbility) || (terrainId === 'electric' && grounded))) {
        return `${oppName} can't fall asleep`;
      }

      if (st === 'par' && (targetTypes.includes('Electric') || targetAbility === 'limber'
        || (dexMove?.type === 'Electric' && targetTypes.includes('Ground')))) {
        return `${oppName} can't be paralyzed by it`;
      }

      if (st === 'brn' && (targetTypes.includes('Fire') || ['waterveil', 'waterbubble', 'thermalexchange'].includes(targetAbility))) {
        return `${oppName} can't be burned`;
      }

      if ((st === 'tox' || st === 'psn') && myAbility !== 'corrosion'
        && (targetTypes.includes('Poison') || targetTypes.includes('Steel') || ['immunity', 'pastelveil'].includes(targetAbility))) {
        return `${oppName} can't be poisoned`;
      }

      return null;
    };

    input.myMoves = input.myMoves.map((m) => {
      if (m.disabled) {
        return m;
      }

      const blocked = blockedReason(m);

      if (blocked) {
        return { ...m, disabled: blocked };
      }

      if (m.kind === 'setup' && targetAbility === 'unaware') {
        return {
          ...m,
          adjust: (m.adjust || 0) - 30,
          adjustReasons: [...(m.adjustReasons || []), `${oppName}'s Unaware ignores your boosts`],
        };
      }

      return m;
    });
  }

  // Sleep Clause: only one of theirs can be put to sleep at a time
  if (!forcedSwitch && (opp.pokemon || []).some((p) => alive(p) && currentStatus(p) === 'slp' && p !== oppActive)) {
    input.myMoves = input.myMoves.map((m) => (
      m.kind === 'status' && m.status === 'slp' && !m.disabled
        ? { ...m, disabled: 'Sleep Clause: one of theirs is already asleep' }
        : m
    ));
  }

  // --- switch-ins ---

  const oppAbility = currentAbility(oppActive);

  input.switches = me.pokemon
    .map((pokemon, index): AdvisorSwitchOption => {
      if (index === myIndex || !alive(pokemon)) {
        return null;
      }

      const option: AdvisorSwitchOption = {
        index,
        mon: toMon(pokemon, oppActive, me, opp),
        entryDamage: calcEntryDamage(format, gen, pokemon, me, state),
        movesVsOpponent: movesFor(pokemon, myKey, index, oppKey, oppIndex, movesOf(pokemon)),
        opponentMovesVsIt: movesFor(oppActive, oppKey, oppIndex, myKey, index, oppMoveNames, true),
        bonus: 0,
        bonusReasons: [],
      };

      // Intimidate goes off before their move lands, so it softens the hit you switch into
      if (currentAbility(pokemon) === 'intimidate' && !IntimidateImmuneAbilities.includes(oppAbility)) {
        if (IntimidatePunishAbilities[oppAbility]) {
          option.bonus -= 15;
          option.bonusReasons.push(`Intimidate triggers their ${IntimidatePunishAbilities[oppAbility]}`);
        } else if (opponent.physical) {
          option.opponentMovesVsIt = option.opponentMovesVsIt.map((m) => (
            dex?.moves.get(m.name)?.category === 'Physical'
              ? { ...m, rolls: m.rolls.map((r) => Math.floor(r * (2 / 3))) }
              : m
          ));

          option.bonusReasons.push('Intimidate weakens their physical hits');
        }
      }

      // keep your win condition hidden while they still have lots to show (unless it wins right now)
      const revealedMine = log.seenNames[myKey] || [];

      const closingOut = input.riskMode === 'ahead' && earlyTally.theirLeft <= 2;

      if (plan.roles[index] === 'wincon' && theirUnseen >= 2 && !closingOut && !revealedMine.includes(nameOf(pokemon))) {
        option.bonus -= 12;
        option.bonusReasons.push('reveals your win condition early');
      }

      // keep your only answer to a threat healthy
      const answersFor = plan.threats.filter((t) => t.answers.length === 1 && t.answers[0] === nameOf(pokemon));

      if (answersFor.length && threatVsMe && !forcedSwitch) {
        const incoming = option.opponentMovesVsIt.find((m) => m.name === threatVsMe.name);
        const fraction = incoming
          ? (incoming.accuracy * meanDamage(incoming.rolls, option.mon.hp)) / Math.max(1, option.mon.maxHp)
          : 0;

        if (fraction > 0.4) {
          option.bonus -= 12;
          option.bonusReasons.push(`your only answer to ${answersFor[0].name}; don't wear it down`);
        }
      }

      return option;
    })
    .filter(Boolean);

  // speed check between the actives, w/ the why
  let speed: BattleAdviceBundle['speed'];

  if (!forcedSwitch) {
    const itemRevealed = !!oppActive.item;
    const guessedScarf = oppScarf && !itemRevealed && !oppScarfInferred && ChoiceItems[currentItem(oppActive)] === 'Choice Scarf';

    speed = {
      mine: input.me.speed,
      theirs: opponent.speed,
      first: firstMoveProbability(0, input.me.speed, 0, opponent.speed),
      note: (oppScarfInferred && 'inferred Choice Scarf')
        || (guessedScarf && 'includes a guessed Choice Scarf')
        || (oppSpeedFactor !== 1 && 'adjusted from turn order')
        || null,
      ifScarfed: !oppScarf && !itemRevealed && opponent.speed < input.me.speed && Math.floor(opponent.speed * 1.5) > input.me.speed
        ? Math.floor(opponent.speed * 1.5)
        : null,
    };
  }

  // who's ahead: Pokemon left & HP, w/ their unrevealed Pokemon counted at full HP
  const tally: BattleAdviceBundle['tally'] = {
    mine: { left: earlyTally.myLeft, hp: earlyTally.myHp },
    theirs: { left: earlyTally.theirLeft, hp: earlyTally.theirHp },
  };

  // how to play your team
  const RemovalIds = ['rapidspin', 'defog', 'mortalspin', 'tidyup', 'courtchange'];
  const seenMine = log.seenNames[myKey] || [];

  const guideMons: TeamGuideMon[] = mine.map(({ pokemon, index }) => {
    const moves = (pokemon.moves || [])
      .filter(Boolean)
      .map((name) => toAdvisorMove(format, name, null, pokemon, oppActive, terrain))
      .filter(Boolean);

    return {
      index,
      name: nameOf(pokemon),
      hpFraction: calcPokemonHpPercentage(pokemon),
      speed: speedOf(pokemon, oppActive, me, opp),
      revealed: index === myIndex || seenMine.includes(nameOf(pokemon)),
      setupMoves: moves.filter((m) => m.kind === 'setup').map((m) => m.name),
      priorityMoves: moves.filter((m) => m.kind === 'attack' && m.priority > 0).map((m) => m.name),
      pivotMoves: moves.filter((m) => m.pivot).map((m) => m.name),
      hazardMoves: moves.filter((m) => m.kind === 'hazard').map((m) => m.name),
      removalMoves: moves.filter((m) => RemovalIds.includes(formatId(m.name))).map((m) => m.name),
      recoveryMoves: moves.filter((m) => m.kind === 'recovery').map((m) => m.name),
      statusMoves: moves.filter((m) => m.kind === 'status').map((m) => m.name),
    };
  });

  const guide = scoreTeamGuide({
    mine: guideMons,
    theirs: foes.map(({ pokemon, index }) => ({ index, name: nameOf(pokemon), hpFraction: calcPokemonHpPercentage(pokemon) })),
    duels,
    plan,
    seen: (opp.pokemon || []).filter((p) => p?.speciesForme).length,
    teamSize: teamSizeOf(opp),
    riskMode: input.riskMode,
  });

  return {
    advice: scoreBattleAdvice(input),
    plan,
    insights,
    speed,
    tally,
    guide,
  };
};
