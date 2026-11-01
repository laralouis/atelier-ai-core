
/**
 * ATELIER AI – Lern-Engine
 * Verbindet KI, Wissensbasis, Module und Recherche.
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

    // 1. Eigene Lernmaterialien durchsuchen
    const materials = await knowledgeBase.search(
      question,
      subject
    );

    // 2. Prüfen, ob externe Recherche sinnvoll ist
    const shouldResearch = researchPolicy.shouldResearch({
      question,
      localMatches: materials,
      force: forceResearch
    });

    // 3. Anfrage an den KI-Kern vorbereiten
    const request = atelierAI.createRequest({
      subject,
      mode,
      question,
      grade,
      level,
      materials: materials.map(item => ({
        title: item.title,
        content: item.content
      }))
    });

    // Recherchebedarf für den späteren Suchdienst
    request.research = {
      recommended: shouldResearch,
      status: "not_connected"
    };

    // 4. KI-Anfrage ausführen
    const result = await atelierAI.ask(request);

    return {
      module: module.name,
      subject,
      task,
      localSources: materials.map(item => item.title),
      research: {
        recommended: shouldResearch,
        status: "not_connected",
        message: shouldResearch
          ? "Externe Recherche ist sinnvoll, aber noch nicht angeschlossen."
          : "Die lokalen Lernmaterialien reichen zunächst aus."
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
