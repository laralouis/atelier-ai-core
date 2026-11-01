
/**
 * ATELIER AI – Spezialisierte Lernmodule
 * Version 0.1
 */

export const MODULE_DEFINITIONS = {
  learning: {
    name: "Lernstudio",
    purpose: "Themen verstehen und Wissen festigen",
    tasks: ["explain", "summarize", "practice"]
  },

  exams: {
    name: "Probeprüfungen",
    purpose: "Prüfungssituationen simulieren und auswerten",
    tasks: ["exam", "evaluate", "feedback"]
  },

  tutor: {
    name: "Lernassistent",
    purpose: "Individuelle Lernbegleitung",
    tasks: ["ask", "quiz", "solve", "review"]
  },

  writing: {
    name: "Schreibatelier",
    purpose: "Texte planen, verfassen und verbessern",
    tasks: ["outline", "draft", "analyze", "revise"]
  },

  laboratory: {
    name: "3D-Labor",
    purpose: "Komplexe Sachverhalte räumlich darstellen",
    tasks: ["visualize", "describe", "model"]
  },

  music: {
    name: "Musiklabor",
    purpose: "Musiktheorie, Analyse und Hörverständnis",
    tasks: ["theory", "analysis", "composition"]
  }
};

export class ModuleRouter {
  getModule(moduleId) {
    const module = MODULE_DEFINITIONS[moduleId];

    if (!module) {
      throw new Error("Unbekanntes ATELIER-Modul.");
    }

    return module;
  }

  listModules() {
    return Object.entries(MODULE_DEFINITIONS).map(
      ([id, module]) => ({
        id,
        ...module
      })
    );
  }

  findModuleForTask(task) {
    return Object.entries(MODULE_DEFINITIONS)
      .filter(([, module]) => module.tasks.includes(task))
      .map(([id, module]) => ({
        id,
        name: module.name
      }));
  }
}

export const moduleRouter = new ModuleRouter();
