import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

function fileExtension(file) {
  return file.name.split(".").pop()?.toLowerCase();
}

function checkLength(text, maxLength) {
  if (text.length > maxLength) throw new Error("Use 100,000 characters or fewer.");
  return text;
}

async function extractPdfText(file, maxLength) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loadingTask = pdfjs.getDocument({ data });
  try {
    const pdf = await loadingTask.promise;
    const pages = [];
    let length = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .filter((item) => "str" in item)
        .map((item) => `${item.str}${item.hasEOL ? "\n" : " "}`)
        .join("")
        .replace(/[ \t]+\n/g, "\n")
        .trim();
      if (text) {
        length += text.length + (pages.length ? 2 : 0);
        checkLength(length, maxLength);
        pages.push(text);
      }
    }
    const transcript = pages.join("\n\n");
    if (!transcript.trim()) {
      throw new Error("No selectable text was found in this PDF. Scanned PDFs need OCR before import.");
    }
    return transcript;
  } finally {
    await loadingTask.destroy();
  }
}

async function extractDocxText(file) {
  const { default: JSZip } = await import("jszip");
  const archive = await JSZip.loadAsync(await file.arrayBuffer());
  const documentFile = archive.file("word/document.xml");
  if (!documentFile) throw new Error("The DOCX package has no Word document content.");

  const xml = new DOMParser().parseFromString(await documentFile.async("text"), "application/xml");
  if (xml.getElementsByTagName("parsererror").length) throw new Error("The Word document XML is invalid.");

  const paragraphs = Array.from(xml.getElementsByTagNameNS("*", "p"), (paragraph) => {
    const walker = xml.createTreeWalker(paragraph, NodeFilter.SHOW_ELEMENT);
    let text = "";
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.localName === "t") text += node.textContent;
      else if (node.localName === "tab") text += "\t";
      else if (node.localName === "br" || node.localName === "cr") text += "\n";
    }
    return text;
  });
  return paragraphs.join("\n");
}

export async function readTranscriptFile(file, maxLength) {
  const extension = fileExtension(file);
  if (!["txt", "md", "docx", "pdf"].includes(extension)) {
    throw new Error("Choose a TXT, Markdown, DOCX, or PDF file.");
  }
  if (file.size > 1024 * 1024) throw new Error("Choose a file smaller than 1 MB.");

  let text;
  if (extension === "txt" || extension === "md") {
    text = await file.text();
  } else if (extension === "docx") {
    try {
      text = await extractDocxText(file);
    } catch (error) {
      throw new Error(
        `Could not read this Word document. Choose a valid, unencrypted DOCX file. ${error instanceof Error ? error.message : ""}`.trim(),
      );
    }
  } else {
    try {
      text = await extractPdfText(file, maxLength);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "Use 100,000 characters or fewer." ||
          error.message.startsWith("No selectable text was found in this PDF."))
      ) {
        throw error;
      }
      throw new Error(`Could not read this PDF. Make sure it is a valid, unencrypted PDF. ${error instanceof Error ? error.message : ""}`.trim());
    }
  }

  text = text.replace(/^\uFEFF/, "");
  if (!text.trim()) throw new Error("This file is empty. Choose a transcript with text.");
  checkLength(text, maxLength);
  if (text.includes("\u0000")) throw new Error("The extracted transcript contains invalid text.");
  return text;
}
