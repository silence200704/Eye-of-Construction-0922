"""通用知识接口；数据集只作为鉴权/审计及命令 epoch 容器，不复制知识内容。"""

from fastapi import APIRouter, Request

from ....operations.datasets.core.workspace import Command, execute_command
from ....operations.knowledge import documents, indexing, lexicon, retrieval
from ....operations.knowledge.corpus import maintain
from ..common import Current, Read, Write, reply
from .schemas import (
    DocumentInput,
    EmptyInput,
    EnabledInput,
    FAQInput,
    SearchInput,
    SynonymInput,
    VersionInput,
)

router = APIRouter(prefix="/api/v1/datasets/{dataset_id}/knowledge", tags=["本地知识"])


def execute(request, session, current, payload, handler):
    result, replayed = execute_command(
        session, current, Command(request, "knowledge_write", payload), handler
    )
    return reply(request, current, result, result.get("rev"), replayed)


@router.get("/documents")
def listing(request: Request, session: Read, current: Current):
    return reply(request, current, documents.list_documents(session, current))


@router.get("/documents/{doc_id}")
def detail(request: Request, session: Read, current: Current, doc_id: str):
    return reply(request, current, documents.detail(session, current, doc_id))


@router.post("/documents")
def create(request: Request, session: Write, current: Current, body: DocumentInput):
    data = body.model_dump()
    return execute(
        request, session, current, data, lambda: documents.create(session, current, data)
    )


@router.post("/documents/{doc_id}/versions")
def version(request: Request, session: Write, current: Current, doc_id: str, body: VersionInput):
    data = body.model_dump()
    return execute(
        request, session, current, data, lambda: documents.version(session, current, doc_id, data)
    )


@router.post("/documents/{doc_id}/enabled")
def enabled(request: Request, session: Write, current: Current, doc_id: str, body: EnabledInput):
    data = body.model_dump()
    return execute(
        request, session, current, data, lambda: documents.enabled(session, current, doc_id, data)
    )


@router.get("/faqs")
def faqs(request: Request, session: Read, current: Current):
    maintain(current)
    return reply(request, current, lexicon.listing(session, "faqs"))


@router.get("/synonyms")
def synonyms(request: Request, session: Read, current: Current):
    maintain(current)
    return reply(request, current, lexicon.listing(session, "synonyms"))


@router.post("/faqs")
def faq_save(request: Request, session: Write, current: Current, body: FAQInput):
    data = body.model_dump()
    return execute(
        request, session, current, data, lambda: lexicon.save(session, current, "faqs", data)
    )


@router.post("/synonyms")
def synonym_save(request: Request, session: Write, current: Current, body: SynonymInput):
    data = body.model_dump()
    return execute(
        request, session, current, data, lambda: lexicon.save(session, current, "synonyms", data)
    )


@router.get("/status")
def status(request: Request, session: Read, current: Current):
    return reply(request, current, indexing.status(session, request.app.state.settings.runtime_dir))


@router.post("/indexes/rebuild")
def rebuild(request: Request, session: Write, current: Current, body: EmptyInput):
    return execute(
        request,
        session,
        current,
        {},
        lambda: indexing.rebuild(session, current, request.app.state.settings.runtime_dir),
    )


@router.post("/search")
def search(request: Request, session: Read, current: Current, body: SearchInput):
    return reply(
        request,
        current,
        retrieval.search(
            session, current, request.app.state.settings.runtime_dir, body.model_dump()
        ),
    )
