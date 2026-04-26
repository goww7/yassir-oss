import { Hono } from 'hono';
import { getCurrentProfile } from '../../profile/current.js';

const guidedQa = new Hono();

guidedQa.get('/guided-qa/workflows', (c) => {
  const profile = getCurrentProfile();
  const config = profile.vertical.guidedQa;
  if (!config?.enabled || !config.workflows.length) {
    return c.json({ workflows: [] });
  }
  return c.json({
    workflows: config.workflows.map((wf) => ({
      id: wf.id,
      label: wf.label,
      description: wf.description,
      questionCount: wf.questions.length,
    })),
  });
});

guidedQa.post('/guided-qa/start', async (c) => {
  const body = await c.req.json<{ workflowId: string; query?: string }>();
  const profile = getCurrentProfile();
  const config = profile.vertical.guidedQa;
  if (!config?.enabled) return c.json({ error: 'Guided Q&A not enabled for this profile' }, 400);

  const workflow = config.workflows.find((wf) => wf.id === body.workflowId);
  if (!workflow) return c.json({ error: `Workflow "${body.workflowId}" not found` }, 404);

  // Return all questions for the workflow so the frontend can drive the flow
  const questions = workflow.questions
    .filter((q) => {
      // Evaluate conditions
      if (!q.when) return true;
      return true; // Simplified — condition evaluation needs prior answers
    })
    .map((q) => ({
      id: q.id,
      title: q.title,
      prompt: q.prompt,
      kind: q.kind,
      options: q.options ?? [],
      allowSkip: q.allowSkip ?? false,
      placeholder: q.placeholder,
      defaultValue: q.defaultValue,
      summaryLabel: q.summaryLabel,
    }));

  return c.json({
    workflowId: workflow.id,
    label: workflow.label,
    description: workflow.description,
    executionHint: workflow.executionHint,
    outputSections: workflow.outputSections ?? [],
    questions,
    query: body.query ?? '',
  });
});

guidedQa.post('/guided-qa/synthesize', async (c) => {
  const body = await c.req.json<{
    workflowId: string;
    query: string;
    answers: Array<{ questionId: string; label: string; value: string }>;
  }>();

  const profile = getCurrentProfile();
  const workflow = profile.vertical.guidedQa?.workflows.find((item) => item.id === body.workflowId);
  const originalQuery = body.query.trim() || workflow?.label || 'Guided workflow request';

  const contextLines: string[] = [];
  if (workflow) {
    contextLines.push(`Requested workflow: ${workflow.label}`);
    contextLines.push(`Workflow goal: ${workflow.description}`);
    if (workflow.executionHint) {
      contextLines.push(`Execution hint: ${workflow.executionHint}`);
    }
  }
  for (const answer of body.answers) {
    contextLines.push(`${answer.label}: ${answer.value}`);
  }
  if (workflow?.outputSections?.length) {
    contextLines.push(`Expected output: ${workflow.outputSections.join(' | ')}`);
  }

  const enrichedQuery = contextLines.length
    ? `${originalQuery}\n\nContext from guided workflow:\n${contextLines.map((line) => `- ${line}`).join('\n')}`
    : originalQuery;

  return c.json({ enrichedQuery });
});

export { guidedQa };
