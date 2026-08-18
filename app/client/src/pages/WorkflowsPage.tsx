import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { humanise } from '../lib/format';
import type { WorkflowDefinitionView } from '../types';
import { Alert, Card, Loading, PageHeader } from '../components/ui';

const SCOPE_LABELS: Record<string, string> = {
  DIVISION: 'Same division',
  CIRCLE: 'Same circle',
  ZONE: 'Same zone',
  GLOBAL: 'Head office',
  INITIATOR: 'Back to the person who raised it',
};

export function WorkflowsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['workflow-definitions'],
    queryFn: () => api.get<WorkflowDefinitionView[]>('/approvals/definitions'),
    staleTime: 10 * 60 * 1000,
  });

  return (
    <>
      <PageHeader
        title="Approval chains"
        subtitle="The order in which each kind of file moves, and which post acts at every stage."
      />

      <Alert variant="info" title="Reference only">
        These chains are configured centrally. A file always follows the chain that was in force when it was
        raised, so changing a chain never re-routes work already in progress.
      </Alert>

      {isLoading ? (
        <Loading label="Loading the approval chains…" />
      ) : (
        <div className="stack">
          {(data ?? []).map((definition) => (
            <Card
              key={definition.id}
              title={definition.name}
              subtitle={definition.description ?? `Applies to ${humanise(definition.entityType)} records.`}
              actions={<span className="code">{definition.code}</span>}
            >
              <ol className="timeline">
                {definition.steps.map((step) => (
                  <li key={step.id} className="timeline__step timeline__step--pending">
                    <span className="timeline__marker">{step.seq}</span>
                    <div>
                      <div className="timeline__name">{step.name}</div>
                      <div className="timeline__meta">
                        Acted on by <strong>{step.roleCode}</strong>
                        {' · '}
                        {SCOPE_LABELS[step.scope] ?? humanise(step.scope)}
                        {step.slaDays > 0 && ` · ${step.slaDays} day${step.slaDays === 1 ? '' : 's'} to act`}
                      </div>
                      <div className="timeline__meta">
                        {step.allowReturn ? 'May return the file for correction' : 'Cannot return the file'}
                        {' · '}
                        {step.allowReject ? 'May reject outright' : 'Cannot reject'}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
