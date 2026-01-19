# Usage Guide

Learn how to effectively use the Second Brain Agent to capture and organize your thoughts.

## Quick Start

Send a direct message to your Slack bot. The agent will:
1. Classify your message
2. Store it appropriately (or send to OmniFocus for tasks)
3. Reply with confirmation

## Message Classification

The agent classifies messages into five categories:

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

For best results, send one thought at a time:

❌ `Idea about caching, also need to call John, and decided on React`
✅ Send three separate messages

### Review Your Inbox

Periodically review `00-inbox/` and promote items to ideas, decisions, or projects.

## Conversation Context

The agent remembers context within a conversation window (default: 1 hour).

This means:
- Clarification responses are linked to the original message
- You can reference "that" or "it" in follow-up messages
- Context is cleared after successful processing

## Viewing Your Knowledge Base

### Clone the Repository

```bash
git clone codecommit::us-east-1://second-brain-knowledge
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

This enables:
- Better search relevance (tag matching)
- Obsidian compatibility
- Structured metadata for future tooling

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
