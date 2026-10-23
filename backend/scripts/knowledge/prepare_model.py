"""显式联网准备固定 revision 的模型资产；运行服务从不调用此下载脚本。"""

import hashlib
import json
import urllib.request
from pathlib import Path

from zhutong.core.settings import Settings

REPOSITORY = "Xenova/bge-small-zh-v1.5"
REVISION = "75c43b069aac4d136ba6bc1122f995fedcfd2781"
ORIGINAL_REVISION = "7999e1d3359715c523056ef9478215996d62a620"
FILES = {
    "onnx/model_int8.onnx": "model.onnx",
    "tokenizer.json": "tokenizer.json",
    "config.json": "config.json",
    "tokenizer_config.json": "tokenizer_config.json",
    "special_tokens_map.json": "special_tokens_map.json",
    "vocab.txt": "vocab.txt",
    "README.md": "README.md",
}
HASHES = {
    "model.onnx": "b9837c19ce154ff0726d398ee77abbc03a7faf0476c6f93016c84e531be7ebb5",
    "tokenizer.json": "48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26",
    "config.json": "d4193ead3a810fd694fa8a31d7fc72fbaebc0668b603e398734bf2f6538ff42f",
    "tokenizer_config.json": "e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a",
    "special_tokens_map.json": "b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3",
    "vocab.txt": "45bbac6b341c319adc98a532532882e91a9cefc0329aa57bac9ae761c27b291c",
    "README.md": "cb22054df1a98f7ee9d5b281d023e67c27cc316e1733baf03fc994d95c3048ab",
}


def prepare(directory: Path) -> dict:
    directory.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for remote, local in FILES.items():
        destination = directory / local
        if not destination.exists():
            url = f"https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{remote}"
            temporary = destination.with_suffix(destination.suffix + ".partial")
            with urllib.request.urlopen(url, timeout=90) as source, temporary.open("wb") as target:
                while block := source.read(1024 * 1024):
                    target.write(block)
            temporary.replace(destination)
        hashes[local] = hashlib.sha256(destination.read_bytes()).hexdigest()
        if hashes[local] != HASHES[local]:
            raise ValueError(f"固定模型资产校验失败：{local}")
        print(f"prepared {local} {destination.stat().st_size}", flush=True)
    config = json.loads((directory / "config.json").read_text(encoding="utf-8"))
    manifest = {
        "modelId": "BAAI/bge-small-zh-v1.5",
        "revision": REVISION,
        "onnxRepository": REPOSITORY,
        "originalRevision": ORIGINAL_REVISION,
        "license": "MIT",
        "licenseSource": "https://huggingface.co/BAAI/bge-small-zh-v1.5",
        "dimension": config["hidden_size"],
        "pooling": "cls",
        "normalization": "l2",
        "quantization": "int8",
        "files": hashes,
    }
    (directory / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return manifest


if __name__ == "__main__":
    result = prepare(Settings().runtime_dir / "models" / "bge-small-zh-v1.5")
    print(json.dumps(result, ensure_ascii=True))
