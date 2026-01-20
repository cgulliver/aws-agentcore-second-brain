/**
 * Markdown Template Generation
 * 
 * Generates formatted markdown content for different classification types.
 * Follows strict style guidelines: headings not bold, bullets over prose,
 * ISO dates, no emojis, source attribution.
 * 
 * Validates: Requirements 31-35, 2.1-2.5, 3.1-3.3
 */

import type { Classification } from '../types';
import { extractTags } from './tag-extractor';

// Template options
export interface TemplateOptions {
  timestamp?: Date;
  source?: {
    userId: string;
    channelId: string;
    messageTs: string;
  };
  sbId?: string; // Canonical SB_ID for front matter
}

/**
 * Source metadata for traceability
 */
export interface SourceMeta {
  channel: string;      // Slack channel ID
  message_ts: string;   // Slack message timestamp
  user?: string;        // Slack user ID (optional for privacy)
}

/**
 * Front matter structure for knowledge artifacts
 * Validates: Requirements 2.1, 2.2, 2.3
 */
export interface FrontMatter {
  id: string;           // SB_ID (e.g., "sb-a7f3c2d")
  type: 'idea' | 'decision' | 'project';
  title: string;        // Human-readable title
  created_at: string;   // ISO-8601 timestamp
  updated_at?: string;  // ISO-8601 timestamp (set on fix/update)
  tags: string[];       // 2-4 extracted tags
  status?: 'active' | 'on-hold' | 'complete' | 'cancelled'; // Project status (projects only)
  source?: SourceMeta;  // Slack source metadata for traceability
}

// Inbox entry structure
export interface InboxEntry {
  text: string;
  timestamp: Date;
  classificationHint?: Classification;
}

// Idea note structure
export interface IdeaNote {
  title: string;
  context: string;
  keyPoints: string[];
  implications?: string[];
  openQuestions?: string[];
}

// Decision note structure
export interface DecisionNote {
  decision: string;
  date: Date;
  rationale: string;
  alternatives?: string[];
  consequences?: string[];
}

// Project page structure
export interface ProjectPage {
  title: string;
  objective: string;
  status: 'active' | 'on-hold' | 'completed' | 'archived';
  keyDecisions?: string[];
  nextSteps?: string[];
  references?: string[];
}

/**
 * Format ISO date (YYYY-MM-DD)
 */
export function formatISODate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Format ISO timestamp (HH:MM)
 */
export function formatISOTime(date: Date): string {
  return date.toISOString().split('T')[1].substring(0, 5);
}

/**
 * Format ISO-8601 timestamp (full)
 */
export function formatISO8601(date: Date): string {
  return date.toISOString();
}

/**
 * Check if classification should have front matter
 * Validates: Requirements 2.4
 */
export function shouldHaveFrontMatter(classification: Classification): boolean {
  return classification === 'idea' || classification === 'decision' || classification === 'project';
}

/**
 * Generate YAML front matter block
 * Validates: Requirements 2.1, 2.2, 2.3, 2.5
 * 
 * @param frontMatter - The front matter data
 * @returns YAML string with --- delimiters
 */
export function generateFrontMatter(frontMatter: FrontMatter): string {
  const lines: string[] = [];
  
  lines.push('---');
  lines.push(`id: ${frontMatter.id}`);
  lines.push(`type: ${frontMatter.type}`);
  lines.push(`title: "${frontMatter.title.replace(/"/g, '\\"')}"`);
  
  // Add status for projects (default to 'active')
  if (frontMatter.type === 'project') {
    lines.push(`status: ${frontMatter.status || 'active'}`);
  }
  
  lines.push(`created_at: ${frontMatter.created_at}`);
  
  // Add updated_at if present (set on fix/update operations)
  if (frontMatter.updated_at) {
    lines.push(`updated_at: ${frontMatter.updated_at}`);
  }
  
  if (frontMatter.tags.length > 0) {
    lines.push('tags:');
    for (const tag of frontMatter.tags) {
      lines.push(`  - ${tag}`);
    }
  } else {
    lines.push('tags: []');
  }
  
  // Add source metadata if present
  if (frontMatter.source) {
    lines.push('source:');
    lines.push(`  channel: ${frontMatter.source.channel}`);
    lines.push(`  message_ts: "${frontMatter.source.message_ts}"`);
  }
  
  lines.push('---');
  lines.push('');
  
  return lines.join('\n');
}

