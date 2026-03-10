import type { CommandExecutor, WorkItem, ChangeSet } from './types';

/**
 * Fetch work items from Azure DevOps using az CLI with WIQL query
 */
function fetchWorkItems(executor: CommandExecutor): WorkItem[] {
  try {
    const wiql = "SELECT [System.Id], [System.Title], [System.State], [System.ChangedDate], [System.AssignedTo], [System.Description], [System.WorkItemType] FROM WorkItems WHERE [System.AssignedTo] = @me AND [System.State] <> 'Closed' AND [System.State] <> 'Removed' AND [System.State] <> 'Resolved' ORDER BY [System.ChangedDate] DESC";
    const output = executor.execSync(
      `az boards query --wiql "${wiql}" -o json`,
      { encoding: 'utf-8' }
    );
    return JSON.parse(output) as WorkItem[];
  } catch (error) {
    throw new Error(`Failed to fetch work items: ${(error as Error).message}`);
  }
}

/**
 * Check for new or updated work items
 */
export async function checkForChanges(
  executor: CommandExecutor,
  getProcessedItemState: (key: string) => string | undefined,
): Promise<ChangeSet> {
  const result: ChangeSet = {
    newItems: [],
    updatedItems: [],
    errors: []
  };

  try {
    const workItems = fetchWorkItems(executor);

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
