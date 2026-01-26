# Usage Guide

Learn how to effectively use the Second Brain Agent to capture and organize your thoughts.

## Quick Start

Send a direct message to your Slack bot. The agent will:
1. Classify your message
2. Extract and preserve all details (contacts, dates, amounts, etc.)
3. Store it appropriately (or send to OmniFocus for tasks)
4. Reply with confirmation

## Context Preservation

**Nothing gets lost.** The agent extracts and preserves all factual information from your messages:

- **Contact info**: Names, phone numbers, emails, roles
- **Dates and deadlines**: "by Friday", "next Tuesday"
- **Amounts**: Prices, measurements, quantities
- **Relationships**: "our contractor", "my accountant"

**Example:**
```
I need to review estimates with John, our landscaping contractor. His number is 555-123-4567
```

The agent will:
- Create a task: "Review estimates with John"
- Link to landscaping project (detected via Memory context)
- Preserve contact: "John (landscaping) - 555-123-4567"
- Log everything to inbox and send to OmniFocus

## Memory-Based Item Context

The system automatically syncs your knowledge items (projects, ideas, decisions) to AgentCore Memory. This enables intelligent linking without explicit tool calls.

### How It Works

1. **Memory-First Retrieval**: When classifying, the system first checks AgentCore Memory for cached items
2. **CodeCommit Fallback**: If Memory is empty or unavailable, falls back to reading directly from CodeCommit
3. **Delta Sync**: After each capture, only the changed item syncs to Memory (non-blocking, fire-and-forget)
4. **Timestamped Records**: Each Memory record includes a `Synced:` timestamp so the LLM can identify the most recent version
5. **Direct Storage**: Items are stored using the `BatchCreateMemoryRecords` API, which preserves structured metadata exactly as formatted (bypasses semantic summarization)
6. **Semantic Retrieval**: When you mention a project or topic, Memory retrieves relevant items based on semantic similarity
7. **Automatic Linking**: The classifier uses this context to populate `linked_items` in the Action Plan

### What Gets Synced

Items from these folders are synced to Memory:
- `10-ideas/` - Ideas with front matter
- `20-decisions/` - Decisions with front matter
- `30-projects/` - Projects with front matter

Each item's metadata (SB_ID, title, type, tags, status) is stored for retrieval.

### Benefits

- **Delta sync**: Only changed items sync after each capture (not full rebuild)
- **Non-blocking**: Sync happens after response, doesn't slow down replies
- **Timestamped**: Records include sync timestamps for historical tracking
- **Fast responses**: Memory-first retrieval avoids CodeCommit latency on cache hits
- **No tool calls needed**: The LLM doesn't need to search - context is provided automatically
- **Better matching**: Semantic search finds related items even with different wording
- **Graceful degradation**: Falls back to CodeCommit if Memory is empty or unavailable

### Health Check

Run `health` to verify Memory/CodeCommit sync status:

```
health
```

Response shows:
- CodeCommit item count
- Memory record count (may be higher due to historical versions)
- Sync status (in sync / out of sync)
- Missing items (if any)
- Current HEAD commit

### Repair Command

If items are missing from Memory, run `repair` to sync only the missing items (no duplicates):

```
repair
```

This finds items that exist in CodeCommit but not in Memory and syncs only those.

### Rebuild Command

To completely rebuild Memory from scratch (clears all records and resyncs):

```
rebuild
```

This is useful when:
- Memory records are corrupted or out of date
- You've updated the sync format (e.g., added new fields like `Created:`)
- You want a clean slate

The rebuild process:
1. Deletes ALL existing Memory records for your user
2. Resets the sync marker
3. Resyncs all items from CodeCommit with fresh metadata

**Note:** After a code update that changes the Memory record format, you must run `rebuild` to update existing records. New items will automatically use the new format, but old records retain their original format until rebuilt.

## Message Classification

The agent classifies messages into six categories:

### Inbox (Default)

Quick notes, reminders, or anything that doesn't fit other categories.

**Examples:**
```
Remember to check the mail
Meeting moved to 3pm
John's phone number: 555-1234
```

**Storage:** `00-inbox/YYYY-MM-DD.md` (appended chronologically)

