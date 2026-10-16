"""Plain text from uploaded kickoff transcripts: TXT, Markdown, DOCX and PDF."""
from __future__ import annotations

import io
import zipfile
from xml.etree import ElementTree

MAX_BYTES = 5 * 1024 * 1024
MAX_CHARS = 100_000
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _docx(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if "word/document.xml" not in archive.namelist():
                raise ValueError("This is not a Word document.")
            if archive.getinfo("word/document.xml").file_size > 50 * 1024 * 1024:
                raise ValueError("This Word document is too large to read.")
            root = ElementTree.fromstring(archive.read("word/document.xml"))
    except zipfile.BadZipFile as error:
        raise ValueError("Could not read this Word document. Choose a valid, unencrypted DOCX file.") from error
    except ElementTree.ParseError as error:
        raise ValueError("Could not read the text in this Word document.") from error
    paragraphs = []
    for paragraph in root.iter(f"{W}p"):
        parts = []
        for node in paragraph.iter():
            if node.tag == f"{W}t":
                parts.append(node.text or "")
            elif node.tag == f"{W}tab":
                parts.append("\t")
            elif node.tag in (f"{W}br", f"{W}cr"):
                parts.append("\n")
        paragraphs.append("".join(parts).strip())
    return "\n".join(paragraphs)


def _pdf(data: bytes) -> str:
    import pymupdf
    try:
        with pymupdf.open(stream=data, filetype="pdf") as document:
            if document.needs_pass:
                raise ValueError("This PDF is password protected. Remove the password and try again.")
            return "\n\n".join(page.get_text("text").strip() for page in document)
    except ValueError:
        raise
    except Exception as error:  # noqa: BLE001 — corrupt or unsupported PDF
        raise ValueError("Could not read this PDF. Choose a valid PDF file.") from error


def extract_text(filename: str, data: bytes) -> str:
    extension = (filename or "").rsplit(".", 1)[-1].lower() if "." in (filename or "") else ""
    if extension not in ("txt", "md", "docx", "pdf"):
        raise ValueError("Upload a TXT, Markdown, DOCX or PDF file.")
    if not data:
        raise ValueError("This file is empty.")
    if len(data) > MAX_BYTES:
        raise ValueError("Choose a file under 5 MB.")
    if extension == "docx":
        text = _docx(data)
    elif extension == "pdf":
        text = _pdf(data)
    else:
        if b"\x00" in data:
            raise ValueError("This does not look like a text file.")
        text = data.decode("utf-8-sig", errors="replace")
    text = text.replace("\r\n", "\n").strip()
    if not text:
        raise ValueError("No selectable text was found in this file. If it is a scan, run OCR on it first.")
    if len(text) > MAX_CHARS:
        raise ValueError("Shorten the transcript to 100,000 characters or fewer.")
    return text
