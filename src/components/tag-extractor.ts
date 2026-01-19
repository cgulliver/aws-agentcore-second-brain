/**
 * Tag Extractor Component
 *
 * Extracts 2-4 relevant tags from content for knowledge artifacts.
 * Uses simple keyword frequency analysis without NLP/ML.
 *
 * Validates: Requirements 4.1, 4.3, 4.4, 4.5
 */

/**
 * Configuration for tag extraction
 */
export interface TagExtractorConfig {
  minTags: number;
  maxTags: number;
  minWordLength: number;
}

/**
 * Default configuration
 */
export const DEFAULT_TAG_CONFIG: TagExtractorConfig = {
  minTags: 2,
  maxTags: 4,
  minWordLength: 3,
};

/**
 * Common stop words excluded from tag extraction
 * Validates: Requirements 4.4
 */
export const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
  'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it',
  'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'just', 'about', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'any', 'also', 'been',
  'being', 'because', 'until', 'while', 'against', 'each', 'few',
  'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same',
  'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don',
  'should', 'now', 'd', 'll', 'm', 'o', 're', 've', 'y', 'ain', 'aren',
  'couldn', 'didn', 'doesn', 'hadn', 'hasn', 'haven', 'isn', 'ma',
  'mightn', 'mustn', 'needn', 'shan', 'shouldn', 'wasn', 'weren',
  'won', 'wouldn', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'me', 'him', 'us', 'them', 'myself', 'yourself', 'himself', 'herself',
  'itself', 'ourselves', 'themselves', 'am', 'going', 'get', 'got',
  'make', 'made', 'take', 'took', 'come', 'came', 'go', 'went', 'see',
  'saw', 'know', 'knew', 'think', 'thought', 'want', 'wanted', 'use',
  'used', 'find', 'found', 'give', 'gave', 'tell', 'told', 'work',
  'worked', 'call', 'called', 'try', 'tried', 'ask', 'asked', 'need',
  'needed', 'feel', 'felt', 'become', 'became', 'leave', 'left', 'put',
  'mean', 'meant', 'keep', 'kept', 'let', 'begin', 'began', 'seem',
  'seemed', 'help', 'helped', 'show', 'showed', 'hear', 'heard', 'play',
  'played', 'run', 'ran', 'move', 'moved', 'live', 'lived', 'believe',
  'believed', 'bring', 'brought', 'happen', 'happened', 'write', 'wrote',
  'provide', 'provided', 'sit', 'sat', 'stand', 'stood', 'lose', 'lost',
  'pay', 'paid', 'meet', 'met', 'include', 'included', 'continue',
  'continued', 'set', 'learn', 'learned', 'change', 'changed', 'lead',
  'led', 'understand', 'understood', 'watch', 'watched', 'follow',
  'followed', 'stop', 'stopped', 'create', 'created', 'speak', 'spoke',
  'read', 'allow', 'allowed', 'add', 'added', 'spend', 'spent', 'grow',
  'grew', 'open', 'opened', 'walk', 'walked', 'win', 'won', 'offer',
  'offered', 'remember', 'remembered', 'love', 'loved', 'consider',
  'considered', 'appear', 'appeared', 'buy', 'bought', 'wait', 'waited',
  'serve', 'served', 'die', 'died', 'send', 'sent', 'expect', 'expected',
  'build', 'built', 'stay', 'stayed', 'fall', 'fell', 'cut', 'reach',
  'reached', 'kill', 'killed', 'remain', 'remained', 'suggest',
  'suggested', 'raise', 'raised', 'pass', 'passed', 'sell', 'sold',
  'require', 'required', 'report', 'reported', 'decide', 'decided',
  'pull', 'pulled',
]);

/**
 * Domain-generic words excluded from tags
 * Validates: Requirements 4.4
 */
