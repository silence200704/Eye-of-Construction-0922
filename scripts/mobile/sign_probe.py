"""Sign the platform-probe App with local public SDK debug fixtures only."""
from pathlib import Path

from signing.common import SigningProject, parse_options, sign


if __name__ == '__main__':
    repo = Path(__file__).resolve().parents[2]
    project = SigningProject(repo / 'mobile/platform-probe',
                             repo / 'backend/.runtime-native-probe/signing', 'org.zhutong.platformprobe')
    sign(parse_options(), project)
