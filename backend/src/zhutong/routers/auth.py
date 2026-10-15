from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from ..core.http import ok
from .dependencies import Service, Token

router = APIRouter(prefix="/api/v1", tags=["账号"])


class LoginInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


class DemoInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    accountId: str = Field(min_length=1, max_length=80)


@router.post("/auth/login")
def login(request: Request, body: LoginInput, service: Service) -> dict:
    return ok(request, service.login(body.username, body.password))


@router.get("/auth/me")
def me(request: Request, service: Service, token: Token) -> dict:
    return ok(request, service.principal(token).public())


@router.post("/auth/logout")
def logout(request: Request, service: Service, token: Token) -> dict:
    service.logout(token)
    return ok(request, {"signedOut": True})


@router.get("/demo/accounts")
def accounts(request: Request, service: Service) -> dict:
    return ok(request, service.list_demo())


@router.post("/demo/login")
def shortcut(request: Request, body: DemoInput, service: Service) -> dict:
    return ok(request, service.shortcut(body.accountId))
