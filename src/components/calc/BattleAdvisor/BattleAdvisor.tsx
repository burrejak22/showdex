import * as React from 'react';
import cx from 'classnames';
import { useColorScheme, useShowdexSettings } from '@showdex/redux/store';
import {
  type AdvisorChoice,
  type BattleAdviceBundle,
  buildBattleAdvice,
  getLiveBattle,
} from '@showdex/utils/advisor';
import { logger } from '@showdex/utils/debug';
import { CalcdexPokeContext } from '../CalcdexPokeContext';
import styles from './BattleAdvisor.module.scss';

export interface BattleAdvisorProps {
  className?: string;
  style?: React.CSSProperties;
}

const l = logger('@showdex/components/calc/BattleAdvisor');

const pct = (value: number): string => `${Math.round(Math.max(0, value || 0) * 100)}%`;

const choiceLabel = (choice: AdvisorChoice): string => {
  if (choice.type === 'switch') {
    return `Switch to ${choice.name}`;
  }

  return choice.tera ? `Tera ${choice.tera} + ${choice.name}` : choice.name;
};

/**
 * Suggests the best move or switch for the logged-in player's active Pokemon, plus a game plan for the battle.
 *
 * * Only renders on your own side of the Calcdex in singles battles.
 * * Built on the same calcs the Calcdex already runs; see `scoreBattleAdvice()` & `scoreGamePlan()`.
 *
 * @since 1.4.3
 */