### Idea

Novel concepts, insights, or observations worth capturing.

**Trigger words:** "idea", "thought", "what if", "could we", "insight"

**Examples:**
```
Idea: what if we converted the garage into a home gym?
Interesting thought - we could save money by meal prepping on Sundays
What if we planned a road trip along the coast this summer?
```

**Storage:** `10-ideas/YYYY-MM-DD__<slug>__<SB_ID>.md` (one file per idea, with front matter)

### Decision

Explicit choices or commitments you've made.

**Trigger words:** "decided", "decision", "I've chosen", "going with", "will use"

**Examples:**
```
I've decided to go with the blue paint for the living room
Decision: we're doing Thanksgiving at our place this year
I'm going with the 15-year mortgage instead of the 30-year
```

**Storage:** `20-decisions/YYYY-MM-DD__<slug>__<SB_ID>.md` (with front matter)

### Project

Multi-step initiatives or ongoing work.

**Trigger words:** "project", "initiative", "starting", "working on"

**Examples:**
```
New project: Kitchen Renovation. Goal is to update cabinets and countertops by spring.
Project update: Boat engine restoration is 50% complete
Starting a project to organize the garage
```

**Storage:** `30-projects/YYYY-MM-DD__<slug>__<SB_ID>.md` (with front matter)

### Task

Actionable items that should go to your task manager.

**Strong trigger phrases (always classified as task):**
- "I need to..."
- "I should..."
- "I have to..."
- "Remind me to..."
- "Don't forget to..."
- "Todo:" or "Task:" prefix

These phrases trigger task classification regardless of additional context or explanation.

**Examples:**
```
I need to call the insurance company about the claim
I need to research IAM billing visibility control. Specifically in AWS organizations, blocking all principles including root user
Task: schedule the annual furnace inspection
Don't forget to pick up the dry cleaning tomorrow
```

**Destination:** OmniFocus via Mail Drop email (includes SB-ID in task notes for linking)

**Audit Trail:** Tasks are also logged to `00-inbox/YYYY-MM-DD.md` with full context preserved:
```
- HH:MM: [task] Task title (Project: Project Name)
  > Contact: Chase (landscaping) - 555-123-4567
  > Review landscaping estimates
```

### Status Update

Change the status of an existing project.

**Trigger patterns:** "[project] is complete", "pause [project]", "resume [project]", "cancel [project]"

**Examples:**
```
Kitchen renovation is complete
Pause the garage organization
Resume the boat engine project
```

**Action:** Updates the project file's front matter `status` field

## Project Status Management

Update project status using natural language commands. The system tracks four status values: `active`, `on-hold`, `complete`, and `cancelled`.

### Updating Status

Simply tell the bot about the project's new state:

```
Kitchen renovation is complete
Pause the garage organization
Resume the boat engine project
Cancel the backyard deck project
Mark garden planning as on-hold
```

### Status Mappings

| Natural Language | Status Value |
|-----------------|--------------|
| "complete", "done", "finished" | `complete` |
| "pause", "on hold", "paused" | `on-hold` |
| "resume", "restart", "reactivate" | `active` |
| "cancel", "close", "drop" | `cancelled` |

### Confirmation

When a status update succeeds:
```
Updated Kitchen Renovation (sb-79ccaa5) status to complete
```

### Project Matching

The system uses fuzzy matching to find the right project. If multiple projects match your reference, it will ask for clarification. If no project is found, you'll see:
```
Could not find a project matching "backyard deck"
```

### Querying by Status

Ask about projects by status:
```
What projects are active?
Show me on-hold projects
Which projects are complete?
```

### Querying for Reports

Ask for overall reports and summaries:
```
Give me an overall report of priorities
Show me a summary of my projects
What's the status of everything?
```

The system uses semantic search to find all relevant items and provides a consolidated report.

## Task-Project Linking

Tasks can be automatically linked to existing projects using natural language references. The system uses AgentCore Memory to find matching projects from your knowledge base.

### How It Works

When you mention a project in your task message, the agent:
1. Detects the project reference (explicit or implicit)
2. Retrieves matching items from AgentCore Memory (synced from CodeCommit)
3. Auto-links if a confident match is found (≥70% confidence)
4. Includes the project's SB_ID in the email to OmniFocus

