/**
 * Minimal shape of a dex effect (move, ability, item) that can carry a description.
 *
 * @since 1.4.3
 */
export interface DexDescribableEffect {
  id?: string;
  name?: string;
  exists?: boolean;
  effectType?: string;
  desc?: string;
  shortDesc?: string;
}

/**
 * Returns the `{ desc, shortDesc }` for the passed-in dex `effect`.
 *
 * * As of Showdown client commit `fccc266` (Sep 2026), `desc` & `shortDesc` are no longer baked into
 *   `BattleMovedex`, `BattleItems` & `BattleAbilities`; they now live in `BattleText` and are read through
 *   `dex.text.get(effect)`, which also resolves gen- & mod-specific text (e.g., Gen 4 Pursuit).
 * * Tries the new `dex.text.get()` first, then falls back to the old fields on the `effect` itself,
 *   so this keeps working on older clients (or if `BattleText` hasn't loaded yet).
 * * Never throws; `dex.text.get()` reads the global `BattleText`, which may be `undefined`.
 *
 * @since 1.4.3
 */
export const getDexDescription = (
  dex: Showdown.ModdedDex,
  effect: DexDescribableEffect,
): { desc: string; shortDesc: string; } => {
  const output = { desc: '', shortDesc: '' };

  if (!effect?.name && !effect?.id) {
    return output;
  }

  // prefer the dex the caller resolved (gen/mod-aware), falling back to the global Dex
  const textApi = dex?.text || (typeof Dex === 'undefined' ? null : Dex.text);

  if (typeof textApi?.get === 'function' && effect.effectType) {
    try {
      const entry = textApi.get(effect);

      output.desc = typeof entry?.desc === 'string' ? entry.desc : '';
      output.shortDesc = typeof entry?.shortDesc === 'string' ? entry.shortDesc : '';
    } catch {
      // BattleText probably isn't loaded; fall through to the legacy fields below
    }
  }

  // legacy fallback (pre-Sep 2026 clients baked these into the dex data directly)
  output.desc ||= effect.desc || effect.shortDesc || '';
  output.shortDesc ||= effect.shortDesc || effect.desc || '';

  return output;
};