/**
 * Generate filename with SB_ID
 * Validates: Requirements 3.1, 3.2, 3.3
 * 
 * @param date - ISO date string (YYYY-MM-DD)
 * @param slug - Human-readable slug
 * @param sbId - Canonical identifier
 * @returns Filename (e.g., "2025-01-18__wharton-cto-program__sb-a7f3c2d.md")
 */
export function generateFilename(date: string, slug: string, sbId: string): string {
  return `${date}__${slug}__${sbId}.md`;
}

/**
 * Generate a wikilink from an SB_ID
 * Validates: Requirements 5.1, 5.3, 5.4
 * 
 * @param sbId - The canonical identifier (e.g., "sb-a7f3c2d")
 * @param displayText - Optional human-readable text
 * @returns Wikilink string (e.g., "[[sb-a7f3c2d]]" or "[[sb-a7f3c2d|Wharton CTO Program]]")
 */
export function generateWikilink(sbId: string, displayText?: string): string {
  if (!sbId) return '';
  if (displayText) {
    return `[[${sbId}|${displayText}]]`;
  }
  return `[[${sbId}]]`;
}

/**
 * Generate source attribution line
 */
function generateSourceLine(source?: TemplateOptions['source']): string {
  if (!source) {
    return 'Source: Slack DM';
  }
  return `Source: Slack DM (${source.messageTs})`;
}

/**
 * Sanitize text for markdown (remove emojis, normalize whitespace)
 * 
 * Validates: Requirement 31.4 (no emojis)
 */
export function sanitizeForMarkdown(text: string): string {
  // Remove emoji characters (basic emoji ranges)
  const withoutEmoji = text
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // Emoticons
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '') // Misc Symbols and Pictographs
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // Transport and Map
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '') // Flags
    .replace(/[\u{2600}-\u{26FF}]/gu, '')   // Misc symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, '')   // Dingbats
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')   // Variation Selectors
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '') // Supplemental Symbols
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '') // Chess Symbols
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '') // Symbols and Pictographs Extended-A
    .replace(/[\u{231A}-\u{231B}]/gu, '')   // Watch, Hourglass
    .replace(/[\u{23E9}-\u{23F3}]/gu, '')   // Various symbols
    .replace(/[\u{23F8}-\u{23FA}]/gu, '');  // Various symbols

  // Normalize whitespace
  return withoutEmoji.replace(/\s+/g, ' ').trim();
}

/**
 * Generate inbox entry template
 * 
 * Validates: Requirements 32.1-32.3
 * 
 * Format:
 * # YYYY-MM-DD
 * 
 * - HH:MM: Entry text [hint: classification]
 */
export function generateInboxEntry(
  entry: InboxEntry,
  options?: TemplateOptions
): string {
  const date = options?.timestamp || entry.timestamp;
  const time = formatISOTime(entry.timestamp);
  const text = sanitizeForMarkdown(entry.text);
  
  const lines: string[] = [];
  
  // Entry line with timestamp
  let entryLine = `- ${time}: ${text}`;
  
  // Add classification hint if provided
  if (entry.classificationHint && entry.classificationHint !== 'inbox') {
    entryLine += ` [hint: ${entry.classificationHint}]`;
  }
  
  lines.push(entryLine);
  
  return lines.join('\n');
}

/**
 * Generate inbox file header (for new files)
 */
export function generateInboxHeader(date: Date): string {
  return `# ${formatISODate(date)}\n\n`;
}

/**
 * Generate idea note template
 * 
 * Validates: Requirements 33.1, 33.2, 2.1
 * 
 * Format:
 * ---
 * id: sb-xxxxxxx
 * type: idea
 * title: "Title"
 * created_at: ISO-8601
 * tags:
 *   - tag1
 * ---
 * 
 * # Title
 * 
 * ## Context
 * ...
 */