### Supported Patterns

**Explicit patterns:**
```
Task for <project>: <task description>
Add to <project>: <task description>
<project> task: <task description>
<task description> for the <project>
```

**Implicit patterns (auto-detected via Memory context):**
```
Call the contractor about the kitchen quote
→ Links to "Kitchen Renovation" project

Review estimates with Chase, our landscaping pro
→ Links to "Landscaping" project (detected from context)

Schedule the furnace inspection
→ Links to "Home Maintenance" project (if exists in Memory)
```

### Examples

```
Task for kitchen renovation: Get quotes from contractors
→ Links to "Kitchen Renovation" project (sb-79ccaa5)

Add to boat engine: Order new spark plugs
→ Links to "Boat Engine Restoration" project

garden project task: Buy tomato seedlings
→ Partial match links to "Garden Planning" project

Task: Buy groceries
→ Standalone task (no project reference)

Task for birthday party: Order the cake
→ Standalone task (no matching project found)
```

### Confirmation Messages

When a task is linked to a project, you'll see:
```
Captured as task
Task sent to OmniFocus, linked to project: Kitchen Renovation (sb-79ccaa5)
```

When no project is linked:
```
Captured as task
Task sent to OmniFocus: "Buy groceries"
```

### OmniFocus Integration

Linked tasks include `SB-Project: sb-xxxxxxx` in the email metadata, enabling OmniFocus Automation to:
- Automatically assign tasks to the correct project
- Maintain bidirectional links between Second Brain and OmniFocus

## Confidence and Clarification

The agent uses confidence scores to determine how certain it is about classification:

| Confidence | Action |
|------------|--------|
| High (≥ 85%) | Proceeds with classification |
| Medium (70-84%) | May ask for clarification or default to inbox |
| Low (< 70%) | Always asks for clarification |

### Clarification Flow

When the agent is unsure, it will ask:

```
I'm not sure how to classify this. Is this:
- An idea to capture?
- A decision you've made?
- A task to do?
- Just a note for the inbox?
```

Simply reply with your choice:
```
idea
```

Or be more specific:
```
This is a decision I made yesterday
```

## Fix Command

Made a mistake? Use the fix command to correct the most recent entry.

### Syntax

```
fix: <instruction>
```

### Content Fixes

Edit the content of the most recent entry:

```
fix: change the title to "Q2 Budget Review"
fix: add a note about the deadline being flexible
fix: remove the last bullet point
```

### Reclassification

Reclassify an entry to a different type. This re-processes the original message with the new classification, including all side effects (email for tasks, project linking, etc.):

```
fix: this should be a task
fix: make this an idea
fix: this is a decision
fix: reclassify as project
```

**Example flow:**
```
You: I need to research IAM billing visibility control. Specifically in AWS organizations...
Bot: Captured as inbox
     Files: 00-inbox/2026-01-22.md

You: fix: this should be a task
Bot: Reclassified as task
     Task sent to OmniFocus: "Research IAM billing visibility control"
```

When reclassifying to task, the system:
- Extracts the original message from the file
- Re-invokes the classifier with the forced classification
- Sends the task to OmniFocus via email
- Links to any matching projects via Memory context

### Limitations

