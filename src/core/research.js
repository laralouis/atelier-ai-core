
/**
 * ATELIER AI – Research Policy
 * Automatische Recherche und Quellenbewertung
 */

const TRUSTED_DOMAINS = {
  scientific: [
    "nature.com",
    "science.org",
    "sciencedirect.com",
    "springer.com",
    "pubmed.ncbi.nlm.nih.gov",
    "arxiv.org",
    "doi.org",
    "crossref.org",
    "openalex.org"
  ],

  education: [
    "kmk.org",
    "bayern.de",
    "lehrer-online.de",
    "bildungsserver.de",
    "planet-schule.de",
    "bpb.de"
  ],

  institutions: [
    "destatis.de",
    "dwd.de",
    "umweltbundesamt.de",
    "rki.de",
    "who.int",
    "un.org",
    "europa.eu",
    "unesco.org"
  ]
};

function matchesDomain(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

export class ResearchPolicy {
  /**
   * Entscheidet, ob externe Recherche sinnvoll ist.
   */
  shouldResearch({
    question,
    localMatches = [],
    force = false
  }) {
    if (force) return true;

    const text = String(question || "").toLowerCase();

    const currentInformation = [
      "aktuell",
      "heute",
      "2026",
      "neueste",
      "derzeit",
      "momentan",
      "aktuelle zahlen",
      "neue studie"
    ];

    const verification = [
      "quelle",
      "beleg",
      "studie",
      "wissenschaftlich",
      "nachweis",
      "vergleich",
      "forschung"
    ];

    const asksForResearch = [
      "recherchiere",
      "recherchier",
      "im internet",
      "externe quellen"
    ];

    if (
      currentInformation.some(term => text.includes(term)) ||
      verification.some(term => text.includes(term)) ||
      asksForResearch.some(term => text.includes(term))
    ) {
      return true;
    }

    // Bei ausreichenden eigenen Materialien
    // ist eine externe Recherche nicht immer nötig.
    return localMatches.length === 0;
  }

  /**
   * Bewertet die Herkunft einer Quelle.
   * Eine Domain allein garantiert keine Qualität.
   */
  evaluateSource(rawUrl) {
    try {
      const url = new URL(rawUrl);

      if (url.protocol !== "https:") {
        return {
          accepted: false,
          level: "rejected",
          reason: "Keine sichere HTTPS-Adresse."
        };
      }

      const host = url.hostname.toLowerCase();

      for (const [category, domains] of Object.entries(
        TRUSTED_DOMAINS
      )) {
        if (domains.some(domain => matchesDomain(host, domain))) {
          return {
            accepted: true,
            level: "preferred",
            category,
            host,
            reason: "Domain gehört zu einer bevorzugten Quellenliste."
          };
        }
      }

      return {
        accepted: true,
        level: "unverified",
        category: "other",
        host,
        reason: "Quelle muss zusätzlich geprüft werden."
      };
    } catch {
      return {
        accepted: false,
        level: "rejected",
        reason: "Ungültige URL."
      };
    }
  }

  /**
   * Entfernt ungeeignete und doppelte Suchergebnisse.
   */
  filterResults(results = []) {
    const seen = new Set();

    return results
      .filter(result => {
        if (!result.url || !result.title) return false;

        const evaluation = this.evaluateSource(result.url);

        if (!evaluation.accepted) return false;

        const key = new URL(result.url).hostname +
          new URL(result.url).pathname;

        if (seen.has(key)) return false;
        seen.add(key);

        result.sourceQuality = evaluation.level;
        result.sourceCategory = evaluation.category;

        return true;
      })
      .sort((a, b) => {
        const rank = {
          preferred: 2,
          unverified: 1,
          rejected: 0
        };

        return rank[b.sourceQuality] - rank[a.sourceQuality];
      });
  }
}

export const researchPolicy = new ResearchPolicy();
