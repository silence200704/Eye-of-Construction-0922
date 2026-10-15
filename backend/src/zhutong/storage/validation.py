import struct
import warnings
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from ..core.errors import AppError

IMAGE_MIMES = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}


def inspect_media(path: Path, mime_type: str) -> tuple[int, int]:
    if mime_type == "video/mp4":
        inspect_mp4(path)
        return 0, 0
    if mime_type not in IMAGE_MIMES.values():
        raise AppError("UNSUPPORTED_MEDIA", "仅支持 PNG、JPEG、WebP 图片与 MP4 视频", 415)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                if IMAGE_MIMES.get(image.format) != mime_type:
                    raise AppError("MEDIA_TYPE_MISMATCH", "文件内容与声明类型不一致", 415)
                if image.width * image.height > 40_000_000:
                    raise AppError("MEDIA_TOO_LARGE", "图片像素超过限制", 413)
                dimensions = image.size
                image.verify()
            with Image.open(path) as image:
                image.load()
            return dimensions
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as error:
        raise AppError("INVALID_MEDIA", "图片损坏或无法解码", 422) from error
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise AppError("MEDIA_TOO_LARGE", "图片像素超过限制", 413) from error


def inspect_mp4(path: Path) -> None:
    boxes, total = set(), path.stat().st_size
    with path.open("rb") as source:
        while source.tell() < total:
            start = source.tell()
            header = source.read(8)
            if len(header) != 8:
                raise AppError("INVALID_MEDIA", "MP4 容器不完整", 422)
            length, kind = struct.unpack(">I4s", header)
            header_size = 8
            if length == 1:
                extended = source.read(8)
                if len(extended) != 8:
                    raise AppError("INVALID_MEDIA", "MP4 容器不完整", 422)
                length, header_size = struct.unpack(">Q", extended)[0], 16
            if length == 0:
                length = total - start
            if length < header_size or start + length > total:
                raise AppError("INVALID_MEDIA", "MP4 容器长度无效", 422)
            boxes.add(kind)
            source.seek(start + length)
    if not {b"ftyp", b"moov", b"mdat"} <= boxes:
        raise AppError("INVALID_MEDIA", "MP4 缺少类型、索引或媒体数据", 422)