- Can only fix the most recent fixable entry (inbox, idea, decision, project)
- Cannot fix tasks (they're already sent to OmniFocus)
- Cannot fix queries, clarifications, or status updates

## Best Practices

### Be Specific

The more context you provide, the better the classification:

❌ `meeting`
✅ `I decided to schedule family dinners every Sunday at 6pm`

### Use Natural Language

Write as you would speak:

❌ `task: call dentist`
✅ `I need to call the dentist to schedule a cleaning`

### One Thought Per Message

For best results, send one thought at a time. However, the agent can handle multiple items in a single message:

**Single items work best for:**
- Complex ideas or decisions with lots of context
- Items that need detailed explanation

**Multiple items are supported:**
```
Order spark plugs and clean the carburetor for the boat engine project
→ Creates 2 tasks, both linked to "Boat Engine Restoration" project

I decided to paint the room blue and I need to buy the paint
→ Creates 1 decision + 1 task
```

See "Multi-Item Messages" section for details.

### Review Your Inbox

Periodically review `00-inbox/` and promote items to ideas, decisions, or projects.

## Multi-Item Messages

The agent can process messages containing multiple distinct items in a single message. Items can be any classification type - tasks, decisions, ideas, or even mixed types.

### How It Works

When you send a message with multiple distinct items, the agent:
1. Detects separate items (different verbs, explicit markers, etc.)
2. Classifies each item independently
3. Processes each item (creates files, sends emails)
4. Sends a consolidated confirmation

### Supported Patterns

```
<action1> and <action2>
<action1> and <action2> for the <project>
I decided <X> and I decided <Y>
I decided <X> and I need to <Y>
```

### Examples

**Two unrelated tasks:**
```
Buy milk and call the dentist
→ Processed 2 items:
  • ✓ Buy milk → task
  • ✓ Call the dentist → task
```

**Tasks with project reference (applies to ALL items):**
```
Order spark plugs and clean the carburetor for the boat engine project
→ Processed 2 items:
  • ✓ Order spark plugs → task (Boat Engine Restoration)
  • ✓ Clean the carburetor → task (Boat Engine Restoration)
```

**Mixed classification types:**
```
I decided to go with granite countertops and I need to get quotes from installers
→ Processed 2 items:
  • Countertop Material Decision → decision
  • ✓ Get quotes from installers → task
```

**Multiple decisions:**
```
I decided to paint the bedroom blue and I decided to replace the carpet with hardwood
→ Processed 2 items:
  • Bedroom Paint Color Decision → decision
  • Flooring Decision → decision
```

### What Gets Split

The agent splits when it detects distinct items:
- Different verbs: "upload X, write Y, and deploy Z" → 3 items
- Multiple decisions: "I decided X, Y, and Z" → 3 decisions
- Mixed types: "I decided X and I need to Y" → 1 decision + 1 task
- Numbered lists: "1. X 2. Y 3. Z" → 3 items
- Semicolon-separated: "email John; call Sarah; update docs" → 3 items

### What Stays Together

The agent keeps items together when they're logically related:
- "research and book the vacation" → 1 item (sequential steps of one task)
- "pack, load, and drive to the cabin" → 1 item (one process)
- "review the contract and the addendum" → 1 item (same verb, multiple objects)
- "plant tomatoes with basil as companion plants" → 1 idea (one concept)

### Project Reference Inheritance

When a project reference appears at the end of a multi-item message, it applies to ALL items:

```
Order spark plugs and clean the carburetor for the boat engine project
```

Both tasks get linked to "Restore an old boat engine" project.

### OmniFocus Integration

Each task in a multi-item message:
- Gets sent as a separate email to OmniFocus
- Includes the project name in the email body (for manual association)
- Includes `SB-Project: sb-xxxxxxx` metadata for automation

### Fail-Forward Processing

If one item fails, the others still process. You'll see which succeeded and which failed:

```
Processed 2 items:
• ✓ Order spark plugs → task
• ❌ Invalid item → Failed: validation error
1 succeeded, 1 failed
```

## Conversation Context

The agent remembers context within a conversation window (default: 1 hour).

This means:
- Clarification responses are linked to the original message
- You can reference "that" or "it" in follow-up messages
- Context is cleared after successful processing

## Viewing Your Knowledge Base

### Clone the Repository

```bash
git clone codecommit::<region>://second-brain-knowledge
cd second-brain-knowledge
```

### Repository Structure

```
second-brain-knowledge/
├── 00-inbox/           # Daily capture files
│   ├── 2024-01-15.md
│   └── 2024-01-16.md
├── 10-ideas/           # Atomic idea notes (with front matter)
│   ├── 2024-01-15__garage-gym-conversion__sb-a7f3c2d.md
│   └── 2024-01-16__sunday-meal-prep__sb-b8e4d3f.md
├── 20-decisions/       # Decision records (with front matter)
│   ├── 2024-01-15__blue-paint-living-room__sb-c9f5e4a.md
│   └── 2024-01-16__fifteen-year-mortgage__sb-d0a6f5b.md
├── 30-projects/        # Project pages (with front matter)
│   └── 2024-01-10__kitchen-renovation__sb-e1b7g6c.md
├── 90-receipts/        # Processing receipts (JSON Lines)
│   └── receipts.jsonl
└── system/             # System configuration
    └── agent-system-prompt.md
```

## SB_ID (Canonical Identifiers)

Every idea, decision, and project is assigned a unique canonical identifier (SB_ID) in the format `sb-<7-char-hex>` (e.g., `sb-a7f3c2d`).

**Benefits:**
- Stable links that survive file renames
- Cross-reference items using wikilinks: `[[sb-a7f3c2d]]`
- OmniFocus tasks include SB-ID for linking back to repo items

## Front Matter

Ideas, decisions, and projects include YAML front matter:

```yaml
---
id: sb-a7f3c2d
type: idea
title: "Garage Gym Conversion"
created_at: 2024-01-15T10:30:00Z
tags:
  - home
  - fitness
source:
  channel: D01234567
  message_ts: "1705312200.000100"
---
```

Projects also include a `status` field:

```yaml
---
id: sb-b8e4d3f
type: project
title: "Kitchen Renovation"
created_at: 2024-01-10T09:00:00Z
status: active
tags:
  - home
  - renovation
source:
  channel: D01234567
  message_ts: "1704877200.000200"
---
```

### Front Matter Fields

| Field | Description |
|-------|-------------|
| `id` | Unique SB_ID (e.g., `sb-a7f3c2d`) |
| `type` | Classification: idea, decision, or project |
| `title` | Human-readable title |
| `created_at` | ISO-8601 creation timestamp |
| `updated_at` | ISO-8601 timestamp (added on fix/update) |
| `status` | Project status: active, on-hold, complete, cancelled |
| `tags` | 2-4 auto-extracted tags for discoverability |
| `source` | Slack channel and message timestamp for traceability |

This enables:
- Better search relevance (tag matching)
- Obsidian compatibility
- Structured metadata for future tooling
- Project status tracking and queries

## Related Items

When you create a new idea, decision, or project, the system automatically finds related items that share the same tags and adds a "Related" section:

```markdown
## Related

- [[sb-a7f3c2d|Garage Gym Conversion]] (home, fitness)
- [[sb-b8e4d3f|Home Office Setup]] (home)
```

This creates organic connections between your knowledge items without any manual linking. The related items are:
- Found by matching auto-extracted tags
- Limited to 5 most relevant items
- Displayed as wikilinks with the matching tags shown

### Syncing Changes

The repository is updated in real-time. Pull to see latest changes:

```bash
git pull
```

## Receipts

Every processed message creates a receipt in `90-receipts/receipts.jsonl`.

Receipts include:
- Event ID and timestamp
- Classification and confidence
- Files created/modified
- Commit ID
- System prompt hash (for reproducibility)

## Tips and Tricks

### Updating the System Prompt

To update the system prompt and force Lambda to reload it:

```bash
# Edit system/agent-system-prompt.md, then:
./scripts/update-prompt.sh
```

This safely:
1. Pushes the prompt to the knowledge repo
2. Increments DEPLOY_VERSION while preserving all other Lambda env vars
3. Forces Lambda to reload the prompt on next invocation

**Warning:** Never use `aws lambda update-function-configuration` directly to bump DEPLOY_VERSION - it replaces ALL environment variables and will break the Lambda.

### Quick Inbox Entry

For rapid capture, just send short notes:
```
Call mom
Water the plants
Pick up prescription
```

These go to inbox by default.

### Explicit Classification

Force a specific classification by being explicit:
```
Idea: convert the spare room into a home office
Decision: going with hardwood floors instead of carpet
Project: Plan Sarah's surprise birthday party
```

### Task with Context

Add context to tasks for better OmniFocus entries:
```
I need to call the insurance company about the water damage claim - they said to reference case #12345
```

This creates a task with rich context in the note field.

### Batch Processing

Send multiple messages quickly - each is processed independently:
```
Remember to water plants
Idea: automate plant watering with drip system
Task: buy plant watering timer
```
