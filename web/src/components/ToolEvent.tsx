import { useState } from 'react';
import type { AgentEvent } from '../types';
import { formatToolPhase, formatToolName, formatDuration, summarizeToolResult } from '../utils/tool-phase';
import { extractToolSourceEntries, type ToolSourceEntry } from '../utils/tool-sources';

function truncateArgs(tool: string, args: Record<string, unknown>): string {
  if ('query' in args) return `"${String(args.query).slice(0, 60)}${String(args.query).length > 60 ? '...' : ''}"`;
  if (tool === 'memory_update') {
    const text = String(args.content ?? args.old_text ?? '').replace(/\n/g, ' ');
    return text.length > 80 ? text.slice(0, 80) + '...' : text;
  }
  return Object.entries(args)
    .filter(([k]) => k !== 'purpose')
    .map(([k, v]) => { const s = String(v).replace(/\n/g, '\\n'); return `${k}=${s.length > 60 ? s.slice(0, 60) + '...' : s}`; })
    .join(', ');
}

function SourceList({ entries }: { entries: ToolSourceEntry[] }) {
  return (
    <div className="tool-sources-list">
      {entries.map((e, i) => (
        <div key={i} className="tool-source-entry">
          <span className="source-bullet">·</span>
          {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer">{e.label}</a> : <span>{e.label}</span>}
          {e.meta && <span className="source-meta"> · {e.meta}</span>}
        </div>
      ))}
    </div>
  );
}

interface Props {
  event: AgentEvent;
  stepNum?: number;
}

export function ToolEvent({ event, stepNum }: Props) {
  const [sourcesOpen, setSourcesOpen] = useState(false);

  switch (event.type) {
    case 'tool_start': {
      const tool = event.tool as string;
      const args = event.args as Record<string, unknown>;
      const phase = formatToolPhase(tool, String(stepNum ?? 0));
      const argsStr = truncateArgs(tool, args);
      return (
        <div className="tool-block">
          <div className="tool-event">
            <span className="tool-marker running">⏺</span>
            {stepNum != null && <span className="tool-step">Step {String(stepNum).padStart(2, '0')} ·</span>}
            <span className="tool-phase">{phase} ·</span>
            <span className="tool-name">{formatToolName(tool)}</span>
            {argsStr && <span className="tool-args">({argsStr})</span>}
          </div>
        </div>
      );
    }

    case 'tool_progress':
      return (
        <div className="tool-detail-line">
          ⎿ {event.message as string}
        </div>
      );

    case 'tool_end': {
      const tool = event.tool as string;
      const args = event.args as Record<string, unknown>;
      const result = event.result as string;
      const duration = event.duration as number;
      const summary = summarizeToolResult(tool, args, result);
      const sources = extractToolSourceEntries(tool, result);
      return (
        <div>
          <div className="tool-detail-line">
            ⎿ {summary} in {formatDuration(duration)}
            {sources.length > 0 && (
              <button className="sources-toggle" onClick={() => setSourcesOpen(!sourcesOpen)}>
                {sourcesOpen ? 'hide sources' : `${sources.length} sources`}
              </button>
            )}
          </div>
          {sourcesOpen && sources.length > 0 && <SourceList entries={sources} />}
        </div>
      );
    }

    case 'tool_error':
      return (
        <div className="tool-detail-line tool-error-line">
          ⎿ Error: {event.error as string}
        </div>
      );

    case 'tool_limit':
      return (
        <div className="tool-detail-line tool-warning-line">
          ⎿ {(event.warning as string) || 'Approaching suggested limit'}
        </div>
      );

    case 'thinking':
      return (
        <div className="thinking-line">
          <span className="marker">✻</span>
          {event.message as string}
        </div>
      );

    case 'tool_approval': {
      const decision = event.approved as string;
      const label = decision === 'allow-once' ? 'Approved' : decision === 'allow-session' ? 'Approved (session)' : 'Denied';
      const cls = decision !== 'deny' ? 'tool-approved-line' : 'tool-denied-detail';
      return <div className={`tool-detail-line ${cls}`}>⎿ {label}</div>;
    }

    case 'tool_denied': {
      const tool = event.tool as string;
      const args = event.args as Record<string, unknown>;
      const path = (args.path as string) ?? tool;
      return <div className="tool-detail-line tool-warning-line">⎿ User denied {path}</div>;
    }

    case 'context_cleared':
      return (
        <div className="context-event">
          <span className="tool-marker">⏺</span>
          Context threshold reached — cleared {event.clearedCount as number}, kept {event.keptCount as number}
        </div>
      );

    case 'memory_recalled': {
      const files = event.filesLoaded as string[];
      const tokens = event.tokenCount as number;
      return (
        <div className="memory-event">
          <span className="marker">✻</span>
          Memory loaded: {files.length} files, ~{tokens.toLocaleString()} tokens
        </div>
      );
    }

    case 'memory_flush': {
      const phase = event.phase as string;
      if (phase === 'start') return <div className="memory-event"><span className="marker">✻</span> Flushing memory...</div>;
      const written = event.filesWritten as string[] | undefined;
      return <div className="memory-event"><span className="marker">✻</span> Memory flushed{written ? `: ${written.length} files` : ''}</div>;
    }

    default:
      return null;
  }
}