export function generateIdeaNote(
  idea: IdeaNote,
  options?: TemplateOptions
): string {
  const lines: string[] = [];
  const timestamp = options?.timestamp || new Date();
  
  // Generate front matter if sbId is provided
  if (options?.sbId) {
    const content = `${idea.title} ${idea.context} ${idea.keyPoints.join(' ')}`;
    const tags = extractTags(content, idea.title);
    
    const frontMatter: FrontMatter = {
      id: options.sbId,
      type: 'idea',
      title: sanitizeForMarkdown(idea.title),
      created_at: formatISO8601(timestamp),
      tags,
    };
    
    lines.push(generateFrontMatter(frontMatter));
  }
  
  // Title
  lines.push(`# ${sanitizeForMarkdown(idea.title)}`);
  lines.push('');
  
  // Context
  lines.push('## Context');
  lines.push('');
  lines.push(sanitizeForMarkdown(idea.context));
  lines.push('');
  
  // Key Points
  lines.push('## Key Points');
  lines.push('');
  for (const point of idea.keyPoints) {
    lines.push(`- ${sanitizeForMarkdown(point)}`);
  }
  lines.push('');
  
  // Implications (optional)
  if (idea.implications && idea.implications.length > 0) {
    lines.push('## Implications');
    lines.push('');
    for (const impl of idea.implications) {
      lines.push(`- ${sanitizeForMarkdown(impl)}`);
    }
    lines.push('');
  }
  
  // Open Questions (optional)
  if (idea.openQuestions && idea.openQuestions.length > 0) {
    lines.push('## Open Questions');
    lines.push('');
    for (const q of idea.openQuestions) {
      lines.push(`- ${sanitizeForMarkdown(q)}`);
    }
    lines.push('');
  }
  
  // Source
  lines.push('---');
  lines.push(generateSourceLine(options?.source));
  
  return lines.join('\n');
}

/**
 * Generate decision note template
 * 
 * Validates: Requirements 34.1, 34.2, 2.2
 * 
 * Format:
 * ---
 * id: sb-xxxxxxx
 * type: decision
 * title: "Decision Statement"
 * created_at: ISO-8601
 * tags:
 *   - tag1
 * ---
 * 
 * # Decision: Statement
 * 
 * Date: YYYY-MM-DD
 * ...
 */
export function generateDecisionNote(
  decision: DecisionNote,
  options?: TemplateOptions
): string {
  const lines: string[] = [];
  const timestamp = options?.timestamp || decision.date;
  
  // Generate front matter if sbId is provided
  if (options?.sbId) {
    const content = `${decision.decision} ${decision.rationale} ${(decision.alternatives || []).join(' ')} ${(decision.consequences || []).join(' ')}`;
    const tags = extractTags(content, decision.decision);
    
    const frontMatter: FrontMatter = {
      id: options.sbId,
      type: 'decision',
      title: sanitizeForMarkdown(decision.decision),
      created_at: formatISO8601(timestamp),
      tags,
    };
    
    lines.push(generateFrontMatter(frontMatter));
  }
  
  // Title with explicit decision statement
  lines.push(`# Decision: ${sanitizeForMarkdown(decision.decision)}`);
  lines.push('');
  
  // Date
  lines.push(`Date: ${formatISODate(decision.date)}`);
  lines.push('');
  
  // Rationale
  lines.push('## Rationale');
  lines.push('');
  lines.push(sanitizeForMarkdown(decision.rationale));
  lines.push('');
  
  // Alternatives (optional)
  if (decision.alternatives && decision.alternatives.length > 0) {
    lines.push('## Alternatives Considered');
    lines.push('');
    for (const alt of decision.alternatives) {
      lines.push(`- ${sanitizeForMarkdown(alt)}`);
    }
    lines.push('');
  }
  
  // Consequences (optional)
  if (decision.consequences && decision.consequences.length > 0) {
    lines.push('## Consequences');
    lines.push('');
    for (const cons of decision.consequences) {
      lines.push(`- ${sanitizeForMarkdown(cons)}`);
    }
    lines.push('');
  }
  
  // Source
  lines.push('---');
  lines.push(generateSourceLine(options?.source));
  
  return lines.join('\n');
}

