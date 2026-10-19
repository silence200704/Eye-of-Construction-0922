"""结构指标回归：新增代码不得重新长出超长函数或超参签名。"""

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "src" / "zhutong"
DIRECTORIES = [
    ROOT / "domain" / "monitoring",
    ROOT / "operations" / "datasets",
    ROOT / "routers" / "datasets",
]


def _files() -> list[Path]:
    return [
        path
        for directory in DIRECTORIES
        for path in directory.rglob("*.py")
        if path.name != "__init__.py" and "__pycache__" not in path.parts
    ]


def test_no_oversized_functions_or_signatures() -> None:
    problems: list[str] = []
    for path in _files():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            length = (node.end_lineno or node.lineno) - node.lineno + 1
            params = (
                len(node.args.posonlyargs) + len(node.args.args) + len(node.args.kwonlyargs)
            )
            if length > 80:
                problems.append(f"{path}:{node.lineno} {node.name} lines={length}")
            if params > 5:
                problems.append(f"{path}:{node.lineno} {node.name} params={params}")
    assert problems == []


def test_new_directories_stay_within_file_budget() -> None:
    for directory in DIRECTORIES:
        files = [path for path in directory.iterdir() if path.is_file()]
        assert len(files) <= 8, f"{directory} has {len(files)} files"
        for path in files:
            if path.suffix == ".py":
                assert len(path.read_text(encoding="utf-8").splitlines()) <= 450
