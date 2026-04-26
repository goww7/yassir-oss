interface Option {
  value: string;
  label: string;
  description?: string;
}

interface Props {
  question: string;
  mode: 'inline' | 'single_select';
  options?: Option[];
  onAnswer: (answer: string) => void;
}

export function ClarificationPrompt({ question, mode, options, onAnswer }: Props) {
  return (
    <div className="clarification-block">
      <div className="clarification-question">
        <span className="marker">✻</span> {question}
      </div>
      {mode === 'single_select' && options && options.length > 0 && (
        <div className="clarification-options">
          {options.map((opt, i) => (
            <button key={i} className="clarification-option" onClick={() => onAnswer(opt.value)}>
              <span className="option-num">{i + 1}.</span>
              <span className="option-label">{opt.label}</span>
              {opt.description && <span className="option-desc"> — {opt.description}</span>}
            </button>
          ))}
        </div>
      )}
      {mode === 'inline' && (
        <div className="clarification-hint">Type your answer below</div>
      )}
    </div>
  );
}
