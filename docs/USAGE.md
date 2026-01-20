# Usage Guide

Learn how to effectively use the Second Brain Agent to capture and organize your thoughts.

## Quick Start

Send a direct message to your Slack bot. The agent will:
1. Classify your message
2. Store it appropriately (or send to OmniFocus for tasks)
3. Reply with confirmation

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
I have an idea: what if we used webhooks instead of polling?
Interesting thought - the bottleneck might be in the database layer
```

**Storage:** `10-ideas/YYYY-MM-DD__<slug>__<SB_ID>.md` (one file per idea, with front matter)

### Decision

Explicit choices or commitments you've made.

**Trigger words:** "decided", "decision", "I've chosen", "going with", "will use"

**Examples:**
```
I've decided to use PostgreSQL for the new project
Decision: we're going with the monthly subscription model
```

**Storage:** `20-decisions/YYYY-MM-DD__<slug>__<SB_ID>.md` (with front matter)

### Project

Multi-step initiatives or ongoing work.

**Trigger words:** "project", "initiative", "starting", "working on"

**Examples:**
```
Starting a new project: Website Redesign. Goal is to modernize the UI by Q2.
Project update: Kitchen renovation is 50% complete
```

**Storage:** `30-projects/YYYY-MM-DD__<slug>__<SB_ID>.md` (with front matter)

### Task

Actionable items that should go to your task manager.

**Trigger words:** "need to", "have to", "must", "should", "todo", "task"

**Examples:**
```
I need to call the insurance company about the claim
Task: review the pull request before end of day
```

**Destination:** OmniFocus via Mail Drop email (includes SB-ID in task notes for linking)

**Audit Trail:** Tasks are also logged to `00-inbox/YYYY-MM-DD.md` with format:
```
- HH:MM: [task] Task title (Project: Project Name)
```

### Status Update

Change the status of an existing project.

**Trigger patterns:** "[project] is complete", "pause [project]", "resume [project]", "cancel [project]"

**Examples:**
```
Home automation is complete
Pause the kitchen renovation
Resume the website redesign
```

**Action:** Updates the project file's front matter `status` field

## Project Status Management

Update project status using natural language commands. The system tracks four status values: `active`, `on-hold`, `complete`, and `cancelled`.

### Updating Status

Simply tell the bot about the project's new state:

```
Home automation is complete
Pause the kitchen renovation
Resume the website redesign
Cancel the Q1 marketing project
Mark second brain as on-hold
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
Updated Home Automation Dashboard Project (sb-79ccaa5) status to complete
```

### Project Matching

The system uses fuzzy matching to find the right project. If multiple projects match your reference, it will ask for clarification. If no project is found, you'll see:
```
Could not find a project matching "kitchen renovation"
```

### Querying by Status

Ask about projects by status:
```
What projects are active?
Show me on-hold projects
Which projects are complete?
```

## Task-Project Linking

Tasks can be automatically linked to existing projects using natural language references.

### How It Works

When you mention a project in your task message, the agent:
1. Detects the project reference
2. Searches your knowledge base for matching projects
3. Auto-links if a confident match is found (≥70% confidence)
4. Includes the project's SB_ID in the email to OmniFocus

### Supported Patterns

```
Task for <project>: <task description>
Add to <project>: <task description>
<project> task: <task description>
<task description> for the <project>
```

### Examples

```
Task for home automation: Research smart home protocols
→ Links to "Home Automation Dashboard Project" (sb-79ccaa5)

Add to website redesign: Create wireframes
→ Links to "Website Redesign" project

home automation task: Order Zigbee hub
→ Partial match links to "Home Automation Dashboard Project"

Task: Buy groceries
→ Standalone task (no project reference)

Task for kitchen renovation: Get quotes
→ Standalone task (no matching project found)
```

### Confirmation Messages

When a task is linked to a project, you'll see:
```
Captured as task
Task sent to OmniFocus, linked to project: Home Automation Dashboard Project (sb-79ccaa5)
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

### Examples

```
fix: change the title to "Q2 Budget Review"
fix: add a note about the deadline being flexible
fix: remove the last bullet point
fix: this should have been classified as a decision
```

### Limitations

- Can only fix the most recent non-task entry
- Cannot fix tasks (they're already sent to OmniFocus)
- Cannot fix clarification requests

## Best Practices

### Be Specific

The more context you provide, the better the classification:

❌ `meeting`
✅ `I decided to schedule weekly team meetings on Tuesdays at 10am`

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

I decided to use PostgreSQL and I need to set up the database
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
Upload the code to GitHub and write the blog post for the second brain project
→ Processed 2 items:
  • ✓ Upload code to GitHub → task (Second Brain System Project)
  • ✓ Write the blog post → task (Second Brain System Project)
```

**Mixed classification types:**
```
I decided to use PostgreSQL and I need to set up the database
→ Processed 2 items:
  • Database Technology Decision → decision
  • ✓ Set Up PostgreSQL Database → task
```

**Multiple decisions:**
```
I decided to use PostgreSQL and I decided to go with monthly billing
→ Processed 2 items:
  • Database Technology Decision → decision
  • Billing Model Decision → decision
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
- "research and write the report" → 1 item (sequential steps of one task)
- "download, install, and configure the tool" → 1 item (one process)
- "review the code and the tests" → 1 item (same verb, multiple objects)
- "use caching with Redis and Memcached fallback" → 1 idea (one concept)

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
• ✓ Upload code → task
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
│   ├── 2024-01-15__webhook-caching__sb-a7f3c2d.md
│   └── 2024-01-16__team-standup-format__sb-b8e4d3f.md
├── 20-decisions/       # Decision records (with front matter)
│   ├── 2024-01-15__use-postgresql__sb-c9f5e4a.md
│   └── 2024-01-16__monthly-pricing__sb-d0a6f5b.md
├── 30-projects/        # Project pages (with front matter)
│   └── 2024-01-10__website-redesign__sb-e1b7g6c.md
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
title: "Webhook Caching Strategy"
created_at: 2024-01-15T10:30:00Z
tags:
  - caching
  - webhooks
---
```

Projects also include a `status` field:

```yaml
---
id: sb-b8e4d3f
type: project
title: "Home Automation Dashboard"
created_at: 2024-01-10T09:00:00Z
status: active
tags:
  - automation
  - home
---
```

This enables:
- Better search relevance (tag matching)
- Obsidian compatibility
- Structured metadata for future tooling
- Project status tracking and queries

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

### Quick Inbox Entry

For rapid capture, just send short notes:
```
Call mom
Check server logs
Review PR #123
```

These go to inbox by default.

### Explicit Classification

Force a specific classification by being explicit:
```
Idea: use Redis for session storage
Decision: going with AWS over GCP
Project: Q2 Marketing Campaign
```

### Task with Context

Add context to tasks for better OmniFocus entries:
```
I need to review the contract from Acme Corp - they sent it yesterday and want feedback by Friday
```

This creates a task with rich context in the note field.

### Batch Processing

Send multiple messages quickly - each is processed independently:
```
Remember to water plants
Idea: automate plant watering
Task: buy plant watering system
```
