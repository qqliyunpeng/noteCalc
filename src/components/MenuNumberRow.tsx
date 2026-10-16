interface MenuNumberRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(value: number): void;
}

/** Label plus `-` / input / `+` control, as used by the menu bar's display rows. */
export function MenuNumberRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: MenuNumberRowProps) {
  return (
    <div className="menu-row">
      <span>{label}</span>
      <span className="menu-stepper">
        <button type="button" onClick={() => onChange(value - step)} disabled={value <= min}>
          −
        </button>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) => {
            if (event.target.value.trim() === "") return;
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
        <button type="button" onClick={() => onChange(value + step)} disabled={value >= max}>
          +
        </button>
      </span>
    </div>
  );
}
