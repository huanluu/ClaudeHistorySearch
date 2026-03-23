# Design Review Agent

Review an implementation plan from the perspective of an experienced architect who knows this codebase's architecture, invariants, and conventions deeply. Use this skill after creating a plan (in plan mode or a plan file) to catch design flaws before writing code.

This skill delegates the actual review to **GitHub Copilot CLI (GPT)** via the `/copilot` skill for a cross-model architectural review. No Claude subagent is spawned — this skill works in any context including inside subagents.

## Steps

1. **Locate the plan** — Find the plan to review. Check in order:
   - If the user specified a plan file path, use that
   - Otherwise, glob `~/.claude/plans/*.md` and pick the most recently modified plan
   - If no plan file exists, check if a plan was pasted into the conversation context

   If no plan is found, tell the user and stop.

2. **Read the plan** — Read the full plan file content.

3. **Load codebase context** — Read the following files to ground the review in actual project conventions. Read all in parallel:
   - `CLAUDE.md` (project root — product vision, engineering principles, conventions)
   - `server/CLAUDE.md` (ports-and-adapters architecture, dependency rules, feature patterns)
   - `docs/invariants.md` (design principles for AI-assisted development)
   - `server/eslint.config.js` (actual ESLint enforcement — what's really enforced vs documented)
   - `server/scorecard/SCORECARD.md` (18 structural invariants, pass/fail)

   Use paths relative to the git root: `git rev-parse --show-toplevel`.

4. **Send the plan + context to Copilot for review** — Use the `/copilot` skill in consult mode. Construct the prompt with all context and the plan, then invoke:

   ```
   /copilot You are an experienced software architect reviewing an implementation plan. You have deep knowledge of this codebase's architecture and invariants.

   ## Your Review Lens

   Review the plan against these concerns, in priority order:

   ### 1. Architecture Violations (blocking)
   - Does the plan place code in the correct layer? (features = effectless, infra = by technology, ports = by consumer)
   - Does it respect the dependency direction? (features never import infra; infra never imports sibling infra)
   - Will new code pass `npm run lint` and the 18 scorecard invariants?
   - Does it maintain the effectful/effectless boundary? (features define ports, never do I/O directly)
   - Is wiring done in `app.ts` only?

   ### 2. Over-Engineering (blocking)
   - Does the plan add abstractions, helpers, or utilities that aren't needed yet?
   - Does it create new files when extending existing ones would suffice?
   - Does it add configurability or extensibility beyond what's asked?
   - Could the same result be achieved with fewer files, fewer types, or less code?
   - Remember: this is a solo side project. Simplicity is a hard constraint.

   ### 3. Invariant Compliance (blocking)
   - Will the plan produce code that satisfies all 18 scorecard invariants?
   - Pay special attention to: barrel exports (ARCH-INV-2), no `any` (CQ-INV-1), file size < 400 lines (CQ-INV-4), function size < 80 lines (CQ-INV-5), test co-location (CQ-INV-6)
   - Does the plan include test steps? Every new source file needs a co-located test.

   ### 4. Missing Error Modes (warning)
   - What happens when external dependencies fail? (DB, filesystem, network, CLI subprocess)
   - Are error types modeled intentionally or just thrown as strings?
   - Does the plan address transient vs permanent failure distinction?

   ### 5. Naming and Placement (warning)
   - Do proposed file names, type names, and function names follow conventions? (UpperCamelCase types, lowerCamelCase functions, UPPER_SNAKE constants)
   - Are files in the right directory per the decision tree in server/CLAUDE.md?

   ### 6. Scope Creep (warning)
   - Does the plan stay focused on the stated goal?
   - Does it touch files or systems unrelated to the task?

   ## Output Format

   For each finding:
   - **Severity**: `blocking` (plan must change) or `warning` (consider changing)
   - **Plan step**: Which step of the plan is affected
   - **What**: The problem
   - **Why**: Which invariant, principle, or convention it violates
   - **Suggested fix**: Concrete alternative (not vague advice)

   End with a **Verdict**:
   - **Approve**: No blocking findings. Warnings are noted but don't prevent proceeding.
   - **Revise**: Has blocking findings. List exactly what must change before implementation.

   If the plan is solid, say so. Don't invent findings.

   ---

   ## Codebase Context

   {paste the content of all five context files here, each under a ### heading}

   ---

   ## Plan Under Review

   {paste the full plan content here}
   ```

   The `/copilot` skill handles: binary detection, model selection (GPT-5.4), timeout (5 min), error handling (auth, empty response, timeout), and output presentation.

   **Large plans + context:** If the combined prompt is very large, omit `eslint.config.js` (least critical for plan review) and tell Copilot it can read files via shell commands if needed.

5. **Determine verdict** — Parse Copilot's response for the verdict:
   - If output contains `blocking` findings → verdict is **Revise**
   - If output contains only `warning` findings or no findings → verdict is **Approve**

6. **Report** — Present the full Copilot review output, then summarize:
   - State the verdict (Approve / Revise)
   - List any blocking findings with suggested fixes
   - List warnings briefly
   - If the verdict is "Revise", tell the user to update the plan and re-run `/design-review-agent`
   - State the review model: "Reviewed by GPT via Copilot CLI"
