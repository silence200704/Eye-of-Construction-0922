"""阶段 7 返修补证用例：按对象、规则、写保护、权限、媒体与 epoch 分模块。"""

from .guards import scope_revoked, write_guards
from .media import epoch_case, history_case, video_chain
from .objects import candidate_click, followup_binding, issue_binding, object_binding
from .rules import rule_disable, trial


def run_fix(api, state: dict, add, ask) -> None:
    object_binding(api, state, add, ask)
    issue_binding(api, state, add, ask)
    followup_binding(api, state, add, ask)
    candidate_click(api, state, add, ask)
    rule_disable(api, state, add, ask)
    trial(api, state, add, ask)
    write_guards(api, state, add, ask)
    scope_revoked(api, state, add, ask)
    video_chain(api, state, add, ask)
    history_case(api, state, add, ask)
    epoch_case(api, state, add, ask)
