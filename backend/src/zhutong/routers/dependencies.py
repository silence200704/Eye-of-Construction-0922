from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..core.errors import unauthorized
from ..db.identity import SqlIdentityRepository
from ..operations.auth import AuthService
from ..operations.identity_types import Account

bearer = HTTPBearer(auto_error=False)


def auth_service(request: Request) -> Iterator[AuthService]:
    with request.app.state.database.sessions() as session:
        yield AuthService(
            SqlIdentityRepository(session),
            request.app.state.codec,
            request.app.state.settings.demo_mode,
        )


def access_token(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> str:
    if credentials is None:
        raise unauthorized()
    return credentials.credentials


Service = Annotated[AuthService, Depends(auth_service)]
Token = Annotated[str, Depends(access_token)]


def principal(service: Service, token: Token) -> Account:
    return service.principal(token)


Actor = Annotated[Account, Depends(principal)]
