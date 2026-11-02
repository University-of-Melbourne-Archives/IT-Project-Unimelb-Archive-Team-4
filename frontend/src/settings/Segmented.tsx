// A row of buttons of which one is picked, like a segmented switch.
export default function Segmented({ label, options, value, onChange, className = "" }: {
  label: string; options: { value: string; label: string }[]; value: string; onChange: (value: string) => void; className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`grid auto-cols-fr grid-flow-col rounded-lg bg-muted p-1 ${className}`}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${value === o.value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