/**
 * Generate project page template
 * 
 * Validates: Requirements 35.1, 35.2, 2.3
 * 
 * Format:
 * ---
 * id: sb-xxxxxxx
 * type: project
 * title: "Project Title"
 * created_at: ISO-8601
 * tags:
 *   - tag1
 * ---
 * 
 * # Project: Title
 * 
 * Status: active
 * ...
 */
export function generateProjectPage(
  project: ProjectPage,
  options?: TemplateOptions
): string {
  const lines: string[] = [];
  const timestamp = options?.timestamp || new Date();
  
  // Generate front matter if sbId is provided
  if (options?.sbId) {
    const content = `${project.title} ${project.objective} ${(project.nextSteps || []).join(' ')}`;
    const tags = extractTags(content, project.title);
    
    const frontMatter: FrontMatter = {
      id: options.sbId,
      type: 'project',
      title: sanitizeForMarkdown(project.title),
      created_at: formatISO8601(timestamp),
      tags,
    };
    
    lines.push(generateFrontMatter(frontMatter));
  }
  
  // Title
  lines.push(`# Project: ${sanitizeForMarkdown(project.title)}`);
  lines.push('');
  
  // Status
  lines.push(`Status: ${project.status}`);
  lines.push('');
  
  // Objective
  lines.push('## Objective');
  lines.push('');
  lines.push(sanitizeForMarkdown(project.objective));
  lines.push('');
  
  // Key Decisions (optional)
  if (project.keyDecisions && project.keyDecisions.length > 0) {
    lines.push('## Key Decisions');
    lines.push('');
    for (const dec of project.keyDecisions) {
      // Format as wiki-style link if it looks like an SB_ID
      if (dec.startsWith('sb-')) {
        lines.push(`- [[${dec}]]`);
      } else if (dec.startsWith('20-decisions/')) {
        lines.push(`- [[${dec}]]`);
      } else {
        lines.push(`- ${sanitizeForMarkdown(dec)}`);
      }
    }
    lines.push('');
  }
  
  // Next Steps (optional) - use checkbox syntax for interactive rendering
  if (project.nextSteps && project.nextSteps.length > 0) {
    lines.push('## Next Steps');
    lines.push('');
    for (const step of project.nextSteps) {
      lines.push(`- [ ] ${sanitizeForMarkdown(step)}`);
    }
    lines.push('');
  }
  
  // References (optional)
  if (project.references && project.references.length > 0) {
    lines.push('## References');
    lines.push('');
    for (const ref of project.references) {
      lines.push(`- ${sanitizeForMarkdown(ref)}`);
    }
    lines.push('');
  }
  
  // Source
  lines.push('---');
  lines.push(generateSourceLine(options?.source));
  
  return lines.join('\n');
}

/**
 * Generate content based on classification
 */
export function generateContent(
  classification: Classification,
  data: {
    text: string;
    title?: string;
    context?: string;
    keyPoints?: string[];
    rationale?: string;
    objective?: string;
  },
  options?: TemplateOptions
): string {
  const timestamp = options?.timestamp || new Date();
  
  switch (classification) {
    case 'inbox':
      return generateInboxEntry({
        text: data.text,
        timestamp,
      }, options);
      
    case 'idea':
      return generateIdeaNote({
        title: data.title || 'Untitled Idea',
        context: data.context || data.text,
        keyPoints: data.keyPoints || [data.text],
      }, options);
      
    case 'decision':
      return generateDecisionNote({
        decision: data.title || data.text,
        date: timestamp,
        rationale: data.rationale || data.context || 'Captured from Slack DM',
      }, options);
      
    case 'project':
      return generateProjectPage({
        title: data.title || 'Untitled Project',
        objective: data.objective || data.text,
        status: 'active',
      }, options);
      
    case 'task':
      // Tasks don't generate markdown - they go to OmniFocus
      return '';
      
    default:
      return generateInboxEntry({
        text: data.text,
        timestamp,
      }, options);
  }
}
