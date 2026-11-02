
/**
 * ATELIER AI – Lern-Engine
 * Version 0.3
 *
 * Verbindet:
 * - KI-Kern und lokales KI-Modell
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

/**
 * Externe wissenschaftliche Recherche.
 */
async function searchExternalSources(question) {
  const response = await fetch("/api/research", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: question
    })
  });

  if (!response.ok) {
    throw new Error(
      `Recherche fehlgeschlagen: HTTP ${response.status}`
    );
  }

  return await response.json();
}

export class AtelierEngine {

  /**
   * Verarbeitet eine Lernanfrage.
   */
  async learn({
    moduleId = "tutor",
    subject,
    task = "explain",
    question,
    grade = 12,
    level = "grundlegend",
    forceResearch = false
  }) {

    // 1. Eingaben prüfen
    if (
      typeof question !== "string" ||
      !question.trim()
    ) {
      throw new Error("Bitte eine Frage eingeben.");
    }

    // 2. Lernmodul bestimmen
    const module = moduleRouter.getModule(moduleId);

    if (!module.tasks.includes(task)) {
      throw new Error(
        `Die Aufgabe "${task}" ist für das Modul "${module.name}" nicht vorgesehen.`
      );
    }

    // 3. Lernmodus bestimmen
    const mode = TASK_MODES[task];

    if (!mode) {
      throw new Error(
        `Die Aufgabe "${task}" benötigt noch eine eigene Lernlogik.`
      );
    }

    // 4. Lokale Wissensbasis durchsuchen
    const localMaterials = await knowledgeBase.search(
      question,
      subject
    );

    // 5. Recherchebedarf bestimmen
    const shouldResearch = researchPolicy.shouldResearch({
      question,
      localMatches: localMaterials,
      force: forceResearch
    });

    let externalResults = [];
    let researchStatus = "not_needed";
    let researchError = null;

    // 6. Externe Recherche durchführen
    if (shouldResearch) {
      try {
        const searchData = await searchExternalSources(
          question
        );

        externalResults = researchPolicy.filterResults(
          searchData.results || []
        );

        researchStatus = externalResults.length
          ? "completed"
          : "no_results";

        if (searchData.errors?.length) {
          researchError =
            "Einige Rechercheanbieter waren nicht erreichbar.";
        }

      } catch (error) {
        researchStatus = "unavailable";
        researchError = error.message;
      }
    }

    // 7. Externe Quellen als Lernmaterial aufbereiten
    const externalMaterials = externalResults.map(source => ({
      title: source.title,

      content: [
        `Quelle: ${source.provider || "Unbekannt"}`,
        `Autoren: ${(source.authors || []).join(", ")}`,
        `Jahr: ${source.year || "unbekannt"}`,
        `Herausgeber: ${source.publisher || "unbekannt"}`,
        `DOI: ${source.doi || "nicht angegeben"}`,
        `Abstract: ${source.abstract || "Kein Abstract verfügbar."}`,
        `Link: ${source.url}`
      ].join("\n")
    }));

    // 8. KI-Anfrage erstellen
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

    // 9. Rechercheinformationen ergänzen
    request.research = {
      recommended: shouldResearch,
      status: researchStatus
    };

    // 10. Lokale KI ausführen
    const result = await atelierAI.ask(request);

    // 11. Ergebnis zurückgeben
    return {
      module: module.name,
      subject,
      task,

      localSources: localMaterials.map(
        item => item.title
      ),

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

  /**
   * Status des gesamten Systems.
   */
  getSystemStatus() {
    return {
      ai: atelierAI.getStatus(),

      modules: moduleRouter.listModules()
    };
  }
}

export const atelierEngine = new AtelierEngine();
