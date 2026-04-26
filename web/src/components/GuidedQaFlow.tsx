import { useState, useEffect } from 'react';

interface Workflow {
  id: string;
  label: string;
  description: string;
  questionCount: number;
}

interface Question {
  id: string;
  title: string;
  prompt: string;
  kind: 'single' | 'multi' | 'text';
  options: Array<{ value: string; label: string; description?: string }>;
  allowSkip: boolean;
  placeholder?: string;
  summaryLabel?: string;
}

interface Props {
  seedQuery?: string;
  preselectedWorkflowId?: string;
  onComplete: (enrichedQuery: string) => void;
  onCancel: () => void;
}

export function GuidedQaFlow({ seedQuery, preselectedWorkflowId, onComplete, onCancel }: Props) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(preselectedWorkflowId ?? null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Array<{ questionId: string; label: string; value: string }>>([]);
  const [textInput, setTextInput] = useState('');
  const [phase, setPhase] = useState<'select' | 'questions' | 'done'>(preselectedWorkflowId ? 'questions' : 'select');

  useEffect(() => {
    if (phase === 'select') {
      fetch('/api/guided-qa/workflows').then((r) => r.json()).then((d) => setWorkflows(d.workflows ?? []));
    }
  }, [phase]);

  useEffect(() => {
    if (selectedWorkflow && phase === 'questions' && questions.length === 0) {
      fetch('/api/guided-qa/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: selectedWorkflow, query: seedQuery }),
      }).then((r) => r.json()).then((d) => setQuestions(d.questions ?? []));
    }
  }, [selectedWorkflow, phase, questions.length, seedQuery]);

  const handleSelectWorkflow = (id: string) => {
    setSelectedWorkflow(id);
    setPhase('questions');
  };

  const handleAnswer = (value: string) => {
    const q = questions[currentIndex];
    if (!q) return;
    setAnswers((prev) => [...prev, { questionId: q.id, label: q.summaryLabel ?? q.title, value }]);
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((i) => i + 1);
      setTextInput('');
    } else {
      synthesize([...answers, { questionId: q.id, label: q.summaryLabel ?? q.title, value }]);
    }
  };

  const handleSkip = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((i) => i + 1);
      setTextInput('');
    } else {
      synthesize(answers);
    }
  };

  const synthesize = async (finalAnswers: typeof answers) => {
    setPhase('done');
    const res = await fetch('/api/guided-qa/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId: selectedWorkflow, query: seedQuery ?? '', answers: finalAnswers }),
    });
    const data = await res.json();
    onComplete(data.enrichedQuery);
  };

  // Workflow selection
  if (phase === 'select') {
    return (
      <div className="guided-qa-block">
        <div className="guided-qa-title">
          <span className="marker">✻</span> Select a Shariah workflow
        </div>
        {workflows.length === 0 && <div className="guided-qa-hint">No guided workflows are available right now.</div>}
        <div className="guided-qa-options">
          {workflows.map((wf) => (
            <button key={wf.id} className="guided-qa-option" onClick={() => handleSelectWorkflow(wf.id)}>
              <span className="option-arrow">→</span>
              <span className="option-label">{wf.label}</span>
              <span className="option-desc"> — {wf.description} ({wf.questionCount} questions)</span>
            </button>
          ))}
        </div>
        <button className="guided-qa-cancel" onClick={onCancel}>Cancel (Esc)</button>
      </div>
    );
  }

  // Question phase
  if (phase === 'questions') {
    const q = questions[currentIndex];
    if (!q) return <div className="guided-qa-hint">Loading questions...</div>;

    return (
      <div className="guided-qa-block">
        <div className="guided-qa-progress">
          <span className="marker">✻</span> Question {currentIndex + 1} of {questions.length}
        </div>
        <div className="guided-qa-question">{q.title}</div>
        {q.prompt && <div className="guided-qa-hint">{q.prompt}</div>}

        {q.kind === 'single' && q.options.length > 0 && (
          <div className="guided-qa-options">
            {q.options.map((opt, i) => (
              <button key={i} className="guided-qa-option" onClick={() => handleAnswer(opt.value)}>
                <span className="option-num">{i + 1}.</span>
                <span className="option-label">{opt.label}</span>
                {opt.description && <span className="option-desc"> — {opt.description}</span>}
              </button>
            ))}
          </div>
        )}

        {(q.kind === 'text' || (q.kind === 'single' && q.options.length === 0)) && (
          <form className="guided-qa-text" onSubmit={(e) => { e.preventDefault(); if (textInput.trim()) handleAnswer(textInput.trim()); }}>
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={q.placeholder ?? 'Type your answer...'}
              autoFocus
            />
          </form>
        )}

        <div className="guided-qa-actions">
          {q.allowSkip && <button className="guided-qa-skip" onClick={handleSkip}>Skip</button>}
          <button className="guided-qa-cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    );
  }

  // Done
  return (
    <div className="guided-qa-block">
      <div className="guided-qa-hint"><span className="marker">✻</span> Preparing your workflow query...</div>
    </div>
  );
}
