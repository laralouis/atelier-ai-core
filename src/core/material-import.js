
/**
 * ATELIER AI – Material Import
 * Version 0.4
 *
 * Strukturierter Import von PDF, TXT und Bildern (JPG, PNG, HEIC).
 * Enthält jetzt eine OCR-Stufe (Tesseract.js) für gescannte und
 * handschriftliche Seiten – pdf.js liefert bei solchen Seiten keinen
 * oder nur sehr spärlichen Text, dann rendern wir die Seite in ein
 * Canvas und erkennen den Text per OCR.
 *
 * Erhält möglichst:
 * - Überschriften
 * - Absätze
 * - Stichpunkte
 * - Nummerierungen
 * - Seitenumbrüche
 * - Zeilenreihenfolge
 *
 * Zusätzlich: concepts[]-Liste mit Schlüsselbegriffen, die die
 * Wissensbasis bei der Suche bevorzugt bewertet.
 */

const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

// Unter dieser Zeichenzahl pro Seite nehmen wir an, dass die Seite
// gescannt oder handschriftlich ist, und schalten OCR dazu.
const OCR_PAGE_THRESHOLD = 60;

let tesseractScriptPromise = null;

/**
 * Lädt Tesseract.js aus dem CDN (nur einmal pro Session) und
 * gibt das globale `Tesseract`-Objekt zurück.
 */
function loadTesseract() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("OCR ist nur im Browser verfügbar."));
  }

  if (window.Tesseract) {
    return Promise.resolve(window.Tesseract);
  }

  if (!tesseractScriptPromise) {
    tesseractScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = TESSERACT_URL;
      script.async = true;
      script.onload = () => {
        if (window.Tesseract) {
          resolve(window.Tesseract);
        } else {
          reject(new Error("Tesseract.js wurde geladen, ist aber nicht verfügbar."));
        }
      };
      script.onerror = () => {
        tesseractScriptPromise = null;
        reject(new Error("Tesseract.js konnte nicht geladen werden."));
      };
      document.head.appendChild(script);
    });
  }

  return tesseractScriptPromise;
}

export class MaterialImporter {

  async importFile(file, onProgress = null) {
    if (!file) {
      throw new Error("Keine Datei ausgewählt.");
    }

    const extension = file.name
      .split(".")
      .pop()
      .toLowerCase();

    const report = (phase, detail = {}) => {
      if (typeof onProgress === "function") {
        try { onProgress({ phase, ...detail }); } catch { /* ignore */ }
      }
    };

    let content = "";
    let pageCount = null;
    let usedOCR = false;

    if (extension === "txt") {
      content = await this.extractTXT(file);
    } else if (extension === "pdf") {
      const result = await this.extractPDF(file, report);
      content = result.content;
      pageCount = result.pageCount;
      usedOCR = result.usedOCR;
    } else if (["jpg", "jpeg", "png", "webp", "bmp", "gif", "heic"].includes(extension)) {
      report("ocr-start", { pages: 1 });
      content = await this.extractImageOCR(file, report);
      usedOCR = true;
    } else {
      throw new Error(
        "Unterstützt werden PDF, TXT und Bilddateien (JPG, PNG, HEIC)."
      );
    }

    content = this.cleanText(content);

    if (!content.trim()) {
      throw new Error(
        "Die Datei enthält keinen lesbaren Text. " +
        "Bei handschriftlichen Dokumenten: Bitte in gutem Licht fotografieren und die Schrift möglichst groß und klar halten."
      );
    }

    const concepts = this.extractConcepts(content);
    const summary = this.extractSummary(content);

    report("done", { contentLength: content.length, usedOCR });

    return {
      title: file.name,
      content,
      concepts,
      summary,
      fileType: extension,
      size: file.size,
      pageCount,
      usedOCR,
      importedAt: new Date().toISOString()
    };
  }

  /**
   * OCR für ein einzelnes Bild (JPG, PNG, HEIC …).
   * Nutzt Tesseract.js mit deutschem + englischem Modell.
   */
  async extractImageOCR(file, report) {
    const Tesseract = await loadTesseract();

    const worker = await Tesseract.createWorker(["deu", "eng"], 1, {
      logger: m => {
        if (m.status === "recognizing text") {
          report("ocr-progress", {
            current: 1,
            total: 1,
            percentage: Math.round((m.progress || 0) * 100)
          });
        }
      }
    });

    try {
      const url = URL.createObjectURL(file);
      try {
        const { data: { text } } = await worker.recognize(url);
        return text || "";
      } finally {
        URL.revokeObjectURL(url);
      }
    } finally {
      await worker.terminate();
    }
  }