export const BattleAdvisor = ({
  className,
  style,
}: BattleAdvisorProps): React.JSX.Element => {
  const colorScheme = useColorScheme();
  const fullSettings = useShowdexSettings();
  const { state, playerKey } = React.useContext(CalcdexPokeContext);
  const [expanded, setExpanded] = React.useState(false);

  const enabled = fullSettings?.calcdex?.showBattleAdvisor !== false
    && state?.operatingMode === 'battle'
    && !!state?.authPlayerKey
    && playerKey === state.authPlayerKey;

  // the live battle (move request & log) changes on its own schedule, so key the memo on what we read from it
  const live = enabled ? getLiveBattle(state?.battleId) : null;
  const liveKey = live ? `${live.request?.rqid ?? '-'}:${live.stepQueue.length}` : null;

  const [bundle, failure] = React.useMemo<[BattleAdviceBundle, string]>(() => {
    if (!enabled) {
      return [null, null];
    }

    try {
      return [buildBattleAdvice(state, fullSettings, live), null];
    } catch (error) {
      // never take the Calcdex down w/ us, but say so instead of silently disappearing
      const message = (error as Error)?.message || String(error);

      l.warn('Failed to build battle advice:', message);
      // eslint-disable-next-line no-console
      console.error('[Showdex Battle Advisor]', error);

      return [null, message];
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    fullSettings,
    liveKey,
    state,
  ]);

  if (failure) {
    return (
      <div
        className={cx(styles.container, !!colorScheme && styles[colorScheme], className)}
        style={style}
      >
        <div className={styles.header}>
          <span className={styles.label}>Advisor</span>
          <span className={styles.verdict}>Hit an error this turn</span>
        </div>

        <div className={styles.note}>{failure}</div>
      </div>
    );
  }

  if (!bundle || (!bundle.advice?.verdict && !bundle.insights.length && !bundle.plan?.ideas.length)) {
    return null;
  }

  const {
    advice,
    plan,
    insights,
    speed,
    tally,
    guide,
  } = bundle;
  const verdict = advice?.verdict;

  const {
    threat,
    moves = [],
    switches = [],
    locked,
    prediction,
    decisions,
    notes = [],
  } = advice || {};

  // always surface the best switch, even when attacking is the pick
  const bestSwitch = verdict?.type === 'switch' ? switches[1] : (verdict?.sackInto ? null : switches[0]);
  const [topIdea, ...moreIdeas] = plan?.ideas || [];

  return (
    <div
      className={cx(
        styles.container,
        !!colorScheme && styles[colorScheme],
        className,
      )}
      style={style}
    >
      <div className={styles.header}>
        <span className={styles.label}>Advisor</span>

        <span className={styles.verdict}>
          {!verdict && 'No choice to make this turn'}
          {verdict?.type === 'switch' && <>Switch to <strong>{verdict.name}</strong></>}
          {verdict?.type === 'move' && verdict.sack && (
            <>Sack: use <strong>{verdict.name}</strong>, then bring in <strong>{verdict.sackInto}</strong></>
          )}
          {verdict?.type === 'move' && !verdict.sack && !verdict.tera && <>Use <strong>{verdict.name}</strong></>}
          {verdict?.type === 'move' && !verdict.sack && !!verdict.tera && (
            <><strong>Tera {verdict.tera}</strong> + use <strong>{verdict.name}</strong></>
          )}
        </span>

        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? 'Less' : 'Why?'}
        </button>
      </div>

      {
        !!verdict?.reasons.length &&
        <div className={styles.reasons}>
          {verdict.reasons.slice(0, 3).join(' · ')}
        </div>
      }

      {
        !!decisions?.sack &&
        <div className={cx(styles.decision, decisions.sack.sack ? styles.yes : styles.no)}>
          <span className={styles.decisionLabel}>Sack?</span>
          {decisions.sack.text}
        </div>
      }

      {
        !!decisions?.tera &&
        <div className={cx(styles.decision, decisions.tera.use ? styles.yes : styles.no)}>
          <span className={styles.decisionLabel}>Tera?</span>
          {decisions.tera.text}
        </div>
      }

      {
        (prediction?.switchChance || 0) >= 0.3 && !!prediction.switchTo &&
        <div className={styles.insight}>
          Likely switch ({pct(prediction.switchChance)}) to <strong>{prediction.switchTo}</strong>
          {!!prediction.switchReasons?.length && `: ${prediction.switchReasons.join(', ')}`}
        </div>
      }

      {insights.slice(0, 2).map((insight) => (
        <div key={`BattleAdvisor:insight:${insight}`} className={styles.insight}>
          {insight}
        </div>
      ))}

      {
        !!locked && verdict?.type === 'move' &&
        <div className={styles.threat}>
          Locked into <strong>{locked}</strong>
        </div>
      }

      {
        !!bestSwitch &&
        <div className={styles.threat}>
          {verdict?.type === 'switch' ? 'Next best: ' : 'Best switch: '}
          <strong>{bestSwitch.name}</strong>
          {!!bestSwitch.reasons.length && ` · ${bestSwitch.reasons.slice(0, 2).join(' · ')}`}
        </div>
      }

      {
        !!threat &&
        <div className={styles.threat}>
          Watch out for <strong>{threat.name}</strong>
          {threat.koChance >= 0.995
            ? ' (KOs you)'
            : ` (up to ${pct(Math.min(threat.maxFraction, 1))} of your HP${threat.koChance > 0.01 ? `, ${pct(threat.koChance)} to KO` : ''})`}
          {threat.movesFirst >= 1 && ', moves first'}
          {threat.guessed && <span className={styles.muted}> · guessed</span>}
        </div>
      }

      {
        !!speed?.mine && !!speed?.theirs &&
        <div className={styles.threat}>
          Speed: you <strong>{speed.mine}</strong> vs them <strong>{speed.theirs}</strong>
          {(speed.first === 1 && ', you move first') || (speed.first === 0 && ', they move first') || ', speed tie'}
          {!!speed.note && <span className={styles.muted}> ({speed.note})</span>}
          {!!speed.ifScarfed && <span className={styles.muted}> · {speed.ifScarfed} if Scarfed</span>}
        </div>
      }

      {
        !!tally &&
        <div className={styles.threat}>
          Left: you <strong>{tally.mine.left}</strong> ({pct(tally.mine.hp)} HP)
          {' '}vs them <strong>{tally.theirs.left}</strong> ({pct(tally.theirs.hp)} HP)
          {(tally.mine.left > tally.theirs.left && ' · you\'re ahead')
            || (tally.mine.left < tally.theirs.left && ' · you\'re behind')
            || ''}
        </div>
      }

      {
        !!guide?.ace &&
        <div className={styles.plan}>
          <span className={styles.planLabel}>Ace</span>
          <strong>{guide.ace.name}</strong>
          {` (${guide.ace.why})`}
          {!!guide.ace.steps[0] && ` · ${guide.ace.steps[0]}`}
        </div>
      }

      {
        !!topIdea &&
        <div className={styles.plan}>
          <span className={styles.planLabel}>Plan</span>
          {topIdea}
        </div>
      }

      {
        expanded &&
        <div className={styles.details}>
          {
            !!moves.length &&
            <>
              <div className={styles.sectionTitle}>Moves</div>
              {moves.map((choice) => (
                <div
                  key={`BattleAdvisor:move:${choice.name}`}
                  className={cx(styles.row, choice === verdict && styles.best)}
                >
                  <span className={styles.rowName}>{choiceLabel(choice)}</span>
                  <span className={styles.rowReasons}>{choice.reasons.join(' · ')}</span>
                </div>
              ))}
            </>
          }

          {
            !!switches.length &&
            <>
              <div className={styles.sectionTitle}>Switches</div>
              {switches.slice(0, 5).map((choice) => (
                <div
                  key={`BattleAdvisor:switch:${choice.index}`}
                  className={cx(styles.row, choice === verdict && styles.best)}
                >
                  <span className={styles.rowName}>{choice.name}</span>
                  <span className={styles.rowReasons}>{choice.reasons.join(' · ')}</span>
                </div>
              ))}
            </>
          }

          {
            !!guide?.ace &&
            <>
              <div className={styles.sectionTitle}>How to play {guide.ace.name}</div>
              {guide.ace.steps.map((step) => (
                <div key={`BattleAdvisor:ace:${step}`} className={styles.idea}>
                  {step}
                </div>
              ))}
            </>
          }

          {
            !!guide?.roles?.length &&
            <>
              <div className={styles.sectionTitle}>Your team</div>
              {guide.roles.map((role) => (
                <div key={`BattleAdvisor:role:${role.index}`} className={styles.row}>
                  <span className={styles.rowName}>{role.name}</span>
                  <span className={styles.rowReasons}>
                    <strong>{role.role}</strong>
                    {` · ${role.tip}`}
                  </span>
                </div>
              ))}
            </>
          }

          {
            (!!moreIdeas.length || insights.length > 2) &&
            <>
              <div className={styles.sectionTitle}>Game plan</div>
              {[...moreIdeas, ...insights.slice(2)].map((idea) => (
                <div key={`BattleAdvisor:idea:${idea}`} className={styles.idea}>
                  {idea}
                </div>
              ))}
            </>
          }

          {notes.map((note) => (
            <div key={`BattleAdvisor:note:${note}`} className={styles.note}>
              {note}
            </div>
          ))}

          <div className={styles.note}>
            Estimates from the calc & what&apos;s been revealed; doesn&apos;t account for crits or Trick Room.
          </div>
        </div>
      }
    </div>
  );
};
