import type { CommandRunner, WorkItem, ChangeSet } from './types';

/**
 * Fetch work items from Azure DevOps using az CLI with WIQL query
 */
function fetchWorkItems(runner: CommandRunner): WorkItem[] {
  const wiql = "SELECT [System.Id], [System.Title], [System.State], [System.ChangedDate], [System.AssignedTo], [System.Description], [System.WorkItemType] FROM WorkItems WHERE [System.AssignedTo] = @me AND [System.State] <> 'Closed' AND [System.State] <> 'Removed' AND [System.State] <> 'Resolved' ORDER BY [System.ChangedDate] DESC";
  const result = runner.run('az', ['boards', 'query', '--wiql', wiql, '-o', 'json']);

  if (result.exitCode !== 0) {
    throw new Error(`az boards query failed (exit ${result.exitCode}): ${result.stderr || 'unknown error'}`);
  }

  try {
    return JSON.parse(result.stdout) as WorkItem[];
  } catch {
    throw new Error(`Failed to parse az boards output as JSON: ${result.stdout.slice(0, 200)}`);
  }
}

/**
 * Check for new or updated work items
 */
export async function checkForChanges(
  runner: CommandRunner,
  getProcessedItemState: (key: string) => string | undefined,
): Promise<ChangeSet> {
  const result: ChangeSet = {
    newItems: [],
    updatedItems: [],
    errors: []
  };

  try {
    const workItems = fetchWorkItems(runner);

    for (const item of workItems) {
      const key = `workitem:${item.id}`;
      const changedDate = item.fields['System.ChangedDate'];
      const lastProcessed = getProcessedItemState(key);

      if (!lastProcessed) {
        result.newItems.push(item);
      } else if (lastProcessed !== changedDate) {
        result.updatedItems.push(item);
      }
    }
  } catch (error) {
    result.errors.push((error as Error).message);
  }

  return result;
}

/**
 * Build the prompt for Claude analysis of a work item
 */
export function buildWorkItemPrompt(workItem: WorkItem): string {
  return `<!-- HEARTBEAT_SESSION -->
[Heartbeat] Analyze Work Item #${workItem.id}

Work Item Details:
- ID: ${workItem.id}
- Title: ${workItem.fields['System.Title']}
- State: ${workItem.fields['System.State']}
- Type: ${workItem.fields['System.WorkItemType'] || 'Unknown'}

${workItem.fields['System.Description'] ? `Description:\n${workItem.fields['System.Description']}` : ''}

Please analyze this work item in the context of the codebase:
1. Identify relevant code files and modules
2. Assess complexity and effort required
3. Suggest an implementation approach
4. Note any potential risks or dependencies`;
}
