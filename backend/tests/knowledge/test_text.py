from zhutong.domain.knowledge.text import digest, split_content


def test_long_single_paragraph_stays_bounded_and_traceable():
    content = "# 长篇流程\n\n" + "巡检结果必须保留原始描述，不能覆盖历史记录。" * 100
    chunks = split_content(content, "长篇流程")
    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk["text"]) <= 700
        assert chunk["sha256"] == digest(chunk["text"])
        raw = "\n".join(content.splitlines()[chunk["line_start"] - 1:chunk["line_end"]])
        assert chunk["text"] in raw
