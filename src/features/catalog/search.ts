const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "with",
]);

/**
 * English stemmer aligning with PostgreSQL Snowball English dictionary
 * for plurals and common suffixes (e.g. hackathons -> hackathon, workshops -> workshop,
 * distributed -> distribut, systems -> system, conferences -> confer).
 */
export function stemEnglishToken(rawToken: string): string {
  let token = rawToken.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (token.length <= 2) {
    return token;
  }

  if (token.endsWith("ies") && token.length > 4) {
    token = `${token.slice(0, -3)}i`;
  } else if (token.endsWith("sses")) {
    token = token.slice(0, -2);
  } else if (token.endsWith("ches") || token.endsWith("shes") || token.endsWith("xes")) {
    token = token.slice(0, -2);
  } else if (token.endsWith("s") && !token.endsWith("ss") && !token.endsWith("us") && !token.endsWith("is")) {
    token = token.slice(0, -1);
  }

  if (token.endsWith("ing") && token.length > 5) {
    token = token.slice(0, -3);
  } else if (token.endsWith("ed") && token.length > 4) {
    token = token.slice(0, -2);
  }

  return token;
}

export function tokenizeAndStemDocument(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length > 0 && !STOP_WORDS.has(tok))
    .map(stemEnglishToken);
}

export interface ParsedCatalogSearchQuery {
  isPlainWordQuery: boolean;
  requiredLexemes: string[];
  excludedLexemes: string[];
  requiredPhrases: string[][];
  excludedPhrases: string[][];
  lastTokenPrefixLexeme: string | null;
}

/**
 * Parses a search query (max 100 chars) following ARCHITECTURE.md:
 * - websearch_to_tsquery('english', q) semantics (quoted phrases, negated terms/phrases, ANDed words)
 * - For plain word queries, also matches the last token as a stemmed prefix when it has
 *   at least 3 characters and yields a single lexeme, while retaining whole-lexeme matches for earlier words.
 */
export function parseCatalogSearchQuery(rawQuery: string): ParsedCatalogSearchQuery | null {
  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > 100) {
    throw new Error("Search query exceeds 100 characters.");
  }

  const isPlainWordQuery = /^[A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)*$/.test(trimmed);

  if (isPlainWordQuery) {
    const rawWords = trimmed.split(/\s+/);
    const lastWord = rawWords[rawWords.length - 1] ?? "";
    const earlierWords = rawWords.slice(0, -1);

    const earlierLexemes = earlierWords
      .map((w) => w.toLowerCase())
      .filter((w) => !STOP_WORDS.has(w))
      .map(stemEnglishToken)
      .filter((w) => w.length > 0);

    const lastLower = lastWord.toLowerCase();
    const lastStemmed = STOP_WORDS.has(lastLower) ? "" : stemEnglishToken(lastLower);

    if (lastWord.length >= 3 && lastStemmed.length > 0 && lastLower !== "or") {
      return {
        isPlainWordQuery: true,
        requiredLexemes: earlierLexemes,
        excludedLexemes: [],
        requiredPhrases: [],
        excludedPhrases: [],
        lastTokenPrefixLexeme: lastStemmed,
      };
    }

    return {
      isPlainWordQuery: true,
      requiredLexemes: [
        ...earlierLexemes,
        ...(lastStemmed ? [lastStemmed] : []),
      ],
      excludedLexemes: [],
      requiredPhrases: [],
      excludedPhrases: [],
      lastTokenPrefixLexeme: null,
    };
  }

  // Websearch syntax parser: handles "quoted phrases", -"negated phrases", -negatedWord, and positive words
  const requiredLexemes: string[] = [];
  const excludedLexemes: string[] = [];
  const requiredPhrases: string[][] = [];
  const excludedPhrases: string[][] = [];

  const tokenRegex = /(-?"[^"]+"|-\S+|\S+)/g;
  const matches = trimmed.match(tokenRegex) ?? [];

  for (const token of matches) {
    if (token.toLowerCase() === "or" || token === "-") {
      continue;
    }

    const isNegated = token.startsWith("-");
    const cleanToken = isNegated ? token.slice(1) : token;

    if (cleanToken.startsWith('"') && cleanToken.endsWith('"') && cleanToken.length >= 2) {
      const phraseContent = cleanToken.slice(1, -1);
      const phraseLexemes = tokenizeAndStemDocument(phraseContent);
      if (phraseLexemes.length > 0) {
        if (isNegated) {
          excludedPhrases.push(phraseLexemes);
        } else {
          requiredPhrases.push(phraseLexemes);
        }
      }
      continue;
    }

    const wordLexemes = tokenizeAndStemDocument(cleanToken);
    for (const lex of wordLexemes) {
      if (isNegated) {
        excludedLexemes.push(lex);
      } else {
        requiredLexemes.push(lex);
      }
    }
  }

  return {
    isPlainWordQuery: false,
    requiredLexemes,
    excludedLexemes,
    requiredPhrases,
    excludedPhrases,
    lastTokenPrefixLexeme: null,
  };
}

function containsContiguousPhrase(docLexemes: string[], phraseLexemes: string[]): boolean {
  if (phraseLexemes.length === 0) {
    return true;
  }
  if (docLexemes.length < phraseLexemes.length) {
    return false;
  }
  for (let i = 0; i <= docLexemes.length - phraseLexemes.length; i++) {
    let allMatch = true;
    for (let j = 0; j < phraseLexemes.length; j++) {
      if (docLexemes[i + j] !== phraseLexemes[j]) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      return true;
    }
  }
  return false;
}

export function matchesCatalogSearchQuery(
  doc: { title: string; organizer: string; summary: string | null },
  parsedQuery: ParsedCatalogSearchQuery | null
): boolean {
  if (!parsedQuery) {
    return true;
  }

  const combinedText = `${doc.title ?? ""} ${doc.organizer ?? ""} ${doc.summary ?? ""}`;
  const docLexemes = tokenizeAndStemDocument(combinedText);
  const docLexemeSet = new Set(docLexemes);

  for (const req of parsedQuery.requiredLexemes) {
    if (!docLexemeSet.has(req)) {
      return false;
    }
  }

  for (const excl of parsedQuery.excludedLexemes) {
    if (docLexemeSet.has(excl)) {
      return false;
    }
  }

  for (const phrase of parsedQuery.requiredPhrases) {
    if (!containsContiguousPhrase(docLexemes, phrase)) {
      return false;
    }
  }

  for (const exclPhrase of parsedQuery.excludedPhrases) {
    if (containsContiguousPhrase(docLexemes, exclPhrase)) {
      return false;
    }
  }

  if (parsedQuery.lastTokenPrefixLexeme) {
    const prefix = parsedQuery.lastTokenPrefixLexeme;
    const hasPrefixMatch = docLexemes.some((lex) => lex.startsWith(prefix));
    if (!hasPrefixMatch) {
      return false;
    }
  }

  return true;
}

/**
 * Geodesic distance in meters between two WGS84 coordinates (city centers).
 * Matches PostGIS ST_Distance / ST_DWithin(50000) behavior.
 */
export function computeCityCenterDistanceMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const R = 6371008.8; // mean Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
