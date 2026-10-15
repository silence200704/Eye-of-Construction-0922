import io
import struct

import pytest
from conftest import demo_token
from fastapi.testclient import TestClient
from PIL import Image

from zhutong.db.database import Database


def box(kind: bytes, body: bytes = b"") -> bytes:
    return struct.pack(">I4s", len(body) + 8, kind) + body


@pytest.mark.parametrize("format,mime", [("JPEG", "image/jpeg"), ("WEBP", "image/webp")])
def test_supported_images_decode_and_keep_original_bytes(
    client: TestClient, database: Database, format: str, mime: str
) -> None:
    stream = io.BytesIO()
    Image.new("RGB", (2, 3)).save(stream, format=format)
    headers = {"Authorization": f"Bearer {demo_token(client)}", "Content-Type": mime}
    response = client.post(
        "/api/v1/datasets/demo-main/media?fileName=sample",
        headers=headers,
        content=stream.getvalue(),
    )
    assert response.status_code == 201
    result = response.json()["data"]
    assert (result["width"], result["height"]) == (2, 3)
    assert client.get(result["contentUrl"], headers=headers).content == stream.getvalue()


def test_excessive_image_pixels_are_rejected(client: TestClient, database: Database) -> None:
    stream = io.BytesIO()
    Image.new("1", (6500, 6500)).save(stream, format="PNG")
    headers = {"Authorization": f"Bearer {demo_token(client)}", "Content-Type": "image/png"}
    response = client.post(
        "/api/v1/datasets/demo-main/media?fileName=huge.png",
        headers=headers,
        content=stream.getvalue(),
    )
    assert response.status_code == 413


@pytest.mark.parametrize(
    "payload,status",
    [
        (box(b"ftyp", b"isom") + box(b"moov") + box(b"mdat", b"sample"), 201),
        (box(b"ftyp", b"isom"), 422),
        (b"bad", 422),
        (struct.pack(">I4s", 100, b"ftyp"), 422),
        (struct.pack(">I4s", 1, b"ftyp") + b"short", 422),
    ],
)
def test_mp4_container_validation(
    client: TestClient, database: Database, payload: bytes, status: int
) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}", "Content-Type": "video/mp4"}
    response = client.post(
        "/api/v1/datasets/demo-main/media?fileName=clip.mp4", headers=headers, content=payload
    )
    assert response.status_code == status
