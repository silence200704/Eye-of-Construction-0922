"""Sign the openharmony App with local public SDK debug fixtures only."""
from pathlib import Path

from signing.common import SigningProject, parse_options, sign


if __name__ == '__main__':
    repo = Path(__file__).resolve().parents[2]
    project = SigningProject(repo / 'mobile/openharmony',
                             repo / 'backend/.runtime-native-online/signing', 'org.zhutong.mobile')
    sign(parse_options(), project)
