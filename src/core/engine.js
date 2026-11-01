
/**
 * ATELIER AI – Lern-Engine
 * Version 0.2
 *
 * Verbindet:
 * - KI-Kern
 * - Wissensbasis
 * - Lernmodule
 * - Externe Recherche
 */

import { atelierAI } from "./ai.js";
import { knowledgeBase } from "./knowledge.js";
import { moduleRouter } from "./modules.js";
import { researchPolicy } from "./research.js";

const TASK_MODES = {
  explain: "explain",
  quiz: "quiz",
  solve: "solve",
  review: "review"
};

async function searchExternalSources(question) {
  const response = await fetch("/api/research", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query: question })
  });

  if (!response.ok) {
    throw new Error(
      `Recherche fehlgeschlagen: HTTP ${response.status}`
    );
  }

  return await response.json();
}

export class AtelierEngine {
  async learn({
    moduleId = "tutor",
    subject,
    task = "explain",
    question,
    grade = 12,
    level = "grundlegend",
    forceResearch = false
  }) {
    const module = moduleRouter.getModule(moduleId);

    if (!module.tasks.includes(task)) {
      throw new Error(
        `Aufgabe ${task} ist für ${module.name} nicht vorgesehen.`
      );
    }

    const mode = TASK_MODES[task];

    if (!mode) {
      throw new Error(
        "Diese Aufgabe benötigt noch eine eigene Lernlogik."
      );
    }

    // 1. Lokale Materialien durchsuchen
    const localMaterials = await knowledgeBase.search(
      question,
      subject
    );

    // 2. Recherchebedarf ermitteln
    const shouldResearch = researchPolicy.shouldResearch({
      question,
      localMatches: localMaterials,
      force: forceResearch
    });

    let externalResults = [];
    let researchStatus = "not_needed";
    let researchError = null;

    // 3. Bei Bedarf externe Recherche durchführen
    if (shouldResearch) {
      try {
        const searchData = await searchExternalSources(question);

        externalResults = researchPolicy.filterResults(
          searchData.results || []
        );

        researchStatus = externalResults.length
          ? "completed"
          : "no_results";

        if (searchData.errors?.length) {
          researchError = "Einige Suchdienste waren nicht erreichbar.";
        }
      } catch (error) {
        researchStatus = "unavailable";
        researchError = error.message;
      }
    }

    // 4. Externe Quellen als getrennten Kontext ergänzen
    const externalMaterials = externalResults.map(source => ({
      title: source.title,
      content: [
        `Quelle: ${source.provider}`,
        `Autoren: ${(source.authors || []).join(", ")}`,
        `Jahr: ${source.year || "unbekannt"}`,
        `Herausgeber: ${source.publisher || "unbekannt"}`,
        `DOI: ${source.doi || "nicht angegeben"}`,
        `Abstract: ${source.abstract || "Kein Abstract verfügbar."}`,
        `Link: ${source.url}`
      ].join("\n")
    }));

    // 5. KI-Anfrage erstellen
    const request = atelierAI.createRequest({
      subject,
      mode,
      question,
      grade,
      level,
      materials: [
        ...localMaterials.map(item => ({
          title: `[Unterrichtsmaterial] ${item.title}`,
          content: item.content
        })),
        ...externalMaterials.map(item => ({
          title: `[Externe Quelle] ${item.title}`,
          content: item.content
        }))
      ]
    });

    request.research = {
      recommended: shouldResearch,
      status: researchStatus
    };

    // 6. KI ausführen
    const result = await atelierAI.ask(request);

    return {
      module: module.name,
      subject,
      task,

      localSources: localMaterials.map(item => item.title),

      externalSources: externalResults.map(source => ({
        title: source.title,
        authors: source.authors,
        year: source.year,
        publisher: source.publisher,
        doi: source.doi,
        url: source.url,
        provider: source.provider,
        quality: source.sourceQuality
      })),

      research: {
        recommended: shouldResearch,
        status: researchStatus,
        error: researchError
      },

      result
    };
  }

  getSystemStatus() {
    return {
      ai: atelierAI.getStatus(),
      modules: moduleRouter.listModules()
    };
  }
}

export const atelierEngine = new AtelierEngine();