  /**
   * Zieht Schlüsselbegriffe aus dem Material.
   * Heuristiken:
   * - Fettgedruckte Markdown-Begriffe (**Begriff**, __Begriff__)
   * - Überschriften (Zeilen in Großbuchstaben oder mit # )
   * - Begriffe vor einem Doppelpunkt (Definitionen)
   * - Großgeschriebene Mehrwortgruppen (z. B. "Natürliche Selektion")
   */
  extractConcepts(content) {
    const text = String(content || "");
    const found = new Map();

    const addConcept = (raw, weight = 1) => {
      const term = raw
        .trim()
        .replace(/[*_`"'()\[\]{}]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (term.length < 3 || term.length > 60) return;
      if (/^\d+$/.test(term)) return;

      const key = term.toLowerCase();
      found.set(key, (found.get(key) || 0) + weight);
    };

    // 1. Fettgedruckt
    for (const match of text.matchAll(/\*\*([^*\n]{3,60})\*\*/g)) {
      addConcept(match[1], 3);
    }
    for (const match of text.matchAll(/__([^_\n]{3,60})__/g)) {
      addConcept(match[1], 3);
    }

    // 2. Überschriften (Markdown oder in Großbuchstaben)
    for (const match of text.matchAll(/^#{1,6}\s+(.{3,80})$/gm)) {
      addConcept(match[1], 4);
    }
    for (const match of text.matchAll(/^([A-ZÄÖÜ][A-ZÄÖÜ\s\-]{3,60})$/gm)) {
      addConcept(match[1], 2);
    }

    // 3. Begriffe vor Doppelpunkt (Definitionen)
    for (const match of text.matchAll(/^\s*([A-ZÄÖÜ][\wäöüßÄÖÜ\s\-]{2,40})\s*:/gm)) {
      addConcept(match[1], 2);
    }

    // 4. Großgeschriebene Mehrwortgruppen im Fließtext
    //    (z. B. "Natürliche Selektion", "Erster Weltkrieg")
    const multiWordCapital = text.match(
      /\b[A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+){1,3}\b/g
    ) || [];
    for (const phrase of multiWordCapital) {
      addConcept(phrase, 1);
    }

    return Array.from(found.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(entry => entry[0]);
  }

  /**
   * Erzeugt eine Kurzfassung: die ersten informativen Sätze.
   * Dient als schneller Überblick für die KI, ohne das ganze
   * Dokument zu laden.
   */
  extractSummary(content) {
    const text = String(content || "")
      .replace(/^---\s*Seite\s*\d+\s*---/gm, "")
      .replace(/\s+/g, " ")
      .trim();

    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    const chosen = [];
    let total = 0;

    for (const sentence of sentences) {
      const clean = sentence.trim();
      if (clean.length < 25) continue;
      if (/^(seite|page|kapitel|chapter)\b/i.test(clean)) continue;

      chosen.push(clean);
      total += clean.length;
      if (total > 400 || chosen.length >= 4) break;
    }

    return chosen.join(" ").slice(0, 500);
  }

  /**
   * TXT-Dateien einlesen.
   * Vorhandene Zeilenumbrüche bleiben erhalten.
   */
  async extractTXT(file) {
    const text = await file.text();

    return text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
  }

  /**
   * PDF-Dateien strukturiert auslesen.
   * Erst versucht pdf.js die eingebetteten Textobjekte zu extrahieren.
   * Enthält eine Seite danach nur sehr wenig Text (gescannt oder
   * handschriftlich), rendert sie als Bild und schickt es durch
   * Tesseract-OCR (deu + eng).
   */
  async extractPDF(file, report = () => {}) {

    const pdfjs = await import(PDFJS_URL);

    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

    const buffer = await file.arrayBuffer();

    const pdf = await pdfjs.getDocument({
      data: buffer
    }).promise;

    const pageEntries = [];
    const sparsePages = [];

    report("pdf-text-start", { total: pdf.numPages });

    for (
      let pageNumber = 1;
      pageNumber <= pdf.numPages;
      pageNumber++
    ) {
      const page = await pdf.getPage(pageNumber);

      const textContent = await page.getTextContent();

      const lines = this.groupPDFLines(
        textContent.items
      );

      const pageText = lines.join("\n");

      pageEntries.push({
        pageNumber,
        text: pageText,
        page
      });

      if (pageText.replace(/\s+/g, "").length < OCR_PAGE_THRESHOLD) {
        sparsePages.push(pageNumber);
      }

      report("pdf-text-progress", {
        current: pageNumber,
        total: pdf.numPages
      });
    }

    // OCR-Fallback für Seiten mit wenig/keinem eingebetteten Text.
    let usedOCR = false;
    if (sparsePages.length > 0) {
      usedOCR = true;
      report("ocr-start", { pages: sparsePages.length });

      try {
        const Tesseract = await loadTesseract();

        const worker = await Tesseract.createWorker(["deu", "eng"], 1, {
          logger: m => {
            if (m.status === "recognizing text") {
              report("ocr-progress", {
                percentage: Math.round((m.progress || 0) * 100)
              });
            }
          }
        });

        try {
          for (let i = 0; i < sparsePages.length; i++) {
            const pageNumber = sparsePages[i];
            report("ocr-page", {
              current: i + 1,
              total: sparsePages.length,
              pageNumber
            });

            const entry = pageEntries[pageNumber - 1];
            const viewport = entry.page.getViewport({ scale: 2.0 });

            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);

            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            await entry.page.render({
              canvasContext: ctx,
              viewport
            }).promise;

            const { data: { text } } = await worker.recognize(canvas);
            const ocrText = (text || "").trim();
            if (ocrText) {
              entry.text = ocrText;
            }
          }
        } finally {
          await worker.terminate();
        }
      } catch (ocrError) {
        console.warn("ATELIER AI: OCR fehlgeschlagen, nutze nur pdf.js-Text:", ocrError);
        report("ocr-error", { message: ocrError?.message || String(ocrError) });
      }
    }

    const pages = pageEntries.map(entry =>
      `--- Seite ${entry.pageNumber} ---\n\n${entry.text}`
    );

    return {
      content: pages.join("\n\n"),
      pageCount: pdf.numPages,
      usedOCR
    };
  }

  /**
   * Textbausteine anhand ihrer vertikalen Position
   * zu Zeilen zusammenfassen.
   */
  groupPDFLines(items) {

    const validItems = items
      .filter(item =>
        item.str &&
        item.str.trim().length > 0 &&
        item.transform
      )
      .map(item => ({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width || 0,
        height: item.height || 0
      }));

    // PDF-Koordinaten: oben nach unten sortieren.
    validItems.sort((a, b) => {
      const difference = b.y - a.y;

      if (Math.abs(difference) > 2.5) {
        return difference;
      }

      return a.x - b.x;
    });

    const lines = [];

    for (const item of validItems) {

      let currentLine = lines.find(line =>
        Math.abs(line.y - item.y) <= 2.5
      );

      if (!currentLine) {
        currentLine = {
          y: item.y,
          items: []
        };

        lines.push(currentLine);
      }

      currentLine.items.push(item);
    }

    // Jede Zeile horizontal sortieren.
    return lines
      .sort((a, b) => b.y - a.y)
      .map(line => {

        line.items.sort((a, b) => a.x - b.x);

        let result = "";
        let previous = null;

        for (const item of line.items) {

          const text = item.text.trim();

          if (!text) continue;

          if (previous) {
            const gap =
              item.x -
              (previous.x + previous.width);

            // Bei größeren horizontalen Abständen
            // ein Leerzeichen ergänzen.
            if (gap > 1.5) {
              result += " ";
            }
          }

          result += text;

          previous = item;
        }

        return result.trim();

      })
      .filter(line => line.length > 0);
  }

  /**
   * Text bereinigen, ohne die Dokumentstruktur
   * vollständig zu entfernen.
   */
  cleanText(text) {

    return text
      .replace(/\u0000/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
}

export const materialImporter = new MaterialImporter();
