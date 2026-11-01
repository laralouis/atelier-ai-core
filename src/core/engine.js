
/**
 * ATELIER AI – Lern-Engine
 * Verbindet KI, Wissensbasis und Module.
 */

import { atelierAI } from "./ai.js";
import { knowledgeBase } from "./knowledge.js";
import { moduleRouter } from "./modules.js";

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
    level = "grundlegend"
  }) {
    const module = moduleRouter.getModule(moduleId);

    if (!module.tasks.includes(task)) {
      throw new Error(
        `Die Aufgabe ${task} ist für ${module.name} nicht vorgesehen.`
      );
    }

    const mode = TASK_MODES[task];

    if (!mode) {
      throw new Error(
        "Diese Aufgabe benötigt noch eine eigene Lernlogik."
      );
    }

    // Passende Lernmaterialien suchen
    const materials = await knowledgeBase.search(
      question,
      subject
    );

    // Anfrage für den KI-Kern vorbereiten
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

    // Anfrage an den konfigurierten Anbieter übergeben
    const result = await atelierAI.ask(request);

    return {
      module: module.name,
      subject,
      task,
      sources: materials.map(item => item.title),
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
