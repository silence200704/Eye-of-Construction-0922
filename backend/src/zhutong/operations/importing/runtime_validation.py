from .wire import problem


def runtime_errors(runtime: dict) -> list[dict]:
    errors = []
    arrays = {"preferences", "frames", "assets", "comparisons"}
    objects = {"assistant", "scenario", "showcase", "video"}
    for key, value in runtime.items():
        if key not in arrays | objects:
            errors.append(problem("runtime", key, "未知运行数据，不能静默丢弃"))
        elif key in arrays and (
            not isinstance(value, list) or any(not isinstance(item, dict) for item in value)
        ):
            errors.append(problem("runtime", key, "必须是对象数组"))
        elif key in objects and not isinstance(value, dict):
            errors.append(problem("runtime", key, "必须是对象"))
    return errors
