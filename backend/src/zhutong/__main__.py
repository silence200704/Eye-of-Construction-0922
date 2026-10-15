import argparse
import logging
from pathlib import Path

from .bootstrap import initialize
from .core.settings import Settings
from .storage.backup import create_backup, restore_backup, verify_backup


def main() -> None:
    parser = argparse.ArgumentParser(description="筑瞳服务端管理命令")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init")
    backup = commands.add_parser("backup")
    backup.add_argument("--output", type=Path, required=True)
    verify = commands.add_parser("verify-backup")
    verify.add_argument("--source", type=Path, required=True)
    restore = commands.add_parser("restore-backup")
    restore.add_argument("--source", type=Path, required=True)
    restore.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    if args.command == "init":
        initialize()
        print("数据库迁移与演示身份初始化完成")
    elif args.command == "backup":
        create_backup(Settings(), args.output)
        print("数据库、媒体与会话密钥已备份并校验")
    elif args.command == "verify-backup":
        verify_backup(args.source)
        print("备份完整性校验通过")
    else:
        restore_backup(args.source, args.output)
        print("已恢复至新目录，请使用该目录配置运行环境")


if __name__ == "__main__":
    main()
