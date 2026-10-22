"""显式联网准备固定 revision 的模型资产；运行服务从不调用此下载脚本。"""

import hashlib
import json
import urllib.request
from pathlib import Path

from zhutong.core.settings import Settings

REPOSITORY = "Xenova/bge-small-zh-v1.5"
REVISION = "75c43b069aac4d136ba6bc1122f995fedcfd2781"
ORIGINAL_REVISION = "7999e1d3359715c523056ef9478215996d62a620"
FILES = {"onnx/model_int8.onnx": "model.onnx", "tokenizer.json": "tokenizer.json",
         "config.json": "config.json", "tokenizer_config.json": "tokenizer_config.json",
         "special_tokens_map.json": "special_tokens_map.json", "vocab.txt": "vocab.txt",
         "README.md": "README.md"}


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
        print(f"prepared {local} {destination.stat().st_size}", flush=True)
    config = json.loads((directory / "config.json").read_text(encoding="utf-8"))
    manifest = {"modelId": "BAAI/bge-small-zh-v1.5", "revision": REVISION,
                "onnxRepository": REPOSITORY, "originalRevision": ORIGINAL_REVISION,
                "license": "MIT", "licenseSource": "https://huggingface.co/BAAI/bge-small-zh-v1.5",
                "dimension": config["hidden_size"], "pooling": "cls", "normalization": "l2",
                "quantization": "int8", "files": hashes}
    (directory / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


if __name__ == "__main__":
    result = prepare(Settings().runtime_dir / "models" / "bge-small-zh-v1.5")
    print(json.dumps(result, ensure_ascii=True))
