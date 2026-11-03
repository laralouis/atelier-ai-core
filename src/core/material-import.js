
/**
 * ATELIER AI – Material Import
 * Version 0.3
 *
 * Strukturierter Import von PDF und TXT mit automatischer Extraktion
 * von Schlüsselbegriffen. Erhält möglichst:
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

export class MaterialImporter {

  async importFile(file) {
    if (!file) {
      throw new Error("Keine Datei ausgewählt.");
    }

    const extension = file.name
      .split(".")
      .pop()
      .toLowerCase();

    let content = "";
    let pageCount = null;

    if (extension === "txt") {
      content = await this.extractTXT(file);
    } else if (extension === "pdf") {
      const result = await this.extractPDF(file);
      content = result.content;
      pageCount = result.pageCount;
    } else {
      throw new Error(
        "Unterstützt werden zunächst PDF und TXT."
      );
    }

    content = this.cleanText(content);

    if (!content.trim()) {
      throw new Error(
        "Die Datei enthält keinen lesbaren Text."
      );
    }

    const concepts = this.extractConcepts(content);
    const summary = this.extractSummary(content);

    return {
      title: file.name,
      content,
      concepts,
      summary,
      fileType: extension,
      size: file.size,
      pageCount,
      importedAt: new Date().toISOString()
    };
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
   */
  async extractPDF(file) {

    const pdfjs = await import(
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs"
    );

    pdfjs.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

    const buffer = await file.arrayBuffer();

    const pdf = await pdfjs.getDocument({
      data: buffer
    }).promise;

    const pages = [];

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

      pages.push(
        `--- Seite ${pageNumber} ---\n\n${pageText}`
      );
    }

    return {
      content: pages.join("\n\n"),
      pageCount: pdf.numPages
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
