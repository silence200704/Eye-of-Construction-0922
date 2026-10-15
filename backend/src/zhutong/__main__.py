import argparse
import logging

from .bootstrap import initialize


def main() -> None:
    parser = argparse.ArgumentParser(description="筑瞳服务端管理命令")
    parser.add_argument("command", choices=["init"])
    parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    initialize()
    print("数据库迁移与测试账号初始化完成")


if __name__ == "__main__":
    main()
