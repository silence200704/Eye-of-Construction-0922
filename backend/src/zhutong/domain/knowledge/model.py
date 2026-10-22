"""仅使用本地文件的 BGE/ONNX CPU 编码，不导入任何网络下载客户端。"""

import json
from functools import lru_cache
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

from .text import digest


class ModelUnavailable(RuntimeError):
    pass


class LocalEncoder:
    def __init__(self, directory: Path):
        manifest_bytes = (directory / "manifest.json").read_bytes()
        manifest = json.loads(manifest_bytes)
        for name, checksum in manifest["files"].items():
            path = (directory / name).resolve()
            if (
                not path.is_relative_to(directory.resolve())
                or digest(path.read_bytes()) != checksum
            ):
                raise ModelUnavailable("本地模型文件校验失败")
        self.model_id = manifest["modelId"]
        self.revision = manifest["revision"]
        self.dimension = manifest["dimension"]
        self.fingerprint = digest(manifest_bytes)
        self.tokenizer = Tokenizer.from_file(str(directory / "tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=512)
        self.tokenizer.enable_padding(pad_id=0, pad_token="[PAD]")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(
            str(directory / "model.onnx"), sess_options=options, providers=["CPUExecutionProvider"]
        )

    def encode(self, texts: list[str], query: bool = False) -> np.ndarray:
        if query:
            texts = ["为这个句子生成表示以用于检索相关文章：" + text for text in texts]
        rows = self.tokenizer.encode_batch(texts)
        arrays = {
            "input_ids": np.asarray([r.ids for r in rows], dtype=np.int64),
            "attention_mask": np.asarray([r.attention_mask for r in rows], dtype=np.int64),
            "token_type_ids": np.asarray([r.type_ids for r in rows], dtype=np.int64),
        }
        feed = {item.name: arrays[item.name] for item in self.session.get_inputs()}
        output = self.session.run(None, feed)[0]
        vectors = output[:, 0, :] if output.ndim == 3 else output
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        if (
            vectors.shape != (len(texts), self.dimension)
            or not np.isfinite(vectors).all()
            or np.any(norms <= 0)
        ):
            raise ModelUnavailable("本地模型输出维度或数值无效")
        return (vectors / norms).astype("<f4")


@lru_cache(maxsize=2)
def _load(directory: str, stamp: tuple) -> LocalEncoder:
    try:
        return LocalEncoder(Path(directory))
    except (OSError, ValueError, KeyError, ort.capi.onnxruntime_pybind11_state.Fail) as error:
        raise ModelUnavailable(f"本地模型不可用：{type(error).__name__}") from error


def get_encoder(runtime_dir: Path) -> LocalEncoder:
    directory = runtime_dir / "models" / "bge-small-zh-v1.5"
    try:
        stamp = tuple(
            (p.name, p.stat().st_size, p.stat().st_mtime_ns) for p in sorted(directory.iterdir())
        )
        if not stamp:
            raise OSError("empty model")
    except OSError as error:
        raise ModelUnavailable("未准备本地 BGE 模型，当前仅 FAQ/关键词检索") from error
    return _load(str(directory.resolve()), stamp)
