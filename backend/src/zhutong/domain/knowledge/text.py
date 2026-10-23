"""确定性原文分块与检索词；不执行知识中的任何指令。"""

import hashlib
import re
import unicodedata


def digest(text: str | bytes) -> str:
    return hashlib.sha256(text.encode("utf-8") if isinstance(text, str) else text).hexdigest()


def normalized(text: str) -> str:
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", text).lower())


def terms(text: str) -> set[str]:
    value = normalized(text)
    words = set(re.findall(r"[a-z0-9]{2,}", value))
    chinese = re.findall(r"[\u4e00-\u9fff]+", value)
    for phrase in chinese:
        words.update(phrase[i : i + 2] for i in range(len(phrase) - 1))
    return words


def split_content(content: str, title: str) -> list[dict]:
    """按标题和完整行/段落切分；原文行号可直接还原引用，不拼造摘录。"""
    lines = content.splitlines()
    chunks, buffer = [], []
    heading, start = title, 1
    for index, line in enumerate(lines, 1):
        is_heading = bool(re.match(r"^#{1,6}\s", line))
        full = len("\n".join(buffer)) + len(line) > 700
        if buffer and (is_heading or full):
            text = "\n".join(buffer)
            if text.strip():
                chunks.append(
                    {
                        "text": text,
                        "heading": heading,
                        "line_start": start,
                        "line_end": index - 1,
                        "sha256": digest(text),
                    }
                )
            overlap = buffer[-1:] if full and len(buffer[-1]) <= 80 and not is_heading else []
            buffer, start = overlap, index - len(overlap)
        if is_heading:
            heading = line.lstrip("# ").strip()
        buffer.append(line)
    if buffer and "\n".join(buffer).strip():
        text = "\n".join(buffer)
        chunks.append(
            {
                "text": text,
                "heading": heading,
                "line_start": start,
                "line_end": len(lines),
                "sha256": digest(text),
            }
        )
    return [part for chunk in chunks for part in _bounded(chunk)]


def _bounded(chunk: dict) -> list[dict]:
    """超长单行按句界切开；引用仍指向原始行，哈希对应实际片段。"""
    text = chunk["text"]
    parts, offset = [], 0
    while offset < len(text):
        end = min(offset + 700, len(text))
        if end < len(text):
            boundary = max(text.rfind(mark, offset + 350, end) for mark in ("。", "；", "\n"))
            if boundary >= 0:
                end = boundary + 1
        piece = text[offset:end]
        if piece.strip():
            start_line = chunk["line_start"] + text[:offset].count("\n")
            parts.append(
                {
                    **chunk,
                    "text": piece,
                    "line_start": start_line,
                    "line_end": start_line + piece.count("\n"),
                    "sha256": digest(piece),
                }
            )
        offset = end
    return parts