export const GENERIC_TERMS = new Set([
  'thing', 'things', 'stuff', 'note', 'notes', 'idea', 'ideas',
  'decision', 'decisions', 'project', 'projects', 'task', 'tasks',
  'item', 'items', 'point', 'points', 'thought', 'thoughts',
  'something', 'anything', 'everything', 'nothing', 'someone',
  'anyone', 'everyone', 'nobody', 'somewhere', 'anywhere', 'everywhere',
  'nowhere', 'way', 'ways', 'time', 'times', 'day', 'days', 'week',
  'weeks', 'month', 'months', 'year', 'years', 'today', 'tomorrow',
  'yesterday', 'now', 'later', 'soon', 'always', 'never', 'sometimes',
  'often', 'usually', 'really', 'actually', 'basically', 'probably',
  'maybe', 'perhaps', 'definitely', 'certainly', 'clearly', 'simply',
  'example', 'examples', 'case', 'cases', 'part', 'parts', 'place',
  'places', 'person', 'people', 'man', 'men', 'woman', 'women',
  'child', 'children', 'world', 'life', 'hand', 'hands', 'side',
  'sides', 'number', 'numbers', 'fact', 'facts', 'issue', 'issues',
  'question', 'questions', 'answer', 'answers', 'problem', 'problems',
  'reason', 'reasons', 'result', 'results', 'end', 'ends', 'start',
  'starts', 'kind', 'kinds', 'sort', 'sorts', 'type', 'types',
  'lot', 'lots', 'bit', 'bits', 'piece', 'pieces', 'area', 'areas',
  'level', 'levels', 'order', 'orders', 'line', 'lines', 'word',
  'words', 'name', 'names', 'home', 'house', 'room', 'rooms',
]);

/**
 * Tokenize content into words
 */
function tokenize(text: string): string[] {
  // Remove markdown syntax, URLs, and special characters
  const cleaned = text
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/`[^`]+`/g, '') // Remove inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Extract link text
    .replace(/https?:\/\/[^\s]+/g, '') // Remove URLs
    .replace(/[#*_~`>\-|]/g, ' ') // Remove markdown chars
    .replace(/[^\w\s-]/g, ' ') // Remove punctuation except hyphens
    .toLowerCase();

  // Split into words
  return cleaned.split(/\s+/).filter((word) => word.length > 0);
}

/**
 * Check if a word is a valid tag candidate
 */
function isValidTagCandidate(word: string, minLength: number): boolean {
  if (word.length < minLength) return false;
  if (word.length > 30) return false; // Max tag length
  if (STOP_WORDS.has(word)) return false;
  if (GENERIC_TERMS.has(word)) return false;
  if (/^\d+$/.test(word)) return false; // Pure numbers
  if (/^[a-f0-9]{7,}$/.test(word)) return false; // Hex strings (like SB_IDs)
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(word)) return false; // Must start with letter, then alphanumeric with hyphens
  return true;
}

/**
 * Normalize a word to tag format
 * Validates: Requirements 4.3
 */
function normalizeToTag(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '') // Remove non-alphanumeric except hyphens
    .replace(/^-+|-+$/g, '') // Trim leading/trailing hyphens
    .replace(/-+/g, '-'); // Collapse multiple hyphens
}

/**
 * Extract tags from content
 *
 * Algorithm:
 * 1. Combine title and content
 * 2. Tokenize into words, convert to lowercase
 * 3. Filter out stop words and words < minLength
 * 4. Count word frequency
 * 5. Filter out generic terms
 * 6. Take top N words by frequency (where N is between minTags and maxTags)
 *
 * @param content - The markdown content to analyze
 * @param title - Optional title for additional context
 * @param config - Optional configuration overrides
 * @returns Array of 2-4 lowercase hyphenated tags
 *
 * Validates: Requirements 4.1, 4.3, 4.5
 */
export function extractTags(
  content: string,
  title?: string,
  config?: Partial<TagExtractorConfig>
): string[] {
  const cfg = { ...DEFAULT_TAG_CONFIG, ...config };

  // Handle edge cases
  if (typeof content !== 'string') {
    return [];
  }

  // Combine title and content, giving title words more weight
  const combinedText = title ? `${title} ${title} ${content}` : content;

  if (combinedText.trim().length < 10) {
    return [];
  }

  // Tokenize
  const words = tokenize(combinedText);

  // Count frequency of valid candidates
  const frequency = new Map<string, number>();
  for (const word of words) {
    const normalized = normalizeToTag(word);
    if (isValidTagCandidate(normalized, cfg.minWordLength)) {
      frequency.set(normalized, (frequency.get(normalized) || 0) + 1);
    }
  }

  // Sort by frequency descending
  const sorted = Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word);

  // Return between minTags and maxTags
  if (sorted.length === 0) {
    return [];
  }

  // If we have fewer than minTags, return what we have
  if (sorted.length < cfg.minTags) {
    return sorted;
  }

  // Return up to maxTags
  return sorted.slice(0, cfg.maxTags);
}

/**
 * Check if a tag is valid format
 * Validates: Requirements 4.3
 */
export function isValidTag(tag: string): boolean {
  if (typeof tag !== 'string') return false;
  if (tag.length < 1 || tag.length > 30) return false;
  // Must start with a letter, then alphanumeric with optional hyphens
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(tag);
}
