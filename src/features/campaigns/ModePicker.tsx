/**
 * ModePicker — a segmented control for choosing a campaign's game mode.
 *
 * Owns the shared presentation of the `game_mode` choice (migration 0028) so the
 * two places that offer it — the create-campaign form on the dashboard and the
 * DM's "Game mode" control on the Overview tab — always show the same options,
 * ordering and copy. Options and wording come from GAME_MODES in ./api.
 *
 * Purely presentational: it renders radio inputs and reports the selection up.
 * Persistence (createCampaign / setGameMode) belongs to the caller.
 */
import { GAME_MODES, type GameMode } from './api'

/**
 * A radio-group segmented control listing every game mode with its one-line
 * description.
 *
 * @param value - The currently selected mode (controlled).
 * @param onChange - Called with the newly picked mode. Not called when disabled.
 * @param disabled - Greys out and blocks input (e.g. while a save is in flight).
 * @param name - Radio group name. Must be unique on the page if two pickers are
 *        ever rendered at once, otherwise the browser links their selection.
 * @param label - Group label rendered above the options.
 */
export function ModePicker({
  value,
  onChange,
  disabled = false,
  name = 'game-mode',
  label = 'Game mode',
}: {
  value: GameMode
  onChange: (mode: GameMode) => void
  disabled?: boolean
  name?: string
  label?: string
}) {
  return (
    <fieldset
      disabled={disabled}
      style={{
        border: 'none',
        padding: 0,
        margin: 0,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <legend
        style={{
          padding: 0,
          fontSize: '0.85rem',
          color: 'var(--color-text-muted)',
          marginBottom: 'var(--space-2)',
        }}
      >
        {label}
      </legend>
      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        {GAME_MODES.map((mode) => {
          const selected = mode.value === value
          return (
            <label
              key={mode.value}
              style={{
                display: 'flex',
                gap: 'var(--space-3)',
                alignItems: 'flex-start',
                cursor: disabled ? 'default' : 'pointer',
                padding: 'var(--space-3)',
                background: 'var(--color-bg)',
                // The selected option is called out with the accent border; the
                // radio itself stays visible for keyboard/AT users.
                border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius)',
              }}
            >
              <input
                type="radio"
                name={name}
                value={mode.value}
                checked={selected}
                onChange={() => onChange(mode.value)}
                style={{ marginTop: '3px' }}
              />
              <span>
                <span style={{ fontWeight: selected ? 600 : 500 }}>{mode.label}</span>
                <span
                  style={{
                    display: 'block',
                    fontSize: '0.82rem',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {mode.description}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
