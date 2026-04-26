import { useEffect, useState, useRef } from 'react';

interface SlashCommand {
  name: string;
  description: string;
}

interface Props {
  filter: string;
  onSelect: (command: string) => void;
  onClose: () => void;
}

export function SlashAutocomplete({ filter, onSelect, onClose }: Props) {
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/slash-commands')
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((data) => { setCommands(data.commands ?? []); })
      .catch(() => { /* Commands unavailable — autocomplete won't show */ });
  }, []);

  const filtered = commands.filter((c) =>
    c.name.toLowerCase().startsWith(filter.toLowerCase().replace(/^\//, '')),
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [filter]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
      if (e.key === 'Tab' || (e.key === 'Enter' && filtered.length > 0)) {
        e.preventDefault();
        const selected = filtered[activeIndex];
        if (selected) onSelect(`/${selected.name}`);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filtered, activeIndex, onSelect, onClose]);

  if (filtered.length === 0) return null;

  return (
    <div className="slash-autocomplete" ref={ref}>
      {filtered.slice(0, 8).map((cmd, i) => (
        <div
          key={cmd.name}
          className={`slash-autocomplete-item ${i === activeIndex ? 'active' : ''}`}
          onClick={() => onSelect(`/${cmd.name}`)}
        >
          <span className="slash-cmd">/{cmd.name}</span>
          <span className="slash-desc">{cmd.description}</span>
        </div>
      ))}
    </div>
  );
}
