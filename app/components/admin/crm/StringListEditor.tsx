"use client";

type Props = {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  addLabel?: string;
};

const StringListEditor = ({
  label,
  items,
  onChange,
  placeholder = "Nuevo ítem",
  addLabel = "Agregar",
}: Props) => {
  const updateAt = (index: number, value: string) => {
    const next = [...items];
    next[index] = value;
    onChange(next);
  };

  const removeAt = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const addItem = () => {
    onChange([...items, ""]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="crm-label mb-0">{label}</span>
        <button type="button" className="crm-btn-ghost text-xs" onClick={addItem}>
          {addLabel}
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--crm-muted)]">Sin ítems. Agrega uno.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li key={index} className="flex gap-2">
              <input
                className="crm-input min-w-0 flex-1"
                value={item}
                placeholder={placeholder}
                onChange={(e) => updateAt(index, e.target.value)}
              />
              <button
                type="button"
                className="crm-btn-secondary crm-btn-compact shrink-0"
                onClick={() => removeAt(index)}
                aria-label="Quitar ítem"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default StringListEditor;
